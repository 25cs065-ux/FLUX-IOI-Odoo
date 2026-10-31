"""READ-ONLY check that the live Supabase tables have every column the
Subscriptions / Invoices / Payments code reads or writes.

    cd backend
    ./venv/Scripts/python scripts/verify_live_schema.py

Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY)
in the environment or .env. For each table it runs
`select <columns> limit 0`: no rows are read or written and no data is
printed. Credentials are never printed either.

PostgREST cannot show indexes, defaults or generated columns. Run the SQL at
the bottom of this file in the Supabase SQL editor (also read-only) for those.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "tests")]

from schema_utils import load_schema  # noqa: E402

OWN_TABLES = ["payment_terms", "subscriptions", "subscription_lines", "subscription_status_history",
              "invoices", "invoice_lines", "payments"]

# Columns of teammates' tables that the billing code relies on.
EXTERNAL_COLUMNS = {
    "customers": ["id", "auth_user_id", "is_active"],
    "plans": ["id", "name", "interval", "price", "min_quantity", "is_active",
              "pausable", "closable_early", "renewable"],
    "products": ["id", "name", "price", "is_active"],
    "variants": ["id", "product_id", "name", "extra_price", "is_active"],
    "taxes": ["id", "name", "rate", "is_active"],
    "quotation_templates": ["id", "is_active"],
}


def check(client, table: str, columns: list[str]) -> list[str]:
    """Returns problems; tries columns one by one only if the batch fails."""
    try:
        client.table(table).select(",".join(columns)).limit(0).execute()
        return []
    except Exception as exc:
        batch_error = getattr(exc, "message", None) or type(exc).__name__
    problems = []
    for column in columns:
        try:
            client.table(table).select(column).limit(0).execute()
        except Exception as exc:
            problems.append(f"{column}: {getattr(exc, 'message', None) or type(exc).__name__}")
    return problems or [f"table-level error: {batch_error}"]


def main() -> int:
    from app.core.database import get_supabase

    try:
        client = get_supabase()
    except RuntimeError as exc:
        print(f"Cannot connect: {exc}")
        return 2

    schema = load_schema()
    targets = {t: sorted(schema[t].columns) for t in OWN_TABLES}
    targets.update(EXTERNAL_COLUMNS)
    failed = False
    for table, columns in targets.items():
        problems = check(client, table, columns)
        failed |= bool(problems)
        print(f"{'OK  ' if not problems else 'FAIL'} {table} ({len(columns)} columns)")
        for problem in problems:
            print(f"       - {problem}")
    print("\nAll columns present." if not failed else "\nMismatches found; see above.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())


# ---------------------------------------------------------------------------
# Read-only SQL for the Supabase SQL editor (things PostgREST cannot show):
#
# -- 1. Duplicate-billing guard exists and is partial/unique
# select indexname, indexdef from pg_indexes
#  where tablename = 'invoices' and indexname = 'uix_invoice_live_period';
#
# -- 2. amount_due is a generated column; number defaults use the sequences
# select table_name, column_name, is_generated, column_default
#   from information_schema.columns
#  where (table_name, column_name) in (('invoices','amount_due'), ('invoices','invoice_number'),
#                                      ('subscriptions','subscription_number'));
#
# -- 3. payment_reference is unique
# select conname, pg_get_constraintdef(oid) from pg_constraint
#  where conrelid = 'public.payments'::regclass and contype = 'u';
#
# -- 4. Distinct plan intervals in real data (code supports daily/weekly/monthly/yearly)
# select interval, count(*) from plans group by interval;
#
# -- 5. Roles available to the shared auth (customers.role)
# select role, count(*) from customers group by role;
# ---------------------------------------------------------------------------
