"""Real PostgreSQL for tests: a throwaway local server (pixeltable-pgserver)
loaded with the stand-in teammate tables below, the real
database/remaining_schema.sql and the real billing migration.

NOT the live Supabase database. The teammate tables (customers, plans,
products, variants, taxes, discounts, quotation_templates) are copied from
Vaidehi's migration 001 plus the plan flag columns the billing code reads;
their live shape is still unverified.
"""
import re
import tempfile
from pathlib import Path

import psycopg2
import psycopg2.extras
from psycopg2 import sql

from app.repositories.billing_rpc import (
    SQLSTATE_TO_HTTP,
    UNIQUE_VIOLATION,
    BillingRpcMixin,
    RuleViolation,
    UniqueViolation,
)
from app.repositories.invoice_repository import DEAD_INVOICE_STATUSES, DuplicateInvoiceError
from app.repositories.payment_repository import DuplicatePaymentError

psycopg2.extras.register_uuid()
DATABASE_DIR = Path(__file__).resolve().parents[2] / "database"

PREREQUISITES = """
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE customers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), auth_user_id uuid, name text NOT NULL,
    email text UNIQUE NOT NULL, role text NOT NULL DEFAULT 'customer', is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now());
CREATE TABLE plans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
    interval text NOT NULL CHECK (interval IN ('daily','weekly','monthly','yearly')),
    price numeric(10,2) NOT NULL CHECK (price >= 0), min_quantity int DEFAULT 1,
    start_date date, end_date date, auto_close boolean DEFAULT false, closable_early boolean DEFAULT true,
    pausable boolean DEFAULT true, renewable boolean DEFAULT true, is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now());
CREATE TABLE products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, description text,
    price numeric(10,2) NOT NULL CHECK (price >= 0), is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE TABLE variants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid NOT NULL REFERENCES products(id),
    name text NOT NULL, extra_price numeric(10,2) DEFAULT 0, is_active boolean DEFAULT true);
CREATE TABLE taxes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
    rate numeric(5,2) NOT NULL CHECK (rate BETWEEN 0 AND 100), is_active boolean DEFAULT true);
CREATE TABLE discounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text UNIQUE);
CREATE TABLE quotation_templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, is_active boolean DEFAULT true);
"""

ALL_TABLES = ["discount_usages", "payments", "invoice_lines", "invoices", "subscription_discounts",
              "subscription_status_history", "subscription_lines", "subscriptions", "payment_terms",
              "quotation_templates", "discounts", "taxes", "variants", "products", "plans", "customers",
              "auth.users"]


def _schema_sql() -> str:
    text = (DATABASE_DIR / "remaining_schema.sql").read_text(encoding="utf-8-sig")
    # pgcrypto/citext are not bundled with the test server; gen_random_uuid()
    # is built into PostgreSQL 13+ and citext is not used by these tables.
    return re.sub(r"(?im)^CREATE EXTENSION[^\n]*$", "", text)


def start_server():
    import pixeltable_pgserver

    server = pixeltable_pgserver.get_server(tempfile.mkdtemp(prefix="brightloop_pg_"), cleanup_mode="stop")
    conn = psycopg2.connect(server.get_uri())
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(PREREQUISITES)
        cur.execute(_schema_sql())
        cur.execute((DATABASE_DIR / "migrations" / "20261031_billing_transactions.sql").read_text(encoding="utf-8"))
    conn.close()
    return server


def connect(server, autocommit=True):
    conn = psycopg2.connect(server.get_uri(), cursor_factory=psycopg2.extras.RealDictCursor)
    conn.autocommit = autocommit
    return conn


def truncate_all(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("TRUNCATE " + ", ".join(ALL_TABLES) + " CASCADE")


def _adapt(value):
    return psycopg2.extras.Json(value) if isinstance(value, (dict, list)) else value


def call_pg(conn, name: str, params: dict):
    """Same contract as billing_rpc.call_supabase, over psycopg2."""
    query = sql.SQL("SELECT {}({}) AS result").format(
        sql.Identifier(name),
        sql.SQL(", ").join(sql.SQL("{} => {}").format(sql.Identifier(k), sql.Placeholder(k)) for k in params))
    try:
        with conn.cursor() as cur:
            cur.execute(query, {k: _adapt(v) for k, v in params.items()})
            result = cur.fetchone()["result"]
    except psycopg2.Error as exc:
        if conn.autocommit is False:
            conn.rollback()
        if exc.pgcode in SQLSTATE_TO_HTTP:
            raise RuleViolation(SQLSTATE_TO_HTTP[exc.pgcode], exc.diag.message_primary) from exc
        if exc.pgcode == UNIQUE_VIOLATION:
            raise UniqueViolation(exc.diag.message_primary) from exc
        raise
    return result


class PgRepository(BillingRpcMixin):
    """Implements the full Subscription/Invoice/Payment repository interface
    on a real PostgreSQL connection. transactional=True routes multi-table
    writes through the billing_* functions, exactly like production would with
    BILLING_DB_FUNCTIONS=true."""

    def __init__(self, conn, transactional=True):
        self.conn = conn
        self._transactional = transactional

    @property
    def transactional(self):
        return self._transactional

    def _call_rpc(self, name, params):
        return call_pg(self.conn, name, params)

    # ---- generic helpers
    def _rows(self, query, params=()):
        with self.conn.cursor() as cur:
            cur.execute(query, params)
            return [dict(r) for r in cur.fetchall()] if cur.description else []

    def _one(self, table, column, value):
        rows = self._rows(sql.SQL("SELECT * FROM {} WHERE {} = %s LIMIT 1").format(
            sql.Identifier(table), sql.Identifier(column)), (str(value),))
        return rows[0] if rows else None

    def _insert(self, table, data):
        cols = list(data)
        return self._rows(sql.SQL("INSERT INTO {} ({}) VALUES ({}) RETURNING *").format(
            sql.Identifier(table), sql.SQL(", ").join(map(sql.Identifier, cols)),
            sql.SQL(", ").join(sql.Placeholder() * len(cols))), [_adapt(data[c]) for c in cols])[0]

    def _update(self, table, row_id, data, **expected):
        sets = sql.SQL(", ").join(sql.SQL("{} = %s").format(sql.Identifier(c)) for c in data)
        where = [sql.SQL("id = %s")]
        params = [_adapt(v) for v in data.values()] + [str(row_id)]
        for column, value in expected.items():
            if value is not None:
                where.append(sql.SQL("{} = %s").format(sql.Identifier(column)))
                params.append(str(value))
        rows = self._rows(sql.SQL("UPDATE {} SET {} WHERE {} RETURNING *").format(
            sql.Identifier(table), sets, sql.SQL(" AND ").join(where)), params)
        return rows[0] if rows else None

    # ---- lookups
    def get_customer(self, customer_id): return self._one("customers", "id", customer_id)
    def get_customer_by_auth_user(self, auth_user_id): return self._one("customers", "auth_user_id", auth_user_id)
    def get_plan(self, plan_id): return self._one("plans", "id", plan_id)
    def get_product(self, product_id): return self._one("products", "id", product_id)
    def get_variant(self, variant_id): return self._one("variants", "id", variant_id)
    def get_tax(self, tax_id): return self._one("taxes", "id", tax_id)
    def get_payment_terms(self, payment_terms_id): return self._one("payment_terms", "id", payment_terms_id)
    def get_quotation_template(self, template_id): return self._one("quotation_templates", "id", template_id)

    # ---- subscriptions
    def list_subscriptions(self, *, status, customer_id, plan_id, limit, offset):
        return self._rows("""SELECT * FROM subscriptions WHERE (%(s)s::text IS NULL OR status = %(s)s)
            AND (%(c)s::uuid IS NULL OR customer_id = %(c)s) AND (%(p)s::uuid IS NULL OR plan_id = %(p)s)
            ORDER BY created_at DESC LIMIT %(l)s OFFSET %(o)s""",
                          {"s": status, "c": customer_id and str(customer_id), "p": plan_id and str(plan_id),
                           "l": limit, "o": offset})

    def get_subscription(self, subscription_id): return self._one("subscriptions", "id", subscription_id)
    def insert_subscription(self, data): return self._insert("subscriptions", data)

    def update_subscription(self, subscription_id, data, expected_status=None, expected_updated_at=None):
        return self._update("subscriptions", subscription_id, data,
                            status=expected_status, updated_at=expected_updated_at)

    def delete_subscription(self, subscription_id):
        self._rows("DELETE FROM subscriptions WHERE id = %s", (str(subscription_id),))

    def list_lines(self, subscription_id):
        return self._rows("SELECT * FROM subscription_lines WHERE subscription_id = %s ORDER BY sequence",
                          (str(subscription_id),))

    def insert_lines(self, lines): return [self._insert("subscription_lines", l) for l in lines]

    def delete_lines(self, subscription_id):
        self._rows("DELETE FROM subscription_lines WHERE subscription_id = %s", (str(subscription_id),))

    def delete_lines_by_ids(self, line_ids):
        self._rows("DELETE FROM subscription_lines WHERE id = ANY(%s::uuid[])", ([str(i) for i in line_ids],))

    def insert_history(self, entry): return self._insert("subscription_status_history", entry)

    def list_history(self, subscription_id):
        return self._rows("SELECT * FROM subscription_status_history WHERE subscription_id = %s ORDER BY changed_at",
                          (str(subscription_id),))

    # ---- invoices
    def list_invoices(self, *, status, customer_id, subscription_id, exclude_statuses, limit, offset):
        return self._rows("""SELECT * FROM invoices WHERE (%(s)s::text IS NULL OR status = %(s)s)
            AND (%(c)s::uuid IS NULL OR customer_id = %(c)s) AND (%(sub)s::uuid IS NULL OR subscription_id = %(sub)s)
            AND NOT (status = ANY(%(x)s::text[])) ORDER BY issue_date DESC LIMIT %(l)s OFFSET %(o)s""",
                          {"s": status, "c": customer_id and str(customer_id),
                           "sub": subscription_id and str(subscription_id), "x": list(exclude_statuses),
                           "l": limit, "o": offset})

    def get_invoice(self, invoice_id): return self._one("invoices", "id", invoice_id)

    def find_live_invoice(self, subscription_id, period_start, period_end):
        rows = self._rows("""SELECT * FROM invoices WHERE subscription_id = %s AND billing_period_start = %s
            AND billing_period_end = %s AND NOT (status = ANY(%s::text[])) LIMIT 1""",
                          (str(subscription_id), period_start, period_end, list(DEAD_INVOICE_STATUSES)))
        return rows[0] if rows else None

    def insert_invoice(self, data):
        try:
            return self._insert("invoices", data)
        except psycopg2.errors.UniqueViolation as exc:
            raise DuplicateInvoiceError(str(exc)) from exc

    def update_invoice(self, invoice_id, data, expected_status=None, expected_amount_paid=None,
                       expected_updated_at=None):
        return self._update("invoices", invoice_id, data, status=expected_status,
                            amount_paid=expected_amount_paid, updated_at=expected_updated_at)

    def delete_invoice(self, invoice_id):
        self._rows("DELETE FROM invoices WHERE id = %s", (str(invoice_id),))

    def list_invoice_lines(self, invoice_id):
        return self._rows("SELECT * FROM invoice_lines WHERE invoice_id = %s ORDER BY sequence", (str(invoice_id),))

    def insert_invoice_lines(self, lines): return [self._insert("invoice_lines", l) for l in lines]

    def delete_invoice_lines(self, invoice_id):
        self._rows("DELETE FROM invoice_lines WHERE invoice_id = %s", (str(invoice_id),))

    def delete_invoice_lines_by_ids(self, line_ids):
        self._rows("DELETE FROM invoice_lines WHERE id = ANY(%s::uuid[])", ([str(i) for i in line_ids],))

    def list_billable_subscriptions(self, as_of):
        return self._rows("""SELECT * FROM subscriptions WHERE status = 'active' AND next_billing_date <= %s
            ORDER BY next_billing_date""", (as_of,))

    def list_overdue_candidates(self, as_of):
        return self._rows("SELECT * FROM invoices WHERE status IN ('sent', 'partial') AND due_date < %s", (as_of,))

    def list_invoice_payments(self, invoice_id):
        return self._rows("SELECT * FROM payments WHERE invoice_id = %s ORDER BY created_at", (str(invoice_id),))

    # ---- payments
    def list_payments(self, *, status, invoice_id, customer_id, limit, offset):
        return self._rows("""SELECT * FROM payments WHERE (%(s)s::text IS NULL OR status = %(s)s)
            AND (%(i)s::uuid IS NULL OR invoice_id = %(i)s) AND (%(c)s::uuid IS NULL OR customer_id = %(c)s)
            ORDER BY created_at DESC LIMIT %(l)s OFFSET %(o)s""",
                          {"s": status, "i": invoice_id and str(invoice_id), "c": customer_id and str(customer_id),
                           "l": limit, "o": offset})

    def get_payment(self, payment_id): return self._one("payments", "id", payment_id)
    def get_payment_by_reference(self, reference): return self._one("payments", "payment_reference", reference)

    def find_gateway_payment(self, gateway, gateway_payment_id):
        rows = self._rows("""SELECT * FROM payments WHERE gateway_payment_id = %s
            AND gateway IS NOT DISTINCT FROM %s LIMIT 1""", (gateway_payment_id, gateway))
        return rows[0] if rows else None

    def insert_payment(self, data):
        try:
            return self._insert("payments", data)
        except psycopg2.errors.UniqueViolation as exc:
            raise DuplicatePaymentError(str(exc)) from exc

    def update_payment(self, payment_id, data, expected_status=None, expected_refunded_amount=None):
        return self._update("payments", payment_id, data, status=expected_status,
                            refunded_amount=expected_refunded_amount)
