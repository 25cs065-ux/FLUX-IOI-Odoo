"""Brightloop demo seed.

    python database/seed/seed_data.py [--small] [--cleanup | --append]

Safeguards
  * Every Supabase call is retried up to 5 times with exponential backoff
    (0.5s, 1s, 2s, 4s between attempts).
  * Rows are written in batches of 50, and long id lists are sent 50 at a time.
  * Row ids are generated here and written with upsert(ignore_duplicates), so a
    retried batch that had in fact reached the database is not written twice.
  * Refuses to run when seeded customers already exist, unless --cleanup (remove
    the previous seed first) or --append is given. Taxes, products and plans are
    reused by name instead of being created again.
  * Subscriptions are written together with their lines, and invoices together
    with their lines and payments. If a batch's children cannot be written, the
    rows that batch wrote are removed again and the run stops with a summary,
    so no subscription is left without lines and no invoice without lines.
  * Each invoice and payment uses the customer of the invoice's subscription.
"""
import argparse
import json
import os
import sys
import time
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal

from dotenv import load_dotenv
from faker import Faker

# =====================================================================
# CONFIGURATION & FLAGS
# =====================================================================
SMALL = False
CLEANUP_PREVIOUS_SEED_DATA = False

SEED_EMAIL_DOMAIN = "@brightloop.example.com"
BATCH_SIZE = 50
MAX_ATTEMPTS = 5
BASE_DELAY_SECONDS = 0.5

script_dir = os.path.dirname(os.path.abspath(__file__))
env_path = os.path.join(script_dir, "..", "..", ".env")

STAFF_USERS = [
    ("admin", "admin@brightloop.example.com"),
    ("staff", "staff1@brightloop.example.com"),
    ("staff", "staff2@brightloop.example.com"),
]


class SeedError(RuntimeError):
    pass


def get_client():
    from supabase import create_client

    load_dotenv(dotenv_path=env_path)
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise ValueError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env file.")
    return create_client(url, key)


def with_retry(action, what, *, attempts=MAX_ATTEMPTS, base_delay=BASE_DELAY_SECONDS, sleep=time.sleep):
    """Run action(); on an exception wait base_delay * 2**n and try again, up to `attempts` times."""
    for attempt in range(1, attempts + 1):
        try:
            return action()
        except Exception as exc:
            if attempt == attempts:
                raise SeedError(f"{what} failed after {attempts} attempts: {exc}") from exc
            delay = base_delay * 2 ** (attempt - 1)
            print(f"  {what} failed (attempt {attempt}/{attempts}): {exc}. Retrying in {delay:g}s")
            sleep(delay)


def chunks(items, size=BATCH_SIZE):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def new_id() -> str:
    return str(uuid.uuid4())


class Seeder:
    def __init__(self, db, *, batch_size=BATCH_SIZE, sleep=time.sleep, today=None, fake=None):
        self.db = db
        self.batch_size = batch_size
        self.sleep = sleep
        self.today = today or date.today()
        self.fake = fake or Faker("en_IN")
        self.written = {}          # table -> ids this run wrote (for the failure summary)
        self.auth_user_ids = []    # auth users this run created

    # ------------------------------------------------------------- helpers
    def retry(self, action, what):
        return with_retry(action, what, sleep=self.sleep)

    def days_ago(self, days: int) -> str:
        return (self.today - timedelta(days=days)).isoformat()

    def select_all(self, build_query, what):
        """Read every row of a query, 1000 at a time (PostgREST caps each response)."""
        rows, offset = [], 0
        while True:
            page = self.retry(lambda o=offset: build_query().range(o, o + 999).execute(), what).data or []
            rows += page
            if len(page) < 1000:
                return rows
            offset += 1000

    def write(self, table, rows):
        """Insert rows (each carrying its own id) in batches; retries never duplicate a row."""
        for batch in chunks(rows, self.batch_size):
            self.retry(
                lambda b=batch: self.db.table(table)
                .upsert(b, on_conflict="id", ignore_duplicates=True, default_to_null=False)
                .execute(),
                f"insert {len(batch)} {table}",
            )
            self.written.setdefault(table, []).extend(row["id"] for row in batch)

    def delete_where_in(self, table, column, values):
        for batch in chunks(list(values), self.batch_size):
            self.retry(lambda b=batch: self.db.table(table).delete().in_(column, b).execute(),
                       f"delete {len(batch)} {table}")

    def remove_written(self, table, ids):
        self.delete_where_in(table, "id", ids)
        removed = set(ids)
        self.written[table] = [i for i in self.written.get(table, []) if i not in removed]

    def write_with_children(self, parent_table, parents, children):
        """Write parents in batches, each followed by its children.

        children: [(table, rows, parent_key)]. If a batch's children cannot be
        written, the rows that batch wrote are removed and SeedError is raised.
        """
        for batch in chunks(parents, self.batch_size):
            ids = {row["id"] for row in batch}
            self.write(parent_table, batch)
            before = {table: len(self.written.get(table, [])) for table, _, _ in children}
            try:
                for table, rows, key in children:
                    self.write(table, [row for row in rows if row[key] in ids])
            except SeedError as exc:
                print(f"  Removing the {len(ids)} {parent_table} of the failed batch: {exc}")
                for table, _, _ in reversed(children):
                    self.remove_written(table, self.written.get(table, [])[before[table]:])
                self.remove_written(parent_table, list(ids))
                raise

    # ------------------------------------------------------------- auth
    def list_auth_users(self):
        users, page = [], 1
        while True:
            batch = self.retry(lambda p=page: self.db.auth.admin.list_users(page=p, per_page=1000),
                               "list auth users") or []
            users += batch
            if len(batch) < 1000:
                return users
            page += 1

    def find_auth_user(self, email):
        return next((u for u in self.list_auth_users() if (u.email or "").lower() == email.lower()), None)

    def create_auth_user(self, attributes):
        """Create an auth user; if a retried create had already succeeded, reuse that user."""
        email = attributes["email"]

        def create():
            try:
                return self.db.auth.admin.create_user(attributes).user
            except Exception as exc:
                if "already" in str(exc).lower():
                    existing = self.find_auth_user(email)
                    if existing:
                        return existing
                raise

        return self.retry(create, f"create auth user {email}")

    def create_or_update_staff_users(self):
        print("Checking admin and staff accounts...")
        existing = {(u.email or "").lower(): u for u in self.list_auth_users()}
        for role, email in STAFF_USERS:
            user = existing.get(email.lower())
            if user:
                app_metadata = dict(user.app_metadata or {})
                app_metadata["role"] = role
                self.retry(lambda u=user, m=app_metadata: self.db.auth.admin.update_user_by_id(
                    u.id, {"app_metadata": m}), f"update role for {email}")
                print(f"Updated {role} role for {email}")
            else:
                self.create_auth_user({"email": email, "password": "Test@1234", "email_confirm": True,
                                       "app_metadata": {"role": role}})
                print(f"Created {role} account: {email}")

    # ------------------------------------------------------------- guards
    def existing_seed_customer_count(self) -> int:
        res = self.retry(lambda: self.db.table("customers").select("id", count="exact")
                         .ilike("email", f"%{SEED_EMAIL_DOMAIN}").limit(1).execute(),
                         "count seeded customers")
        return res.count or 0

    # ------------------------------------------------------------- cleanup
    def cleanup_seeded_data(self):
        print("Cleaning up previous seeded data...")
        cust_ids = [c["id"] for c in self.select_all(
            lambda: self.db.table("customers").select("id").ilike("email", f"%{SEED_EMAIL_DOMAIN}"),
            "list seeded customers")]

        sub_ids, inv_ids = [], []
        for batch in chunks(cust_ids, self.batch_size):
            sub_ids += [s["id"] for s in self.select_all(
                lambda b=batch: self.db.table("subscriptions").select("id").in_("customer_id", b),
                "list seeded subscriptions")]
        for batch in chunks(sub_ids, self.batch_size):
            inv_ids += [i["id"] for i in self.select_all(
                lambda b=batch: self.db.table("invoices").select("id").in_("subscription_id", b),
                "list seeded invoices")]

        self.delete_where_in("discount_usages", "subscription_id", sub_ids)
        self.delete_where_in("subscription_discounts", "subscription_id", sub_ids)
        self.delete_where_in("subscription_status_history", "subscription_id", sub_ids)
        self.delete_where_in("payments", "invoice_id", inv_ids)
        self.delete_where_in("invoice_lines", "invoice_id", inv_ids)
        self.delete_where_in("invoices", "id", inv_ids)
        self.delete_where_in("subscription_lines", "subscription_id", sub_ids)
        self.delete_where_in("subscriptions", "id", sub_ids)
        self.delete_where_in("customers", "id", cust_ids)

        for table, column, pattern in (("discounts", "code", "SEED_%"), ("taxes", "name", "GST%"),
                                       ("plans", "name", "SeedPlan%"), ("products", "name", "SeedProd%")):
            self.retry(lambda t=table, c=column, p=pattern: self.db.table(t).delete().ilike(c, p).execute(),
                       f"delete seeded {table}")
        print(f"Cleanup completed: {len(cust_ids)} customers, {len(sub_ids)} subscriptions, "
              f"{len(inv_ids)} invoices.")

    # ------------------------------------------------------------- seed steps
    def seed_customers(self, num_customers):
        print(f"Creating {num_customers} customers...")
        customer_ids = []
        for batch in chunks(list(range(num_customers)), self.batch_size):
            rows = []
            for i in batch:
                email = f"customer_{i}_{uuid.uuid4().hex[:6]}{SEED_EMAIL_DOMAIN}"
                user = self.create_auth_user({"email": email, "password": "Test@1234", "email_confirm": True,
                                              "user_metadata": {"role": "customer"}})
                self.auth_user_ids.append(user.id)
                rows.append({"id": new_id(), "auth_user_id": user.id, "name": self.fake.name(), "email": email})
            self.write("customers", rows)
            customer_ids += [row["id"] for row in rows]
        if not customer_ids:
            raise SeedError("No customer accounts were created.")
        return customer_ids

    def get_or_create_by_name(self, table, rows):
        """Return {name: row}, creating only the rows whose name does not exist yet."""
        names = [row["name"] for row in rows]
        existing = {r["name"]: r for r in self.retry(
            lambda: self.db.table(table).select("*").in_("name", names).execute(), f"read {table}").data or []}
        missing = [{"id": new_id(), **row} for row in rows if row["name"] not in existing]
        self.write(table, missing)
        return {**existing, **{row["name"]: row for row in missing}}

    def seed_catalog(self):
        print("Seeding catalog...")
        taxes = self.get_or_create_by_name("taxes", [
            {"name": "GST 18%", "rate": float(Decimal("18.00"))},
            {"name": "GST 5%", "rate": float(Decimal("5.00"))},
        ])
        tax_18_id = taxes["GST 18%"]["id"]

        product_names = [f"SeedProd {i}" for i in range(1, 6)]
        existing_products = {p["name"] for p in self.retry(
            lambda: self.db.table("products").select("name").in_("name", product_names).execute(),
            "read products").data or []}
        new_products = [{"id": new_id(), "name": name,
                         "price": float(self.fake.random_element([999.00, 1999.00, 4999.00, 9999.00]))}
                        for name in product_names if name not in existing_products]
        self.write("products", new_products)
        self.write("variants", [{"id": new_id(), "product_id": p["id"], "name": f"Variant {v + 1}",
                                 "extra_price": float(v * 100.00)}
                                for p in new_products for v in range(2)])

        intervals = ["daily", "weekly", "monthly", "monthly", "yearly", "yearly"]
        plans = self.get_or_create_by_name("plans", [
            {"name": f"SeedPlan {idx + 1} ({interval.capitalize()})", "interval": interval,
             "price": float(self.fake.random_element([499.00, 1999.00, 11999.00]))}
            for idx, interval in enumerate(intervals)
        ])
        plan_ids = [plans[f"SeedPlan {idx + 1} ({interval.capitalize()})"]["id"]
                    for idx, interval in enumerate(intervals)]

        suffix = uuid.uuid4().hex[:6].upper()
        expired, active = self.days_ago(10), (self.today + timedelta(days=30)).isoformat()
        discounts = [
            {"id": new_id(), "code": f"SEED_EXPIRED_{suffix}", "discount_type": "percentage",
             "applies_to": "subscription", "value": 10.0, "is_active": False, "end_date": expired},
            {"id": new_id(), "code": f"SEED_ACTIVE_1_{suffix}", "discount_type": "percentage",
             "applies_to": "subscription", "value": 15.0, "is_active": True, "end_date": active},
            {"id": new_id(), "code": f"SEED_ACTIVE_2_{suffix}", "discount_type": "percentage",
             "applies_to": "subscription", "value": 20.0, "is_active": True, "end_date": active},
        ]
        self.write("discounts", discounts)
        return tax_18_id, plan_ids, discounts[0]["id"]

    def seed_subscriptions(self, num_subs, customer_ids, plan_ids, tax_18_id, expired_discount_id):
        print(f"Creating {num_subs} subscriptions and lines...")
        subs, lines, sub_discounts = [], [], []
        for i in range(num_subs):
            sub_id = new_id()
            subs.append({
                "id": sub_id,
                "customer_id": customer_ids[i % len(customer_ids)],
                "plan_id": plan_ids[i % len(plan_ids)],
                "status": "active" if i < (num_subs - 5) else "confirmed",
                "start_date": self.days_ago(60),
                "next_billing_date": self.today.isoformat(),
                "unit_price": 1000.00,
                "total_amount": 1000.00,
                "currency": "INR",
                "auto_renew": True,
            })
            lines.append({"id": new_id(), "subscription_id": sub_id, "description": "Standard License Line",
                          "quantity": 1, "unit_price": 1000.00, "subtotal": 1000.00, "line_total": 1000.00,
                          "tax_id": tax_18_id, "tax_amount": 180.00})
            if i == 0 and expired_discount_id:
                sub_discounts.append({"id": new_id(), "subscription_id": sub_id,
                                      "discount_id": expired_discount_id, "applied_amount": 100.00})
        self.write_with_children("subscriptions", subs, [
            ("subscription_lines", lines, "subscription_id"),
            ("subscription_discounts", sub_discounts, "subscription_id"),
        ])
        return subs

    def seed_invoices(self, subs, tax_18_id):
        print("Creating past invoices, invoice lines, and payments...")
        past_subs = subs[21:] if len(subs) > 21 else subs[:5]
        invoices, invoice_lines, payments = [], [], []
        for idx, sub in enumerate(past_subs):
            # The invoice and its payment belong to the subscription's own customer.
            cust_id = sub["customer_id"]
            status, due = "paid", self.days_ago(15)
            if idx == 0:
                status, due = "overdue", self.days_ago(5)
            elif idx == 1:
                status = "partial"
            inv_id = new_id()
            invoices.append({
                "id": inv_id,
                "subscription_id": sub["id"],
                "customer_id": cust_id,
                "status": status,
                "issue_date": self.days_ago(30),
                "due_date": due,
                "billing_period_start": self.days_ago(60),
                "billing_period_end": self.days_ago(30),
                "subtotal": 1000.00,
                "tax_amount": 180.00,
                "total_amount": 1180.00,
                "amount_paid": 1180.00 if status == "paid" else 500.00 if status == "partial" else 0.00,
                "currency": "INR",
                "tax_name": "GST 18%",
                "tax_rate": 18.00,
            })
            invoice_lines.append({"id": new_id(), "invoice_id": inv_id, "description": "Past Period Billing Line",
                                  "quantity": 1, "unit_price": 1000.00, "subtotal": 1000.00,
                                  "line_total": 1180.00, "tax_id": tax_18_id, "tax_name": "GST 18%",
                                  "tax_rate": 18.00, "tax_amount": 180.00})
            if status in ("paid", "partial"):
                payments.append({
                    "id": new_id(),
                    "payment_reference": f"REF-{inv_id.replace('-', '')[:12].upper()}",
                    "invoice_id": inv_id,
                    "customer_id": cust_id,
                    "method": "upi",
                    "status": "completed",
                    "amount": 500.00 if status == "partial" else 1180.00,
                    "currency": "INR",
                    "payment_date": self.days_ago(30),
                })
        self.write_with_children("invoices", invoices, [
            ("invoice_lines", invoice_lines, "invoice_id"),
            ("payments", payments, "invoice_id"),
        ])
        return invoices

    # ------------------------------------------------------------- run
    def run(self, *, small=SMALL, cleanup=CLEANUP_PREVIOUS_SEED_DATA, append=False,
            num_customers=None, num_subs=None):
        print(f"Starting seed script (SMALL={small})...")
        if cleanup:
            self.cleanup_seeded_data()
        else:
            existing = self.existing_seed_customer_count()
            if existing and not append:
                raise SeedError(
                    f"{existing} seeded customers already exist. Re-run with --cleanup to replace them "
                    "or --append to add another set; nothing was written.")
            print("Cleanup skipped. Existing seeded data will be preserved.")

        self.create_or_update_staff_users()
        customer_ids = self.seed_customers(num_customers or (10 if small else 300))
        tax_18_id, plan_ids, expired_discount_id = self.seed_catalog()
        subs = self.seed_subscriptions(num_subs or (20 if small else 400), customer_ids, plan_ids,
                                       tax_18_id, expired_discount_id)
        invoices = self.seed_invoices(subs, tax_18_id)

        overdue = next((i["id"] for i in invoices if i["status"] == "overdue"), None)
        partial = next((i["id"] for i in invoices if i["status"] == "partial"), None)
        print("\n" + "=" * 50)
        print("SEEDING COMPLETED SUCCESSFULLY!")
        print("=" * 50)
        print(f"1. Overdue invoice ID: {overdue}")
        print(f"2. Partially paid invoice ID: {partial}")
        print(f"3. Active subscription with expired discount ID: {subs[0]['id'] if subs else None}")
        print(f"4. Subscriptions without invoices: {min(20, max(len(subs) - 1, 0))}")
        print("=" * 50)

    def failure_report(self, path):
        """Save the ids this run wrote, so a partial run can be inspected or removed precisely."""
        report = {"written": self.written, "auth_user_ids": self.auth_user_ids}
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=2)
        return report


def main(argv=None):
    parser = argparse.ArgumentParser(description="Seed Brightloop demo data.")
    parser.add_argument("--small", action="store_true", default=SMALL)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--cleanup", action="store_true", default=CLEANUP_PREVIOUS_SEED_DATA,
                       help="remove the previous seed before seeding")
    group.add_argument("--append", action="store_true", help="seed even if seeded customers exist")
    args = parser.parse_args(argv)

    seeder = Seeder(get_client())
    try:
        seeder.run(small=args.small, cleanup=args.cleanup, append=args.append)
    except SeedError as exc:
        path = os.path.abspath(f"seed_partial_{datetime.now():%Y%m%d_%H%M%S}.json")
        report = seeder.failure_report(path)
        print(f"\nSEEDING STOPPED: {exc}")
        print("Rows written before stopping: "
              + (", ".join(f"{t}={len(ids)}" for t, ids in report["written"].items() if ids) or "none"))
        print(f"Their ids were saved to {path}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
