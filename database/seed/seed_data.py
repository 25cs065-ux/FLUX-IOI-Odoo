import os
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from dotenv import load_dotenv
from faker import Faker
import bcrypt
from supabase import create_client, Client

# =====================================================================
# CONFIGURATION & FLAGS
# =====================================================================
SMALL = False  # When True, create only 10 customers and 20 subscriptions

# Load environment variables from .env relative to script file
script_dir = os.path.dirname(os.path.abspath(__file__))
env_path = os.path.join(script_dir, "..", "..", ".env")
load_dotenv(dotenv_path=env_path)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
    raise ValueError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env file.")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
fake = Faker("en_IN")

SEED_EMAIL_DOMAIN = "@brightloop.example.com"


def batch_insert(table_name: str, rows: list, batch_size: int = 100):
    """Inserts rows into Supabase in batches of 100."""
    if not rows:
        return
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        response = supabase.table(table_name).insert(batch).execute()
        if hasattr(response, "error") and response.error:
            raise Exception(f"Error inserting into {table_name}: {response.error}")


def main():
    print(f"Starting seed script (SMALL={SMALL})...")

    # =====================================================================
    # 0. SAFE TO RE-RUN: DELETE PREVIOUSLY SEEDED ROWS
    # =====================================================================
    print("Cleaning up previous seeded data...")
    seeded_cust_res = (
        supabase.table("customers")
        .select("id")
        .ilike("email", f"%{SEED_EMAIL_DOMAIN}")
        .execute()
    )
    seeded_cust_ids = [c["id"] for c in (seeded_cust_res.data or [])]

    if seeded_cust_ids:
        subs_res = (
            supabase.table("subscriptions")
            .select("id")
            .in_("customer_id", seeded_cust_ids)
            .execute()
        )
        sub_ids = [s["id"] for s in (subs_res.data or [])]

        if sub_ids:
            supabase.table("discount_usages").delete().in_(
                "subscription_id", sub_ids
            ).execute()
            supabase.table("subscription_discounts").delete().in_(
                "subscription_id", sub_ids
            ).execute()
            supabase.table("subscription_status_history").delete().in_(
                "subscription_id", sub_ids
            ).execute()

            inv_res = (
                supabase.table("invoices")
                .select("id")
                .in_("subscription_id", sub_ids)
                .execute()
            )
            inv_ids = [inv["id"] for inv in (inv_res.data or [])]
            if inv_ids:
                supabase.table("payments").delete().in_(
                    "invoice_id", inv_ids
                ).execute()
                supabase.table("invoice_lines").delete().in_(
                    "invoice_id", inv_ids
                ).execute()
                supabase.table("invoices").delete().in_("id", inv_ids).execute()

            supabase.table("subscription_lines").delete().in_(
                "subscription_id", sub_ids
            ).execute()
            supabase.table("subscriptions").delete().in_("id", sub_ids).execute()

        supabase.table("customers").delete().in_("id", seeded_cust_ids).execute()

    supabase.table("discounts").delete().ilike("code", "SEED_%").execute()
    supabase.table("taxes").delete().ilike("name", "GST%").execute()
    supabase.table("plans").delete().ilike("name", "SeedPlan%").execute()
    supabase.table("products").delete().ilike("name", "SeedProd%").execute()

    print("Cleanup completed.")

    # =====================================================================
    # 1. AUTH USERS & CUSTOMERS
    # =====================================================================
    num_customers = 10 if SMALL else 300
    print(f"Creating users and {num_customers} customers...")

    users_to_create = [
        ("admin", "admin@brightloop.example.com"),
        ("staff1", "staff1@brightloop.example.com"),
        ("staff2", "staff2@brightloop.example.com"),
    ]

    for role, email in users_to_create:
        try:
            supabase.auth.admin.create_user({
                "email": email,
                "password": "Test@1234",
                "email_confirm": True,
                "user_metadata": {"role": role}
            })
        except Exception:
            pass  # Already exists

    customer_rows = []
    customer_auth_ids = []
    for i in range(num_customers):
        email = f"customer_{i}_{uuid.uuid4().hex[:6]}{SEED_EMAIL_DOMAIN}"
        try:
            res = supabase.auth.admin.create_user({
                "email": email,
                "password": "Test@1234",
                "email_confirm": True,
                "user_metadata": {"role": "customer"}
            })
            if res.user:
                auth_id = res.user.id
                customer_auth_ids.append(auth_id)
                customer_rows.append({
                    "auth_user_id": auth_id,
                    "name": fake.name(),
                    "email": email,
                    "created_at": datetime.now().isoformat()
                })
        except Exception as e:
            print(f"Skipping user creation for {email}: {e}")

    batch_insert("customers", customer_rows)

    cust_fetch = supabase.table("customers").select("id, auth_user_id").in_("auth_user_id", customer_auth_ids).execute()
    customers_map = {c["auth_user_id"]: c["id"] for c in (cust_fetch.data or [])}
    customer_ids = list(customers_map.values())

    if not customer_ids:
        raise ValueError("No customers were successfully created or fetched.")

    # =====================================================================
    # 2. CATALOG: PRODUCTS, VARIANTS, PLANS, TAXES, DISCOUNTS
    # =====================================================================
    print("Seeding catalog (products, variants, plans, taxes, discounts)...")

    tax_rows = [
        {"name": "GST 18%", "rate": float(Decimal("18.00"))},
        {"name": "GST 5%", "rate": float(Decimal("5.00"))},
    ]
    inserted_taxes = []
    for t in tax_rows:
        res = supabase.table("taxes").insert(t).execute()
        if res.data:
            inserted_taxes.append(res.data[0])

    tax_18_id = inserted_taxes[0]["id"] if len(inserted_taxes) > 0 else None
    tax_5_id = inserted_taxes[1]["id"] if len(inserted_taxes) > 1 else tax_18_id

    for i in range(1, 6):
        res = supabase.table("products").insert({
            "name": f"SeedProd {i} {fake.word().capitalize()}",
            "price": float(fake.random_element([999.00, 1999.00, 4999.00, 9999.00]))
        }).execute()
        if res.data:
            prod = res.data[0]
            for v in range(2):
                supabase.table("variants").insert({
                    "product_id": prod["id"],
                    "name": f"Variant {v+1}",
                    "extra_price": float(v * 100.00)
                }).execute()

    plan_intervals = ["daily", "weekly", "monthly", "monthly", "yearly", "yearly"]
    plans_data = []
    for idx, interval in enumerate(plan_intervals):
        res = supabase.table("plans").insert({
            "name": f"SeedPlan {idx+1} ({interval.capitalize()})",
            "interval": interval,
            "price": float(fake.random_element([499.00, 1999.00, 11999.00]))
        }).execute()
        if res.data:
            plans_data.append(res.data[0])
    plan_ids = [p["id"] for p in plans_data]

    expired_date = (date.today() - timedelta(days=10)).isoformat()
    active_date = (date.today() + timedelta(days=30)).isoformat()

    # Using valid applies_to value ('subscription') and unique suffix for codes
    unique_suffix = uuid.uuid4().hex[:6].upper()
    discount_rows = [
        {
            "code": f"SEED_EXPIRED_{unique_suffix}",
            "discount_type": "percentage",
            "applies_to": "subscription",
            "value": 10.0,
            "is_active": False,
            "end_date": expired_date
        },
        {
            "code": f"SEED_ACTIVE_1_{unique_suffix}",
            "discount_type": "percentage",
            "applies_to": "subscription",
            "value": 15.0,
            "is_active": True,
            "end_date": active_date
        },
        {
            "code": f"SEED_ACTIVE_2_{unique_suffix}",
            "discount_type": "percentage",
            "applies_to": "subscription",
            "value": 20.0,
            "is_active": True,
            "end_date": active_date
        },
    ]
    inserted_discounts = []
    for d in discount_rows:
        res = supabase.table("discounts").insert(d).execute()
        if res.data:
            inserted_discounts.append(res.data[0])

    expired_discount_id = inserted_discounts[0]["id"] if len(inserted_discounts) > 0 else None

    # =====================================================================
    # 3. SUBSCRIPTIONS & SUBSCRIPTION LINES
    # =====================================================================
    num_subs = 20 if SMALL else 400
    print(f"Creating {num_subs} subscriptions and lines...")

    sub_ids_created = []
    special_cases = {
        "expired_discount_sub_id": None,
        "no_invoice_sub_ids": [],
    }

    for i in range(num_subs):
        cust_id = customer_ids[i % len(customer_ids)]
        plan_id = plan_ids[i % len(plan_ids)]
        status = "active" if i < (num_subs - 5) else "confirmed"
        
        start_date = (date.today() - timedelta(days=60)).isoformat()
        next_billing_date = date.today().isoformat()

        sub_payload = {
            "customer_id": cust_id,
            "plan_id": plan_id,
            "status": status,
            "start_date": start_date,
            "next_billing_date": next_billing_date,
            "unit_price": 1000.00,
            "total_amount": 1000.00,
            "currency": "INR",
            "auto_renew": True
        }

        res = supabase.table("subscriptions").insert(sub_payload).execute()
        if res.data:
            sub_id = res.data[0]["id"]
            sub_ids_created.append(sub_id)

            supabase.table("subscription_lines").insert({
                "subscription_id": sub_id,
                "description": "Standard License Line",
                "quantity": 1,
                "unit_price": 1000.00,
                "subtotal": 1000.00,
                "line_total": 1000.00,
                "tax_id": tax_18_id,
                "tax_amount": 180.00
            }).execute()

            if i == 0:
                if expired_discount_id:
                    supabase.table("subscription_discounts").insert({
                        "subscription_id": sub_id,
                        "discount_id": expired_discount_id,
                        "applied_amount": 100.00
                    }).execute()
                    special_cases["expired_discount_sub_id"] = sub_id
            elif 1 <= i <= 20:
                special_cases["no_invoice_sub_ids"].append(sub_id)

    # =====================================================================
    # 4. INVOICES, INVOICE LINES & PAYMENTS
    # =====================================================================
    print("Creating past invoices, invoice lines, and payments...")

    overdue_invoice_id = None
    partial_invoice_id = None

    past_sub_ids = sub_ids_created[21:] if len(sub_ids_created) > 21 else sub_ids_created[:5]

    for idx, sub_id in enumerate(past_sub_ids):
        cust_id = customer_ids[idx % len(customer_ids)]
        issue_date = (date.today() - timedelta(days=30)).isoformat()
        due_date_past = (date.today() - timedelta(days=15)).isoformat()
        
        status = "paid"
        if idx == 0:
            status = "overdue"
            due_date_past = (date.today() - timedelta(days=5)).isoformat()
        elif idx == 1:
            status = "partial"

        inv_res = supabase.table("invoices").insert({
            "subscription_id": sub_id,
            "customer_id": cust_id,
            "status": status,
            "issue_date": issue_date,
            "due_date": due_date_past,
            "billing_period_start": (date.today() - timedelta(days=60)).isoformat(),
            "billing_period_end": (date.today() - timedelta(days=30)).isoformat(),
            "subtotal": 1000.00,
            "tax_amount": 180.00,
            "total_amount": 1180.00,
            "amount_paid": 1180.00 if status == "paid" else (500.00 if status == "partial" else 0.00),
            "currency": "INR",
            "tax_name": "GST 18%",
            "tax_rate": 18.00
        }).execute()

        if inv_res.data:
            inv = inv_res.data[0]
            inv_id = inv["id"]

            if idx == 0:
                overdue_invoice_id = inv_id
            elif idx == 1:
                partial_invoice_id = inv_id

            supabase.table("invoice_lines").insert({
                "invoice_id": inv_id,
                "description": "Past Period Billing Line",
                "quantity": 1,
                "unit_price": 1000.00,
                "subtotal": 1000.00,
                "line_total": 1180.00,
                "tax_id": tax_18_id,
                "tax_name": "GST 18%",
                "tax_rate": 18.00,
                "tax_amount": 180.00
            }).execute()

            if status in ["paid", "partial"]:
                supabase.table("payments").insert({
                    "payment_reference": f"REF-{uuid.uuid4().hex[:8].upper()}",
                    "invoice_id": inv_id,
                    "customer_id": cust_id,
                    "method": "upi",
                    "status": "completed",
                    "amount": 500.00 if status == "partial" else 1180.00,
                    "currency": "INR",
                    "payment_date": issue_date
                }).execute()

    print("\n" + "="*50)
    print("SEEDING COMPLETED SUCCESSFULLY!")
    print("="*50)
    print("Planted Cases IDs:")
    print(f"1. One overdue invoice ID: {overdue_invoice_id}")
    print(f"2. One partially paid invoice ID: {partial_invoice_id}")
    print(f"3. One active subscription with expired discount ID: {special_cases['expired_discount_sub_id']}")
    print(f"4. 20 active subscriptions with NO invoice for current period: {len(special_cases['no_invoice_sub_ids'])} subscriptions planted.")
    print("="*50)


if __name__ == "__main__":
    main()
