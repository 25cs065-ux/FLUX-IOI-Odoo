-- =============================================================================
-- Brightloop — billing transaction functions
-- File   : database/migrations/20261031_billing_transactions.sql
-- Owner  : backend core (Aadya)
-- Status : PROPOSED. NOT APPLIED to any Supabase project. Needs team approval.
--
-- Why
--   Supabase's REST API runs one statement per request, so multi-table
--   billing writes could be interrupted halfway. Each function below does one
--   business operation inside a single transaction and takes row locks
--   (SELECT ... FOR UPDATE) on the invoice / subscription, which serialises:
--     * concurrent payments on the same invoice (no overpayment)
--     * voiding vs recording a payment (no payment on a void invoice)
--     * header + lines writes (never half-saved)
--     * invoice creation + advancing next_billing_date (no stuck billing)
--
-- How the API uses it
--   Only when the backend runs with BILLING_DB_FUNCTIONS=true. Without that
--   flag the API keeps its current compensating (non-transactional) logic, so
--   deploying the code before this migration is safe.
--
-- Errors
--   Business-rule failures raise custom SQLSTATEs that the API maps to HTTP:
--     BL404 -> 404, BL409 -> 409, BL422 -> 422.  Unique violations stay 23505.
--
-- Safety
--   Additive only: CREATE OR REPLACE FUNCTION. No table is created, altered or
--   dropped; no data is changed by running this file. Functions are
--   SECURITY INVOKER with a fixed search_path, and EXECUTE is revoked from
--   anon / authenticated so they are reachable only with the service role.
--   Requires database/remaining_schema.sql to be applied first.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Invoice balance (internal helpers)
-- ---------------------------------------------------------------------------

-- Net paid = completed amounts minus refunds. Pending and failed never count.
CREATE OR REPLACE FUNCTION billing_invoice_net_paid(p_invoice_id uuid)
RETURNS numeric
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT coalesce(sum(amount - refunded_amount), 0)
      FROM payments
     WHERE invoice_id = p_invoice_id
       AND status IN ('completed', 'partially_refunded', 'refunded');
$$;

-- Re-derives amount_paid / status / paid_at. Locks the invoice row.
CREATE OR REPLACE FUNCTION billing_sync_invoice_balance(p_invoice_id uuid, p_today date)
RETURNS invoices
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_inv    invoices;
    v_paid   numeric(14,2);
    v_status text;
BEGIN
    SELECT * INTO v_inv FROM invoices WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'BL404', MESSAGE = 'Invoice not found';
    END IF;
    IF v_inv.status NOT IN ('sent', 'partial', 'paid', 'overdue') THEN
        RETURN v_inv;            -- draft / void / cancelled never carry a balance
    END IF;

    v_paid := billing_invoice_net_paid(p_invoice_id);
    v_status := CASE
        WHEN v_paid >= v_inv.total_amount THEN 'paid'
        WHEN v_inv.due_date < p_today     THEN 'overdue'
        WHEN v_paid > 0                   THEN 'partial'
        ELSE 'sent'
    END;
    IF v_paid = v_inv.amount_paid AND v_status = v_inv.status THEN
        RETURN v_inv;
    END IF;

    UPDATE invoices
       SET amount_paid = v_paid,
           status      = v_status,
           paid_at     = CASE WHEN v_status = 'paid' THEN coalesce(v_inv.paid_at, now()) END,
           updated_at  = now()
     WHERE id = p_invoice_id
    RETURNING * INTO v_inv;
    RETURN v_inv;
END;
$$;

-- When the latest period's invoice is cancelled / voided, rewind the
-- subscription so that period is billed again.
CREATE OR REPLACE FUNCTION billing_release_period(p_inv invoices)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_sub subscriptions;
BEGIN
    IF p_inv.subscription_id IS NULL OR p_inv.billing_period_start IS NULL
       OR p_inv.billing_period_end IS NULL THEN
        RETURN;
    END IF;
    SELECT * INTO v_sub FROM subscriptions WHERE id = p_inv.subscription_id FOR UPDATE;
    IF NOT FOUND OR v_sub.status NOT IN ('active', 'paused') THEN
        RETURN;
    END IF;
    IF v_sub.next_billing_date = p_inv.billing_period_end + 1
       OR (v_sub.next_billing_date IS NULL AND v_sub.end_date = p_inv.billing_period_end) THEN
        UPDATE subscriptions
           SET next_billing_date = p_inv.billing_period_start, updated_at = now()
         WHERE id = v_sub.id;
    END IF;
END;
$$;


-- ---------------------------------------------------------------------------
-- Subscriptions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION billing_create_subscription(p_header jsonb, p_lines jsonb, p_history jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    h       subscriptions := jsonb_populate_record(NULL::subscriptions, p_header);
    v_sub   subscriptions;
    v_lines jsonb;
BEGIN
    INSERT INTO subscriptions (
        customer_id, plan_id, quotation_template_id, payment_terms_id, status, quantity,
        start_date, end_date, trial_end_date, next_billing_date, unit_price,
        discount_amount, tax_amount, total_amount, currency, auto_renew, notes, created_by)
    VALUES (
        h.customer_id, h.plan_id, h.quotation_template_id, h.payment_terms_id,
        coalesce(h.status, 'draft'), coalesce(h.quantity, 1),
        h.start_date, h.end_date, h.trial_end_date, h.next_billing_date, h.unit_price,
        coalesce(h.discount_amount, 0), coalesce(h.tax_amount, 0), h.total_amount,
        coalesce(h.currency, 'INR'), coalesce(h.auto_renew, true), h.notes, h.created_by)
    RETURNING * INTO v_sub;

    INSERT INTO subscription_lines (
        subscription_id, product_id, variant_id, sequence, description, quantity, unit_price,
        discount_percent, discount_amount, tax_id, tax_amount, subtotal, line_total)
    SELECT v_sub.id, l.product_id, l.variant_id, coalesce(l.sequence, 10), l.description,
           coalesce(l.quantity, 1), l.unit_price, coalesce(l.discount_percent, 0),
           coalesce(l.discount_amount, 0), l.tax_id, coalesce(l.tax_amount, 0), l.subtotal, l.line_total
      FROM jsonb_populate_recordset(NULL::subscription_lines, coalesce(p_lines, '[]'::jsonb)) l;

    IF p_history IS NOT NULL THEN
        INSERT INTO subscription_status_history (subscription_id, from_status, to_status, changed_by, reason, metadata)
        SELECT v_sub.id, r.from_status, r.to_status, r.changed_by, r.reason, coalesce(r.metadata, '{}')
          FROM jsonb_populate_record(NULL::subscription_status_history, p_history) r;
    END IF;

    SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.sequence), '[]') INTO v_lines
      FROM subscription_lines l WHERE l.subscription_id = v_sub.id;
    RETURN jsonb_build_object('subscription', to_jsonb(v_sub), 'lines', v_lines);
END;
$$;

-- Returns NULL when the row is missing, has another status, or was saved by
-- someone else since p_expected_updated_at (optimistic lock) -> API 409.
-- p_lines NULL keeps the current lines; an array replaces them.
CREATE OR REPLACE FUNCTION billing_update_subscription(
    p_id uuid, p_expected_status text, p_expected_updated_at timestamptz,
    p_changes jsonb, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_old   subscriptions;
    n       subscriptions;
    v_lines jsonb;
BEGIN
    SELECT * INTO v_old FROM subscriptions WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR v_old.status <> p_expected_status
       OR (p_expected_updated_at IS NOT NULL AND v_old.updated_at <> p_expected_updated_at) THEN
        RETURN NULL;
    END IF;

    n := jsonb_populate_record(v_old, p_changes);
    UPDATE subscriptions SET
        plan_id = n.plan_id, quantity = n.quantity, start_date = n.start_date, end_date = n.end_date,
        trial_end_date = n.trial_end_date, next_billing_date = n.next_billing_date,
        payment_terms_id = n.payment_terms_id, quotation_template_id = n.quotation_template_id,
        currency = n.currency, auto_renew = n.auto_renew, notes = n.notes, unit_price = n.unit_price,
        discount_amount = n.discount_amount, tax_amount = n.tax_amount, total_amount = n.total_amount,
        updated_at = CASE WHEN n.updated_at = v_old.updated_at THEN now() ELSE n.updated_at END
     WHERE id = p_id
    RETURNING * INTO n;

    IF p_lines IS NOT NULL THEN
        DELETE FROM subscription_lines WHERE subscription_id = p_id;
        INSERT INTO subscription_lines (
            subscription_id, product_id, variant_id, sequence, description, quantity, unit_price,
            discount_percent, discount_amount, tax_id, tax_amount, subtotal, line_total)
        SELECT p_id, l.product_id, l.variant_id, coalesce(l.sequence, 10), l.description,
               coalesce(l.quantity, 1), l.unit_price, coalesce(l.discount_percent, 0),
               coalesce(l.discount_amount, 0), l.tax_id, coalesce(l.tax_amount, 0), l.subtotal, l.line_total
          FROM jsonb_populate_recordset(NULL::subscription_lines, p_lines) l;
    END IF;

    SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.sequence), '[]') INTO v_lines
      FROM subscription_lines l WHERE l.subscription_id = p_id;
    RETURN jsonb_build_object('subscription', to_jsonb(n), 'lines', v_lines);
END;
$$;


-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------

-- Inserts the invoice and its lines and, for a subscription period, advances
-- next_billing_date, all in one transaction. The subscription row is locked
-- and must still be active with next_billing_date = p_period_start, so two
-- billing runs cannot bill the same period (uix_invoice_live_period also
-- rejects it with 23505).
CREATE OR REPLACE FUNCTION billing_create_invoice(
    p_header jsonb, p_lines jsonb,
    p_subscription_id uuid, p_period_start date, p_next_billing_date date)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    h       invoices := jsonb_populate_record(NULL::invoices, p_header);
    v_sub   subscriptions;
    v_inv   invoices;
    v_lines jsonb;
BEGIN
    IF p_subscription_id IS NOT NULL THEN
        SELECT * INTO v_sub FROM subscriptions WHERE id = p_subscription_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION USING ERRCODE = 'BL404', MESSAGE = 'Subscription not found';
        END IF;
        IF v_sub.status <> 'active' THEN
            RAISE EXCEPTION USING ERRCODE = 'BL409',
                MESSAGE = format('Only active subscriptions can be invoiced (status is %s)', v_sub.status);
        END IF;
        IF v_sub.next_billing_date IS DISTINCT FROM p_period_start THEN
            RAISE EXCEPTION USING ERRCODE = 'BL409',
                MESSAGE = 'The subscription was billed by another request; reload and try again';
        END IF;
    END IF;

    INSERT INTO invoices (
        customer_id, subscription_id, payment_terms_id, status, issue_date, due_date,
        billing_period_start, billing_period_end, subtotal, discount_amount, tax_amount,
        total_amount, currency, tax_name, tax_rate, notes, terms_and_conditions, created_by)
    VALUES (
        h.customer_id, h.subscription_id, h.payment_terms_id, coalesce(h.status, 'draft'),
        coalesce(h.issue_date, current_date), h.due_date, h.billing_period_start, h.billing_period_end,
        coalesce(h.subtotal, 0), coalesce(h.discount_amount, 0), coalesce(h.tax_amount, 0),
        coalesce(h.total_amount, 0), coalesce(h.currency, 'INR'), h.tax_name, h.tax_rate,
        h.notes, h.terms_and_conditions, h.created_by)
    RETURNING * INTO v_inv;

    INSERT INTO invoice_lines (
        invoice_id, subscription_line_id, product_id, variant_id, sequence, description, quantity,
        unit_price, discount_percent, discount_amount, tax_id, tax_name, tax_rate, tax_amount,
        subtotal, line_total)
    SELECT v_inv.id, l.subscription_line_id, l.product_id, l.variant_id, coalesce(l.sequence, 10),
           l.description, coalesce(l.quantity, 1), l.unit_price, coalesce(l.discount_percent, 0),
           coalesce(l.discount_amount, 0), l.tax_id, l.tax_name, l.tax_rate, coalesce(l.tax_amount, 0),
           l.subtotal, l.line_total
      FROM jsonb_populate_recordset(NULL::invoice_lines, coalesce(p_lines, '[]'::jsonb)) l;

    IF p_subscription_id IS NOT NULL THEN
        UPDATE subscriptions SET next_billing_date = p_next_billing_date, updated_at = now()
         WHERE id = p_subscription_id;
    END IF;

    SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.sequence), '[]') INTO v_lines
      FROM invoice_lines l WHERE l.invoice_id = v_inv.id;
    RETURN jsonb_build_object('invoice', to_jsonb(v_inv), 'lines', v_lines);
END;
$$;

-- Same contract as billing_update_subscription.
CREATE OR REPLACE FUNCTION billing_update_invoice(
    p_id uuid, p_expected_status text, p_expected_updated_at timestamptz,
    p_changes jsonb, p_lines jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_old   invoices;
    n       invoices;
    v_lines jsonb;
BEGIN
    SELECT * INTO v_old FROM invoices WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR v_old.status <> p_expected_status
       OR (p_expected_updated_at IS NOT NULL AND v_old.updated_at <> p_expected_updated_at) THEN
        RETURN NULL;
    END IF;

    n := jsonb_populate_record(v_old, p_changes);
    UPDATE invoices SET
        payment_terms_id = n.payment_terms_id, issue_date = n.issue_date, due_date = n.due_date,
        notes = n.notes, terms_and_conditions = n.terms_and_conditions, subtotal = n.subtotal,
        discount_amount = n.discount_amount, tax_amount = n.tax_amount, total_amount = n.total_amount,
        tax_name = n.tax_name, tax_rate = n.tax_rate,
        updated_at = CASE WHEN n.updated_at = v_old.updated_at THEN now() ELSE n.updated_at END
     WHERE id = p_id
    RETURNING * INTO n;

    IF p_lines IS NOT NULL THEN
        DELETE FROM invoice_lines WHERE invoice_id = p_id;
        INSERT INTO invoice_lines (
            invoice_id, subscription_line_id, product_id, variant_id, sequence, description, quantity,
            unit_price, discount_percent, discount_amount, tax_id, tax_name, tax_rate, tax_amount,
            subtotal, line_total)
        SELECT p_id, l.subscription_line_id, l.product_id, l.variant_id, coalesce(l.sequence, 10),
               l.description, coalesce(l.quantity, 1), l.unit_price, coalesce(l.discount_percent, 0),
               coalesce(l.discount_amount, 0), l.tax_id, l.tax_name, l.tax_rate, coalesce(l.tax_amount, 0),
               l.subtotal, l.line_total
          FROM jsonb_populate_recordset(NULL::invoice_lines, p_lines) l;
    END IF;

    SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.sequence), '[]') INTO v_lines
      FROM invoice_lines l WHERE l.invoice_id = p_id;
    RETURN jsonb_build_object('invoice', to_jsonb(n), 'lines', v_lines);
END;
$$;

-- sent / overdue with nothing paid and nothing pending -> void.
-- Locks the invoice, so it cannot interleave with billing_record_payment.
CREATE OR REPLACE FUNCTION billing_void_invoice(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_inv invoices;
BEGIN
    SELECT * INTO v_inv FROM invoices WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'BL404', MESSAGE = 'Invoice not found';
    END IF;
    IF v_inv.status NOT IN ('sent', 'overdue') THEN
        RAISE EXCEPTION USING ERRCODE = 'BL409',
            MESSAGE = format('Cannot move a %s invoice to void (allowed from: overdue, sent)', v_inv.status);
    END IF;
    IF v_inv.amount_paid > 0 OR EXISTS (
        SELECT 1 FROM payments
         WHERE invoice_id = p_invoice_id
           AND (status = 'pending'
                OR (status IN ('completed', 'partially_refunded') AND amount > refunded_amount))) THEN
        RAISE EXCEPTION USING ERRCODE = 'BL409',
            MESSAGE = 'Invoice has payments recorded or pending; refund or fail them before voiding';
    END IF;

    UPDATE invoices SET status = 'void', voided_at = now(), updated_at = now()
     WHERE id = p_invoice_id
    RETURNING * INTO v_inv;
    PERFORM billing_release_period(v_inv);
    RETURN to_jsonb(v_inv);
END;
$$;

-- draft -> cancelled, releasing the billing period in the same transaction.
CREATE OR REPLACE FUNCTION billing_cancel_invoice(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_inv invoices;
BEGIN
    SELECT * INTO v_inv FROM invoices WHERE id = p_invoice_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'BL404', MESSAGE = 'Invoice not found';
    END IF;
    IF v_inv.status <> 'draft' THEN
        RAISE EXCEPTION USING ERRCODE = 'BL409',
            MESSAGE = format('Cannot move a %s invoice to cancelled (allowed from: draft)', v_inv.status);
    END IF;
    UPDATE invoices SET status = 'cancelled', updated_at = now()
     WHERE id = p_invoice_id
    RETURNING * INTO v_inv;
    PERFORM billing_release_period(v_inv);
    RETURN to_jsonb(v_inv);
END;
$$;


-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------

-- Records a payment and updates the invoice balance atomically. The invoice
-- row lock serialises concurrent payments and voids on the same invoice.
-- A known payment_reference (or gateway + gateway_payment_id) returns the
-- original payment with replay = true instead of inserting a duplicate.
CREATE OR REPLACE FUNCTION billing_record_payment(p_payment jsonb, p_today date)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    r             payments := jsonb_populate_record(NULL::payments, p_payment);
    v_inv         invoices;
    v_existing    payments;
    v_new         payments;
    v_outstanding numeric(14,2);
BEGIN
    SELECT * INTO v_inv FROM invoices WHERE id = r.invoice_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'BL404', MESSAGE = 'Invoice not found';
    END IF;

    SELECT * INTO v_existing FROM payments WHERE payment_reference = r.payment_reference;
    IF NOT FOUND AND r.gateway_payment_id IS NOT NULL THEN
        SELECT * INTO v_existing FROM payments
         WHERE gateway_payment_id = r.gateway_payment_id AND gateway IS NOT DISTINCT FROM r.gateway
         LIMIT 1;
    END IF;
    IF FOUND THEN
        RETURN jsonb_build_object('payment', to_jsonb(v_existing), 'invoice', to_jsonb(v_inv), 'replay', true);
    END IF;

    IF v_inv.status NOT IN ('sent', 'partial', 'overdue') THEN
        RAISE EXCEPTION USING ERRCODE = 'BL409',
            MESSAGE = format('Payments cannot be recorded against a %s invoice', v_inv.status);
    END IF;
    IF r.currency IS NOT NULL AND r.currency <> v_inv.currency THEN
        RAISE EXCEPTION USING ERRCODE = 'BL422',
            MESSAGE = format('Currency must match the invoice currency (%s)', v_inv.currency);
    END IF;

    SELECT v_inv.total_amount - billing_invoice_net_paid(v_inv.id)
           - coalesce(sum(amount) FILTER (WHERE status = 'pending'), 0)
      INTO v_outstanding
      FROM payments WHERE invoice_id = v_inv.id;
    IF r.amount > v_outstanding THEN
        RAISE EXCEPTION USING ERRCODE = 'BL409',
            MESSAGE = format('Payment exceeds the outstanding balance of %s', v_outstanding);
    END IF;

    INSERT INTO payments (
        payment_reference, invoice_id, customer_id, method, status, amount, currency, payment_date,
        gateway, gateway_payment_id, gateway_response, notes, recorded_by)
    VALUES (
        r.payment_reference, v_inv.id, v_inv.customer_id, coalesce(r.method, 'bank_transfer'),
        coalesce(r.status, 'completed'), r.amount, v_inv.currency, coalesce(r.payment_date, p_today),
        r.gateway, r.gateway_payment_id, coalesce(r.gateway_response, '{}'), r.notes, r.recorded_by)
    RETURNING * INTO v_new;

    IF v_new.status = 'completed' THEN
        v_inv := billing_sync_invoice_balance(v_inv.id, p_today);
    END IF;
    RETURN jsonb_build_object('payment', to_jsonb(v_new), 'invoice', to_jsonb(v_inv), 'replay', false);
END;
$$;

-- p_action: 'confirm' (pending -> completed), 'fail' (pending -> failed) or
-- 'refund' (p_amount NULL = full remaining). Locks invoice then payment, in the
-- same order as billing_record_payment, so the two cannot deadlock.
CREATE OR REPLACE FUNCTION billing_change_payment(
    p_payment_id uuid, p_action text, p_amount numeric, p_note text, p_today date)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_pay        payments;
    v_inv        invoices;
    v_refundable numeric(14,2);
    v_refund     numeric(14,2);
BEGIN
    SELECT * INTO v_pay FROM payments WHERE id = p_payment_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'BL404', MESSAGE = 'Payment not found';
    END IF;
    SELECT * INTO v_inv FROM invoices WHERE id = v_pay.invoice_id FOR UPDATE;
    SELECT * INTO v_pay FROM payments WHERE id = p_payment_id FOR UPDATE;

    IF p_action IN ('confirm', 'fail') THEN
        IF v_pay.status <> 'pending' THEN
            RAISE EXCEPTION USING ERRCODE = 'BL409', MESSAGE = format(
                'Only pending payments can be %s (status is %s)',
                CASE p_action WHEN 'confirm' THEN 'confirmed' ELSE 'marked failed' END, v_pay.status);
        END IF;
        UPDATE payments
           SET status = CASE p_action WHEN 'confirm' THEN 'completed' ELSE 'failed' END, updated_at = now()
         WHERE id = p_payment_id
        RETURNING * INTO v_pay;
    ELSIF p_action = 'refund' THEN
        IF v_pay.status NOT IN ('completed', 'partially_refunded') THEN
            RAISE EXCEPTION USING ERRCODE = 'BL409',
                MESSAGE = format('A %s payment cannot be refunded', v_pay.status);
        END IF;
        v_refundable := v_pay.amount - v_pay.refunded_amount;
        v_refund := coalesce(p_amount, v_refundable);
        IF v_refund <= 0 OR v_refund > v_refundable THEN
            RAISE EXCEPTION USING ERRCODE = 'BL409',
                MESSAGE = format('Refund exceeds the refundable amount of %s', v_refundable);
        END IF;
        UPDATE payments SET
            refunded_amount = refunded_amount + v_refund,
            status = CASE WHEN refunded_amount + v_refund = amount THEN 'refunded' ELSE 'partially_refunded' END,
            refunded_at = now(),
            notes = CASE WHEN p_note IS NULL THEN notes
                         WHEN notes IS NULL THEN p_note ELSE notes || E'\n' || p_note END,
            updated_at = now()
         WHERE id = p_payment_id
        RETURNING * INTO v_pay;
    ELSE
        RAISE EXCEPTION USING ERRCODE = 'BL422', MESSAGE = format('Unknown payment action %s', p_action);
    END IF;

    v_inv := billing_sync_invoice_balance(v_inv.id, p_today);
    RETURN jsonb_build_object('payment', to_jsonb(v_pay), 'invoice', to_jsonb(v_inv));
END;
$$;

-- Public wrapper for POST /payments/recalculate/{invoice_id}.
CREATE OR REPLACE FUNCTION billing_recalculate_invoice(p_invoice_id uuid, p_today date)
RETURNS jsonb
LANGUAGE sql
SET search_path = public
AS $$
    SELECT to_jsonb(billing_sync_invoice_balance(p_invoice_id, p_today));
$$;


-- ---------------------------------------------------------------------------
-- Access: service role only (the FastAPI backend). Not callable by browsers.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    f text;
BEGIN
    FOREACH f IN ARRAY ARRAY[
        'billing_invoice_net_paid(uuid)',
        'billing_sync_invoice_balance(uuid, date)',
        'billing_release_period(invoices)',
        'billing_create_subscription(jsonb, jsonb, jsonb)',
        'billing_update_subscription(uuid, text, timestamptz, jsonb, jsonb)',
        'billing_create_invoice(jsonb, jsonb, uuid, date, date)',
        'billing_update_invoice(uuid, text, timestamptz, jsonb, jsonb)',
        'billing_void_invoice(uuid)',
        'billing_cancel_invoice(uuid)',
        'billing_record_payment(jsonb, date)',
        'billing_change_payment(uuid, text, numeric, text, date)',
        'billing_recalculate_invoice(uuid, date)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
            EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f);
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
            EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', f);
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
            EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
        END IF;
    END LOOP;
END;
$$;
