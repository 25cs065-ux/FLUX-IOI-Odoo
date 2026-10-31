-- =============================================================================
-- Brightloop Subscription Management System — Remaining Tables
-- File    : database/remaining_schema.sql
-- Owner   : backend core (Aadya)
-- Purpose : Creates ONLY the tables that do not yet exist in the shared
--           Supabase database.  Safe to run against a live Supabase instance
--           that already contains the following 9 public tables:
--
--             change_requests, customers, discounts, plans, products,
--             quotation_template_lines, quotation_templates, taxes, variants
--
-- Safety guarantees
--   • Every CREATE TABLE uses IF NOT EXISTS — script is idempotent.
--   • No existing table is DROPped, ALTERed, RENAMEd, or TRUNCATEd.
--   • No data is DELETEd or modified.
--   • All primary keys use UUID (gen_random_uuid()) to match existing tables.
--   • All foreign keys that reference existing tables use their real UUID PKs.
--   • User-identity columns reference auth.users(id) (Supabase Auth), NOT a
--     custom public.users table which does not exist in this database.
--   • RLS is ENABLED on every new public table; NO public-access policies are
--     created.  The FastAPI service role (BYPASSRLS) accesses tables directly.
--
-- Tables created here (10)
--   1.  payment_terms              — payment condition definitions
--   2.  subscriptions              — core subscription lifecycle records
--   3.  subscription_lines         — per-product line items within a subscription
--   4.  subscription_status_history — append-only status transition audit log
--   5.  subscription_discounts     — discounts applied to subscriptions
--   6.  invoices                   — billing documents
--   7.  invoice_lines              — line items on an invoice
--   8.  payments                   — payment records against invoices
--   9.  discount_usages            — per-redemption audit trail
--
-- Existing table names and known columns used as FK targets
--   customers(id UUID)             — customer billing entity
--   plans(id UUID)                 — subscription plan tier
--   products(id UUID)              — product catalogue entry
--   variants(id UUID)              — product variant  [NOT product_variants]
--   taxes(id UUID)                 — tax rule
--   quotation_templates(id UUID)   — quotation template
--   discounts(id UUID)             — discount catalogue entry
--   auth.users(id UUID)            — Supabase Auth identity (created_by / recorded_by)
--
-- Known column-name differences between schema.sql and the live DB
--   schema.sql assumption          → live column name
--   products.sales_price           → products.price
--   plans.billing_interval         → plans.interval
--   product_variants (table)       → variants (table)
--   customers.user_id              → customers.auth_user_id
--   qtl.quotation_template_id      → quotation_template_lines.template_id
-- (See dependency report at end of file for full list.)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extensions  (idempotent — no-op if already installed)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "citext";     -- case-insensitive text (email, codes)

-- ---------------------------------------------------------------------------
-- Sequences  (idempotent — no-op if already created; counters are untouched)
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq
    START WITH 1000
    INCREMENT BY 1
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE IF NOT EXISTS subscription_number_seq
    START WITH 100
    INCREMENT BY 1
    NO MAXVALUE
    CACHE 1;

CREATE SEQUENCE IF NOT EXISTS quotation_number_seq
    START WITH 1000
    INCREMENT BY 1
    NO MAXVALUE
    CACHE 1;

-- =============================================================================
-- 1. payment_terms
--    Named payment conditions referenced by subscriptions and invoices.
--    e.g. "Net-30", "Due on Receipt", "50% upfront".
--    Not present in the existing 9 Supabase tables — created fresh here.
-- =============================================================================
CREATE TABLE IF NOT EXISTS payment_terms (
    id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    name             TEXT          NOT NULL UNIQUE,
    description      TEXT,
    -- days_due = 0 means immediate / due on receipt
    days_due         INTEGER       NOT NULL DEFAULT 0  CHECK (days_due >= 0),
    -- advance_percent: % of total due upfront (0 = none, 100 = full prepay)
    advance_percent  NUMERIC(5,2)  NOT NULL DEFAULT 0.00
                         CHECK (advance_percent BETWEEN 0 AND 100),
    is_active        BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_terms_is_active ON payment_terms (is_active);

-- =============================================================================
-- 2. subscriptions
--    Core subscription records.  Covers the full lifecycle:
--      draft → quotation → confirmed → active → paused → active (resume)
--                                    → active  → closed
--                                    → confirmed → closed (early close)
--      quotation → closed (rejected)
--
--    FK targets use the real live-DB column names and UUID types:
--      customers(id), plans(id), quotation_templates(id),
--      payment_terms(id), auth.users(id)
-- =============================================================================
CREATE TABLE IF NOT EXISTS subscriptions (
    id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    -- subscription_number: staff-facing display reference
    subscription_number   TEXT          NOT NULL UNIQUE
                              DEFAULT ('SUB-' || LPAD(nextval('subscription_number_seq')::TEXT, 6, '0')),
    -- quotation_number: customer-facing reference, set when status→'quotation'
    quotation_number      TEXT          UNIQUE,
    customer_id           UUID          NOT NULL
                              REFERENCES customers (id) ON DELETE RESTRICT,
    plan_id               UUID          NOT NULL
                              REFERENCES plans (id) ON DELETE RESTRICT,
    quotation_template_id UUID
                              REFERENCES quotation_templates (id) ON DELETE SET NULL,
    payment_terms_id      UUID
                              REFERENCES payment_terms (id) ON DELETE SET NULL,
    -- status: 'draft'|'quotation'|'confirmed'|'active'|'paused'|'closed'
    status                TEXT          NOT NULL DEFAULT 'draft'
                              CHECK (status IN (
                                  'draft', 'quotation', 'confirmed',
                                  'active', 'paused', 'closed'
                              )),
    -- quantity: units subscribed (e.g. seats, licences)
    quantity              NUMERIC(12,4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
    start_date            DATE          NOT NULL,
    end_date              DATE,                       -- NULL = open-ended
    trial_end_date        DATE,
    next_billing_date     DATE,
    -- Lifecycle timestamps
    confirmed_at          TIMESTAMPTZ,
    paused_at             TIMESTAMPTZ,
    pause_reason          TEXT,
    closed_at             TIMESTAMPTZ,
    close_reason          TEXT,
    -- Pricing snapshot at creation / last renewal
    unit_price            NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
    discount_amount       NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (discount_amount >= 0),
    tax_amount            NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (tax_amount >= 0),
    total_amount          NUMERIC(14,2) NOT NULL CHECK (total_amount >= 0),
    currency              TEXT          NOT NULL DEFAULT 'INR'
                              CHECK (char_length(currency) = 3),
    auto_renew            BOOLEAN       NOT NULL DEFAULT TRUE,
    notes                 TEXT,
    -- created_by references Supabase Auth (auth.users), NOT a custom users table
    created_by            UUID
                              REFERENCES auth.users (id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_customer_id         ON subscriptions (customer_id);
CREATE INDEX IF NOT EXISTS idx_sub_plan_id             ON subscriptions (plan_id);
CREATE INDEX IF NOT EXISTS idx_sub_status              ON subscriptions (status);
CREATE INDEX IF NOT EXISTS idx_sub_next_billing_date   ON subscriptions (next_billing_date);
CREATE INDEX IF NOT EXISTS idx_sub_payment_terms_id    ON subscriptions (payment_terms_id);
CREATE INDEX IF NOT EXISTS idx_sub_quotation_tmpl_id   ON subscriptions (quotation_template_id);
CREATE INDEX IF NOT EXISTS idx_sub_created_by          ON subscriptions (created_by);
-- Partial index for fast billing queries — only active/confirmed subscriptions
CREATE INDEX IF NOT EXISTS idx_sub_active
    ON subscriptions (customer_id, next_billing_date)
    WHERE status IN ('active', 'confirmed');

-- =============================================================================
-- 3. subscription_lines
--    Per-product line items within a subscription.
--    References variants(id) [the live table name], NOT product_variants.
-- =============================================================================
CREATE TABLE IF NOT EXISTS subscription_lines (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID          NOT NULL
                        REFERENCES subscriptions (id) ON DELETE CASCADE,
    product_id      UUID
                        REFERENCES products (id) ON DELETE SET NULL,
    -- variant_id references the live 'variants' table (NOT product_variants)
    variant_id      UUID
                        REFERENCES variants (id) ON DELETE SET NULL,
    sequence        INTEGER       NOT NULL DEFAULT 10,
    description     TEXT          NOT NULL,
    quantity        NUMERIC(12,4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price      NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
    discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0.00
                        CHECK (discount_percent BETWEEN 0 AND 100),
    discount_amount NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (discount_amount >= 0),
    tax_id          UUID
                        REFERENCES taxes (id) ON DELETE SET NULL,
    tax_amount      NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (tax_amount >= 0),
    -- subtotal = quantity * unit_price  (before discount and tax)
    subtotal        NUMERIC(14,2) NOT NULL CHECK (subtotal >= 0),
    -- line_total = subtotal - discount_amount + tax_amount
    line_total      NUMERIC(14,2) NOT NULL CHECK (line_total >= 0),
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sublines_subscription_id ON subscription_lines (subscription_id);
CREATE INDEX IF NOT EXISTS idx_sublines_product_id      ON subscription_lines (product_id);
CREATE INDEX IF NOT EXISTS idx_sublines_variant_id      ON subscription_lines (variant_id);
CREATE INDEX IF NOT EXISTS idx_sublines_tax_id          ON subscription_lines (tax_id);
CREATE INDEX IF NOT EXISTS idx_sublines_sequence        ON subscription_lines (subscription_id, sequence);

-- =============================================================================
-- 4. subscription_status_history
--    Append-only audit log of every status transition.
--    from_status IS NULL on initial creation record.
-- =============================================================================
CREATE TABLE IF NOT EXISTS subscription_status_history (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID        NOT NULL
                        REFERENCES subscriptions (id) ON DELETE CASCADE,
    from_status     TEXT,                   -- NULL = initial creation
    to_status       TEXT        NOT NULL,
    -- changed_by references Supabase Auth (auth.users)
    changed_by      UUID
                        REFERENCES auth.users (id) ON DELETE SET NULL,
    reason          TEXT,
    -- metadata: extra context e.g. {"payment_id": "...", "trigger": "auto_close"}
    metadata        JSONB       NOT NULL DEFAULT '{}',
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ssh_subscription_id ON subscription_status_history (subscription_id);
CREATE INDEX IF NOT EXISTS idx_ssh_changed_at      ON subscription_status_history (changed_at);
CREATE INDEX IF NOT EXISTS idx_ssh_changed_by      ON subscription_status_history (changed_by);

-- =============================================================================
-- 5. subscription_discounts
--    Records which discounts from the existing 'discounts' table have been
--    applied to a subscription, with a snapshot of the amount.
-- =============================================================================
CREATE TABLE IF NOT EXISTS subscription_discounts (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID          NOT NULL
                        REFERENCES subscriptions (id) ON DELETE CASCADE,
    discount_id     UUID          NOT NULL
                        REFERENCES discounts (id) ON DELETE RESTRICT,
    -- applied_amount: snapshot of discount value at time of application
    applied_amount  NUMERIC(14,2) NOT NULL CHECK (applied_amount >= 0),
    applied_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    applied_by      UUID
                        REFERENCES auth.users (id) ON DELETE SET NULL,
    notes           TEXT,
    UNIQUE (subscription_id, discount_id)
);

CREATE INDEX IF NOT EXISTS idx_subdis_subscription_id ON subscription_discounts (subscription_id);
CREATE INDEX IF NOT EXISTS idx_subdis_discount_id     ON subscription_discounts (discount_id);
CREATE INDEX IF NOT EXISTS idx_subdis_applied_by      ON subscription_discounts (applied_by);

-- =============================================================================
-- 6. invoices
--    Billing documents generated from subscriptions (or ad-hoc).
--
--    Duplicate-billing protection
--      A PARTIAL UNIQUE INDEX (not a table constraint) ensures only one live
--      invoice exists per subscription per billing period.  Cancelled/voided
--      invoices are excluded from the index so they can be replaced.
--
--    Tax snapshot columns (tax_name, tax_rate) capture values from the existing
--    'taxes' table at the moment the invoice is issued — protecting historical
--    accuracy if the tax rule is later edited.
--
--    discount_id references the existing 'discounts' table for invoice-level
--    discounts; line-level discounts live in invoice_lines.
-- =============================================================================
CREATE TABLE IF NOT EXISTS invoices (
    id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    -- invoice_number: auto-generated display reference, globally unique
    invoice_number       TEXT          NOT NULL UNIQUE
                             DEFAULT ('INV-' || LPAD(nextval('invoice_number_seq')::TEXT, 6, '0')),
    subscription_id      UUID
                             REFERENCES subscriptions (id) ON DELETE SET NULL,
    customer_id          UUID          NOT NULL
                             REFERENCES customers (id) ON DELETE RESTRICT,
    payment_terms_id     UUID
                             REFERENCES payment_terms (id) ON DELETE SET NULL,
    -- Invoice-level discount from the existing discounts table
    discount_id          UUID
                             REFERENCES discounts (id) ON DELETE SET NULL,
    -- status: 'draft'|'sent'|'partial'|'paid'|'overdue'|'void'|'cancelled'
    status               TEXT          NOT NULL DEFAULT 'draft'
                             CHECK (status IN (
                                 'draft', 'sent', 'partial', 'paid',
                                 'overdue', 'void', 'cancelled'
                             )),
    issue_date           DATE          NOT NULL DEFAULT CURRENT_DATE,
    due_date             DATE          NOT NULL,
    billing_period_start DATE,
    billing_period_end   DATE,
    -- Money columns
    subtotal             NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (subtotal >= 0),
    discount_amount      NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (discount_amount >= 0),
    tax_amount           NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (tax_amount >= 0),
    total_amount         NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (total_amount >= 0),
    amount_paid          NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (amount_paid >= 0),
    -- amount_due: generated column — always equals total_amount - amount_paid
    amount_due           NUMERIC(14,2) GENERATED ALWAYS AS (total_amount - amount_paid) STORED,
    currency             TEXT          NOT NULL DEFAULT 'INR'
                             CHECK (char_length(currency) = 3),
    -- Tax snapshot at invoice issue time (mirrors tax_engine.py output)
    tax_name             TEXT,         -- e.g. "GST 18%" — copied from taxes.name at issue time
    tax_rate             NUMERIC(5,2), -- e.g. 18.00   — copied from taxes.rate at issue time
    notes                TEXT,
    terms_and_conditions TEXT,
    sent_at              TIMESTAMPTZ,
    paid_at              TIMESTAMPTZ,
    voided_at            TIMESTAMPTZ,
    created_by           UUID
                             REFERENCES auth.users (id) ON DELETE SET NULL,
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_subscription_id  ON invoices (subscription_id);
CREATE INDEX IF NOT EXISTS idx_inv_customer_id      ON invoices (customer_id);
CREATE INDEX IF NOT EXISTS idx_inv_status           ON invoices (status);
CREATE INDEX IF NOT EXISTS idx_inv_due_date         ON invoices (due_date);
CREATE INDEX IF NOT EXISTS idx_inv_issue_date       ON invoices (issue_date);
CREATE INDEX IF NOT EXISTS idx_inv_payment_terms_id ON invoices (payment_terms_id);
CREATE INDEX IF NOT EXISTS idx_inv_discount_id      ON invoices (discount_id);
CREATE INDEX IF NOT EXISTS idx_inv_created_by       ON invoices (created_by);

-- Partial unique index: one LIVE invoice per subscription per billing period.
-- Cancelled and voided invoices are excluded → they can be replaced by a new invoice.
CREATE UNIQUE INDEX IF NOT EXISTS uix_invoice_live_period
    ON invoices (subscription_id, billing_period_start, billing_period_end)
    WHERE status NOT IN ('cancelled', 'void')
      AND subscription_id      IS NOT NULL
      AND billing_period_start IS NOT NULL
      AND billing_period_end   IS NOT NULL;

-- Partial index: fast open-invoice queries (dunning, portal, overdue alerts)
CREATE INDEX IF NOT EXISTS idx_inv_open
    ON invoices (customer_id, due_date)
    WHERE status NOT IN ('void', 'cancelled', 'paid');

-- =============================================================================
-- 7. invoice_lines
--    Individual line items on an invoice.
--    variant_id references the live 'variants' table (NOT product_variants).
--    tax_name / tax_rate are point-in-time snapshots from taxes at issue time.
-- =============================================================================
CREATE TABLE IF NOT EXISTS invoice_lines (
    id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id           UUID          NOT NULL
                             REFERENCES invoices (id) ON DELETE CASCADE,
    -- subscription_line_id: traceability back to the originating subscription line
    subscription_line_id UUID
                             REFERENCES subscription_lines (id) ON DELETE SET NULL,
    product_id           UUID
                             REFERENCES products (id) ON DELETE SET NULL,
    -- variant_id references the live 'variants' table (NOT product_variants)
    variant_id           UUID
                             REFERENCES variants (id) ON DELETE SET NULL,
    sequence             INTEGER       NOT NULL DEFAULT 10,
    description          TEXT          NOT NULL,
    quantity             NUMERIC(12,4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price           NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
    discount_percent     NUMERIC(5,2)  NOT NULL DEFAULT 0.00
                             CHECK (discount_percent BETWEEN 0 AND 100),
    discount_amount      NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (discount_amount >= 0),
    -- Tax FK + snapshot (copied at invoice creation time)
    tax_id               UUID
                             REFERENCES taxes (id) ON DELETE SET NULL,
    tax_name             TEXT,         -- snapshot of taxes.name at invoice creation time
    tax_rate             NUMERIC(5,2), -- snapshot of taxes.rate at invoice creation time
    tax_amount           NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (tax_amount >= 0),
    -- subtotal = quantity * unit_price  (before discount and tax)
    subtotal             NUMERIC(14,2) NOT NULL CHECK (subtotal >= 0),
    -- line_total = subtotal - discount_amount + tax_amount
    line_total           NUMERIC(14,2) NOT NULL CHECK (line_total >= 0),
    created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invlines_invoice_id           ON invoice_lines (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invlines_product_id           ON invoice_lines (product_id);
CREATE INDEX IF NOT EXISTS idx_invlines_variant_id           ON invoice_lines (variant_id);
CREATE INDEX IF NOT EXISTS idx_invlines_subscription_line_id ON invoice_lines (subscription_line_id);
CREATE INDEX IF NOT EXISTS idx_invlines_tax_id               ON invoice_lines (tax_id);
CREATE INDEX IF NOT EXISTS idx_invlines_sequence             ON invoice_lines (invoice_id, sequence);

-- =============================================================================
-- 8. payments
--    Payment records against invoices (manual entry or gateway-captured).
-- =============================================================================
CREATE TABLE IF NOT EXISTS payments (
    id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_reference  TEXT          NOT NULL UNIQUE, -- internal ref / gateway txn id
    invoice_id         UUID          NOT NULL
                           REFERENCES invoices (id) ON DELETE RESTRICT,
    customer_id        UUID          NOT NULL
                           REFERENCES customers (id) ON DELETE RESTRICT,
    -- method: payment channel
    method             TEXT          NOT NULL DEFAULT 'bank_transfer'
                           CHECK (method IN (
                               'bank_transfer', 'credit_card', 'upi',
                               'cash', 'cheque', 'other'
                           )),
    -- status: payment lifecycle
    status             TEXT          NOT NULL DEFAULT 'pending'
                           CHECK (status IN (
                               'pending', 'completed', 'failed',
                               'refunded', 'partially_refunded'
                           )),
    amount             NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    currency           TEXT          NOT NULL DEFAULT 'INR'
                           CHECK (char_length(currency) = 3),
    payment_date       DATE          NOT NULL DEFAULT CURRENT_DATE,
    -- Gateway fields
    gateway            TEXT,                     -- 'razorpay' | 'stripe' | 'manual' | etc.
    gateway_payment_id TEXT,                     -- gateway's own transaction ID
    gateway_response   JSONB         NOT NULL DEFAULT '{}',
    -- Refund tracking
    refunded_amount    NUMERIC(14,2) NOT NULL DEFAULT 0.00 CHECK (refunded_amount >= 0),
    refunded_at        TIMESTAMPTZ,
    notes              TEXT,
    recorded_by        UUID
                           REFERENCES auth.users (id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CHECK (refunded_amount <= amount)
);

CREATE INDEX IF NOT EXISTS idx_pay_invoice_id          ON payments (invoice_id);
CREATE INDEX IF NOT EXISTS idx_pay_customer_id         ON payments (customer_id);
CREATE INDEX IF NOT EXISTS idx_pay_status              ON payments (status);
CREATE INDEX IF NOT EXISTS idx_pay_payment_date        ON payments (payment_date);
CREATE INDEX IF NOT EXISTS idx_pay_gateway_payment_id  ON payments (gateway_payment_id);
CREATE INDEX IF NOT EXISTS idx_pay_recorded_by         ON payments (recorded_by);

-- =============================================================================
-- 9. discount_usages
--    Per-redemption audit trail.  At least one of subscription_id / invoice_id
--    must be set.  Application code increments discounts.times_used on INSERT.
-- =============================================================================
CREATE TABLE IF NOT EXISTS discount_usages (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    discount_id     UUID          NOT NULL
                        REFERENCES discounts (id) ON DELETE RESTRICT,
    customer_id     UUID          NOT NULL
                        REFERENCES customers (id) ON DELETE RESTRICT,
    subscription_id UUID
                        REFERENCES subscriptions (id) ON DELETE SET NULL,
    invoice_id      UUID
                        REFERENCES invoices (id) ON DELETE SET NULL,
    applied_amount  NUMERIC(14,2) NOT NULL CHECK (applied_amount >= 0),
    used_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    -- Ensure every usage is tied to at least one financial document
    CONSTRAINT chk_usage_has_context
        CHECK (subscription_id IS NOT NULL OR invoice_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_du_discount_id     ON discount_usages (discount_id);
CREATE INDEX IF NOT EXISTS idx_du_customer_id     ON discount_usages (customer_id);
CREATE INDEX IF NOT EXISTS idx_du_subscription_id ON discount_usages (subscription_id);
CREATE INDEX IF NOT EXISTS idx_du_invoice_id      ON discount_usages (invoice_id);
CREATE INDEX IF NOT EXISTS idx_du_used_at         ON discount_usages (used_at);

-- =============================================================================
-- ROW LEVEL SECURITY
-- Enabled on all 9 new public tables.
-- NO policies are created here — the FastAPI service role uses BYPASSRLS.
-- Add explicit CREATE POLICY statements in a separate migration file
-- only when direct PostgREST/client-SDK access is required.
-- =============================================================================
ALTER TABLE payment_terms               ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_lines          ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_discounts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines               ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE discount_usages             ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Table comments
-- =============================================================================
COMMENT ON TABLE payment_terms
    IS 'Named payment conditions (Net-30, Due on Receipt, etc.) — new table, not in existing 9';
COMMENT ON TABLE subscriptions
    IS 'Core subscription lifecycle; draft→quotation→confirmed→active→paused→closed';
COMMENT ON COLUMN subscriptions.subscription_number
    IS 'Auto-generated staff-facing reference: SUB-000100';
COMMENT ON COLUMN subscriptions.quotation_number
    IS 'Customer-facing quotation reference; set on transition to quotation status';
COMMENT ON COLUMN subscriptions.created_by
    IS 'References auth.users(id) — Supabase Auth identity';
COMMENT ON TABLE subscription_lines
    IS 'Per-product line items within a subscription; variant_id→variants(id)';
COMMENT ON COLUMN subscription_lines.variant_id
    IS 'References the live variants table — NOT product_variants';
COMMENT ON TABLE subscription_status_history
    IS 'Append-only audit log of every subscription status transition';
COMMENT ON TABLE subscription_discounts
    IS 'Discounts (from existing discounts table) applied to subscriptions';
COMMENT ON TABLE invoices
    IS 'Billing documents; uix_invoice_live_period prevents duplicate live periods';
COMMENT ON COLUMN invoices.amount_due
    IS 'Generated column: total_amount - amount_paid';
COMMENT ON COLUMN invoices.invoice_number
    IS 'Auto-generated from invoice_number_seq: INV-001000';
COMMENT ON COLUMN invoices.tax_name
    IS 'Snapshot of taxes.name at invoice issue time — historical accuracy';
COMMENT ON COLUMN invoices.tax_rate
    IS 'Snapshot of taxes.rate (%) at invoice issue time';
COMMENT ON TABLE invoice_lines
    IS 'Invoice line items; tax_name/tax_rate are point-in-time snapshots; variant_id→variants(id)';
COMMENT ON TABLE payments
    IS 'Payment records against invoices; gateway_response stores raw gateway JSON';
COMMENT ON TABLE discount_usages
    IS 'Per-redemption audit trail; application code must increment discounts.times_used on INSERT';

-- =============================================================================
-- DEPENDENCY REPORT — Missing columns / unresolved conflicts
--
-- The items below describe gaps between what database/schema.sql assumes and
-- what the live Supabase database actually contains.  None of these issues
-- are fixed by this file.  Each requires a deliberate ALTER TABLE migration
-- coordinated with the relevant table owner.
--
-- ── CONFIRMED COLUMN-NAME MISMATCHES ─────────────────────────────────────────
--
-- 1. products.price  vs  schema.sql assumption products.sales_price
--    The existing products table uses the column name 'price'.
--    schema.sql assumes 'sales_price'.  Any code that reads products.sales_price
--    will error.  Resolution: add 'sales_price' as an alias/computed column via
--    ALTER TABLE products ADD COLUMN sales_price NUMERIC(14,2) GENERATED ALWAYS AS (price) STORED;
--    or rename in a coordinated migration.
--
-- 2. plans.interval  vs  schema.sql assumption plans.billing_interval
--    The existing plans table uses 'interval'.  schema.sql assumes 'billing_interval'.
--    Resolution: ALTER TABLE plans ADD COLUMN billing_interval INTEGER ... or rename.
--
-- 3. variants (table name)  vs  schema.sql assumption product_variants
--    The live table is named 'variants'.  schema.sql references 'product_variants'.
--    remaining_schema.sql correctly references 'variants'; schema.sql is wrong.
--    Resolution: no action needed here — remaining_schema.sql uses the correct name.
--    Update schema.sql comments/views accordingly.
--
-- 4. customers.auth_user_id  vs  schema.sql assumption customers.user_id
--    The existing column is 'auth_user_id'.  schema.sql assumes 'user_id'.
--    Resolution: ALTER TABLE customers ADD COLUMN user_id UUID GENERATED ALWAYS AS (auth_user_id) STORED;
--    or rename.
--
-- 5. quotation_template_lines.template_id  vs  schema.sql assumption .quotation_template_id
--    The existing column is 'template_id'.  schema.sql assumes 'quotation_template_id'.
--    Resolution: coordinate with the quotation_template_lines owner.
--
-- ── UNKNOWN EXISTING-TABLE COLUMNS (structure not shared with this author) ────
--
-- 6. discounts — column names unknown beyond 'id'.
--    schema.sql assumes: code (CITEXT), type, value, is_active, start_date,
--    end_date, usage_limit, times_used, min_quantity, min_purchase, scope, plan_id.
--    If the live table is missing these, discount_engine.py will fail.
--    Action needed: share discounts table DDL with backend core (Aadya).
--
-- 7. taxes — column names unknown beyond 'id'.
--    schema.sql and tax_engine.py assume: name (TEXT), rate (NUMERIC).
--    Action needed: share taxes table DDL with backend core.
--
-- 8. plans — columns unknown beyond 'id' and 'interval'.
--    schema.sql assumes: billing_cycle, billing_interval, min_quantity,
--    auto_close, allow_pause, allow_early_close, renewal_type, price, setup_fee,
--    trial_days, features, etc.
--    Action needed: share plans table DDL with backend core.
--
-- 9. products — columns unknown beyond 'id' and 'price'.
--    schema.sql assumes: sales_price (→ price), cost_price, code, product_type,
--    unit_of_measure, tax_id, etc.
--    Action needed: share products table DDL with backend core.
--
-- 10. variants — columns unknown beyond 'id' and 'extra_price'.
--    schema.sql assumes: price_extra (→ extra_price), price_override, product_id,
--    code, attributes, etc.
--    Action needed: share variants table DDL with backend core.
--
-- ── TABLES IN schema.sql THAT DO NOT APPLY TO THE LIVE DB ────────────────────
--
-- 11. public.users (in schema.sql) — DOES NOT EXIST and MUST NOT be created.
--    The live database uses auth.users (Supabase Auth schema) for identity.
--    All user-identity FK columns in remaining_schema.sql correctly reference
--    auth.users(id) instead.
--    Action: remove or mark the users table in schema.sql as non-applicable.
--
-- ── VIEWS IN schema.sql — NOT INCLUDED IN remaining_schema.sql ───────────────
--
-- 12. vw_quotations, vw_invoice_balances, vw_subscription_summary
--    These views were defined in schema.sql but are NOT included here because
--    they reference column names from existing tables (e.g. customers.contact_name,
--    plans.billing_cycle, plans.billing_interval) whose existence in the live DB
--    is unconfirmed.  Create them in a separate migration file once the existing
--    table structures are verified.
--
-- ── CHANGE_REQUESTS TABLE ──────────────────────────────────────────────────────
--
-- 13. change_requests — exists in the live DB but is completely absent from
--    schema.sql.  Its structure, purpose, and FK relationships are unknown.
--    It may reference customers, plans, subscriptions, or discounts.
--    Action: share change_requests DDL with backend core (Aadya).
-- =============================================================================

