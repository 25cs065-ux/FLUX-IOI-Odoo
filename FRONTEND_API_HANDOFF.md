# Frontend API Handoff — Brightloop Backend

Source: branch `feature/aadya-backend`. Everything below was read from the code and from the app's own OpenAPI output; the example responses were produced by the real routers running against the test database stand-in.

**Status labels:** ✅ implemented and tested · ⏳ not implemented yet · ⚠️ implemented but not verified against the live Supabase database

> ⚠️ **FastAPI checks the Supabase access token itself (`backend/app/core/supabase_jwt.py`): signature, expiry, audience and issuer.** Until the server has `SUPABASE_URL` set (plus `SUPABASE_JWT_SECRET` if the project still signs tokens with HS256), any request with a token gets `503 {"detail": "Authentication is not configured on this server"}`. No token still gets `401`. Build against the contracts below (or the `frontend/src/mocks` folder). They won't change when it goes live.

---

## 1. Authentication

**FastAPI has no auth endpoints.** Sign-up, login and the rest are done in the browser with Supabase Auth (`@supabase/supabase-js`). FastAPI only reads the access token Supabase issues.

| Operation | Where | How |
|---|---|---|
| Registration | Supabase Auth | `supabase.auth.signUp({ email, password })` |
| Login | Supabase Auth | `supabase.auth.signInWithPassword({ email, password })` |
| Logout | Supabase Auth | `supabase.auth.signOut()` |
| Password reset (request) | Supabase Auth | `supabase.auth.resetPasswordForEmail(email, { redirectTo })` |
| Password reset (set new) | Supabase Auth | `supabase.auth.updateUser({ password })` on the reset page |
| Email verification | Supabase Auth | link in the Supabase email; or `supabase.auth.verifyOtp(...)` |
| Resend verification | Supabase Auth | `supabase.auth.resend({ type: 'signup', email })` |
| Token refresh | Supabase Auth | automatic in supabase-js; or `supabase.auth.refreshSession()` |
| `POST /auth/*`, `/login`, `/register`, `/me` … | FastAPI | ⏳ **do not exist** |

Calling FastAPI: send the current Supabase access token on every request.

```
Authorization: Bearer <session.access_token>
```

**Not decided or not verified yet:**
- **Where the role comes from.** The team's shared auth dependency (`backend/app/core/auth.py`) reads the app role (`admin` / `staff` / `customer`) from the signed-in user's `customers.role` row, otherwise from `app_metadata.role` (only the server can set it), otherwise `customer`. A `customers` row with `is_active = false` gets `403`. `user_metadata`, the token's own `role` claim (always `"authenticated"`) and `X-User-Role` headers are ignored. The frontend should not decide roles itself.
- ⚠️ **Supabase project settings:** email confirmation on/off, allowed redirect URLs, SMTP, and minimum password length. The test plan requires passwords **longer than 8 characters**, so validate that on the form too.
- ⚠️ **Packages and env vars:** `frontend/package.json` has `next-auth` but no `@supabase/supabase-js`, and `.env.example` still has `NEXTAUTH_*` variables. These predate the Supabase Auth decision. Confirm with the team before building on NextAuth.

---

## 2. Roles, permissions and data isolation

| Role | Can do |
|---|---|
| `admin` | Everything, including payment refunds (refunds are admin-only) |
| `staff` | Everything except refunds |
| `customer` | Read own subscriptions, invoices and payments; accept (confirm) own quotations |

**Customer isolation (enforced by the server):**
- **How "own" is decided:** a customer's records are found through `customers.auth_user_id = <Supabase user id>`.
- **Lists:** they only ever contain the customer's own records. Any `customer_id` filter they send is ignored.
- **Other customers' records:** on billing endpoints, asking for one by id returns **`404`, not `403`**, so it never confirms the record exists. The customers endpoints (Section 6a) return `403` instead.
- **Draft invoices:** hidden from customers in both lists and lookups.
- **No linked customer record:** a logged-in user with no `customers` row gets empty lists.

**Status codes:**

| Code | Meaning |
|---|---|
| `401` | No token, or an invalid or expired token (`"Token has expired"`). Refresh the Supabase session and retry once; if it fails again, sign the user out |
| `403` | The role isn't allowed, or the account is disabled (`"This account is disabled"`) |
| `503` | Auth isn't configured on the server yet (see the note at the top) |

---

## 3. Conventions

**Base URL:** `http://localhost:8000` locally (`BACKEND_URL` in `.env.example`). There's no `/api` prefix and no versioning.

**API docs:**
- ✅ `GET /docs` (Swagger), `GET /redoc` and `GET /openapi.json` work without a token.
- Generating TypeScript types from `/openapi.json` is recommended, for example with `npx openapi-typescript http://localhost:8000/openapi.json -o src/types/api.ts`.
- ✅ `GET /health` (no token) returns `{"status": "healthy"}`.

**CORS:**
- ✅ By default `http://localhost:3000`, `http://localhost:5173`, `http://127.0.0.1:3000` and `http://127.0.0.1:5173` are allowed. Credentials are allowed, and all methods and headers.
- Set the backend's `ALLOWED_ORIGINS` variable (comma-separated) to replace that list, e.g. for a deployed frontend.
- Any other origin is rejected (the preflight returns `400`). A deployed frontend URL needs a backend change. ⏳

**Formats:**

| Kind | Format | Example |
|---|---|---|
| IDs | UUID string | `"9693cbbc-e6a9-4460-a79d-7ab4e2eb8ba3"` |
| Dates | `YYYY-MM-DD` | `"2026-11-01"` |
| Timestamps | ISO 8601 UTC | `"2026-10-31T08:52:37.786545Z"` |
| Money, quantity, % | **decimal string** | `"159.30"`, `"2"`, `"18"` |
| Currency | 3 uppercase letters, default `INR` | `"INR"` |

- **Requests:** money can be sent as `"159.30"` or `159.30`, with at most 2 decimal places.
- **Responses:** money always comes back as a **string**. Parse it with a decimal library (not `parseFloat` for arithmetic) and format it yourself. ⚠️ Don't rely on a fixed number of decimals ("18" vs "18.00"): live Supabase output hasn't been verified.

**Pagination (all list endpoints):**
- `?limit=` is 1–200 (default 50) and `?offset=` is ≥0 (default 0).
- The response is a **plain JSON array with no total count**. Fewer than `limit` items means it's the last page.

**Errors.** Every error body has a `detail` key, in **two shapes**:
```jsonc
// Shape A: field validation (422). Highlight the fields named in loc.
{"detail": [{"type": "greater_than_equal", "loc": ["body", "quantity"],
             "msg": "Input should be greater than or equal to 1", "input": 0, "ctx": {"ge": 1}}]}
// Cross-field rules use loc ["body"]:
{"detail": [{"type": "value_error", "loc": ["body"],
             "msg": "Value error, end_date must be strictly after start_date", ...}]}

// Shape B: business rule (404 / 409 / 422 / 403 / 401 / 503). Show it as a message.
{"detail": "Product not found"}
{"detail": "Cannot move a active subscription to active (allowed from: paused)"}
{"detail": "Payment exceeds the outstanding balance of 109.30"}
```
Rule of thumb: if `detail` is an array, it's field errors; if it's a string, show it as a message.

- `409` means "not allowed in the current status" (or overpayment / a duplicate). Reload the record and show `detail`.
- `PATCH` uses optimistic locking: if someone else saved the record after you loaded it, you get `409 "... was changed by someone else; reload and try again"`. Reload, re-apply the edit, then save again.
- Unknown request fields are rejected with `422` (`extra_forbidden`).

---

## 4. Subscriptions ✅ ⚠️

**Statuses:** `draft`, `quotation`, `confirmed`, `active`, `paused`, `closed`

| Method & path | Roles | Body | Returns |
|---|---|---|---|
| `GET /subscriptions` | all | — | `Subscription[]` (newest first). Query: `status`, `customer_id`, `plan_id`, `limit`, `offset` |
| `POST /subscriptions` | admin, staff | `SubscriptionCreate` | `201` `SubscriptionDetail` |
| `GET /subscriptions/{id}` | all | — | `SubscriptionDetail` |
| `PATCH /subscriptions/{id}` | admin, staff | `SubscriptionUpdate` | `SubscriptionDetail` |
| `GET /subscriptions/{id}/history` | all | — | `StatusHistory[]` (oldest first) |
| `POST /subscriptions/{id}/send-quotation` | admin, staff | `{"reason"?}` or none | `Subscription`; draft → quotation, sets `quotation_number` |
| `POST /subscriptions/{id}/confirm` | all¹ | `{"reason"?}` or none | `Subscription`; draft/quotation → confirmed |
| `POST /subscriptions/{id}/activate` | admin, staff | `{"reason"?}` or none | `Subscription`; confirmed → active |
| `POST /subscriptions/{id}/pause` | admin, staff | `{"reason"?}` or none | `Subscription`; active → paused (plan must be pausable) |
| `POST /subscriptions/{id}/resume` | admin, staff | `{"reason"?}` or none | `Subscription`; paused → active |
| `POST /subscriptions/{id}/close` | admin, staff | `{"reason"?}` or none | `Subscription`; any → closed (early close needs a `closable_early` plan) |
| `POST /subscriptions/{id}/renew` | admin, staff | `{"new_end_date"?, "reason"?}` | `Subscription`; extends `end_date` (default: by the current term length) |

¹ Customers can confirm only their **own** subscription, and only while it is in `quotation`.

**`SubscriptionCreate`** (`*` = required):
```jsonc
{
  "customer_id": "uuid*",
  "plan_id": "uuid*",
  "start_date": "2026-11-01*",
  "end_date": "2027-11-01",          // optional; null = open-ended; must be > start_date
  "trial_end_date": null,             // optional; between start_date and end_date
  "quantity": 2,                      // >= 1 and >= the plan's min_quantity; default 1
  "payment_terms_id": null,
  "quotation_template_id": null,
  "currency": "INR",
  "auto_renew": true,
  "notes": null,                      // max 2000
  "lines": [                          // optional; empty = one line from the plan (plan price x quantity)
    {
      "product_id": "uuid",           // with a product: description and unit_price default from it
      "variant_id": "uuid",           // price = product price + variant extra_price
      "description": "Seat",          // required if there's no product/variant (max 500)
      "unit_price": "75.00",          // required if there's no product/variant; >= 0
      "quantity": 2,                  // >= 1, default 1
      "discount_percent": 10,         // 0–100, default 0
      "tax_id": "uuid",
      "sequence": 10                  // optional ordering
    }
  ]
}
```
The server calculates all totals.

**`SubscriptionUpdate`:** any subset of the create fields except `customer_id`.
- **Draft / quotation:** everything can be edited. Sending `lines` replaces all lines.
- **Confirmed or later:** only `notes` and `auto_renew` can change; anything else returns `409`.

**`SubscriptionDetail`** (example `201` response):
```json
{
  "id": "9693cbbc-...", "subscription_number": "SUB-000100", "quotation_number": null,
  "customer_id": "669df377-...", "plan_id": "0a20c296-...", "quotation_template_id": null,
  "payment_terms_id": "626b24eb-...", "status": "draft", "quantity": "2",
  "start_date": "2026-11-01", "end_date": "2027-11-01", "trial_end_date": null,
  "next_billing_date": "2026-11-01",
  "confirmed_at": null, "paused_at": null, "pause_reason": null, "closed_at": null, "close_reason": null,
  "unit_price": "100.00", "discount_amount": "15.00", "tax_amount": "24.30", "total_amount": "159.30",
  "currency": "INR", "auto_renew": true, "notes": null,
  "created_by": "b3267bc3-...", "created_at": "2026-10-31T08:52:37.786545Z", "updated_at": "2026-10-31T08:52:37.786545Z",
  "lines": [{
    "id": "29abd0cb-...", "subscription_id": "9693cbbc-...", "product_id": "4da7bd6c-...", "variant_id": "617f816a-...",
    "sequence": 10, "description": "Seat - Premium", "quantity": "2", "unit_price": "75.00",
    "discount_percent": "10", "discount_amount": "15.00", "tax_id": "95a22588-...", "tax_amount": "24.30",
    "subtotal": "150.00", "line_total": "159.30", "created_at": null, "updated_at": null
  }]
}
```
- **`Subscription`** is the same object without `lines`. List and action endpoints return it.
- `unit_price` on the subscription is the plan price at creation. Use the totals, not this field, for display.

**`StatusHistory`:**
```json
{"id": "...", "subscription_id": "...", "from_status": "draft", "to_status": "quotation",
 "changed_by": "uuid", "reason": null, "metadata": {"action": "send_quotation"}, "changed_at": "2026-10-31T08:52:37.799388Z"}
```
- `from_status` is `null` on the creation entry.
- Renewals appear as `active → active` with `metadata.action = "renew"`.

---

## 5. Invoices ✅ ⚠️

**Statuses:** `draft`, `sent`, `partial`, `paid`, `overdue`, `void`, `cancelled`

| Method & path | Roles | Body | Returns |
|---|---|---|---|
| `GET /invoices` | all² | — | `Invoice[]` (newest `issue_date` first). Query: `status`, `customer_id`, `subscription_id`, `limit`, `offset` |
| `POST /invoices` | admin, staff | `InvoiceCreate` | `201` `InvoiceDetail` (manual invoice, draft) |
| `POST /invoices/generate` | admin, staff | `{"subscription_id": "uuid*", "issue_date"?}` | `201` `InvoiceDetail`; bills the subscription's next period |
| `POST /invoices/billing-run` | admin, staff | `{"as_of"?: "date"}` or none | `BillingRunResult` |
| `POST /invoices/mark-overdue` | admin, staff | — (query `?as_of=date`) | `{"marked_overdue": ["uuid", ...]}` |
| `GET /invoices/{id}` | all² | — | `InvoiceDetail` |
| `PATCH /invoices/{id}` | admin, staff | `InvoiceUpdate` | `InvoiceDetail` |
| `POST /invoices/{id}/send` | admin, staff | — | `Invoice`; draft → sent (a zero total goes straight to `paid`) |
| `POST /invoices/{id}/cancel` | admin, staff | — | `Invoice`; draft → cancelled |
| `POST /invoices/{id}/void` | admin, staff | — | `Invoice`; sent/overdue with nothing paid and no pending payment → void |

² Customers see only their own invoices, and never drafts.

**`InvoiceCreate`:**
```jsonc
{
  "customer_id": "uuid*",
  "lines": [ /* at least 1; same shape as subscription lines */ ],
  "subscription_id": null,          // optional; must belong to the same customer
  "payment_terms_id": null,
  "issue_date": null,               // default today
  "due_date": null,                 // default issue_date + payment terms days; must be >= issue_date
  "currency": "INR", "notes": null, "terms_and_conditions": null
}
```

**`InvoiceUpdate`:** `payment_terms_id`, `issue_date`, `due_date`, `notes`, `terms_and_conditions`, `lines`.
- **Drafts:** everything can be edited. Changing `issue_date` or payment terms recalculates `due_date` unless you also send one.
- **After sending:** only `notes` can change.

**`InvoiceDetail`** (example):
```json
{
  "id": "be98ac61-...", "invoice_number": "INV-001000", "subscription_id": "9693cbbc-...",
  "customer_id": "669df377-...", "payment_terms_id": "626b24eb-...", "discount_id": null,
  "status": "draft", "issue_date": "2026-11-01", "due_date": "2026-12-01",
  "billing_period_start": "2026-11-01", "billing_period_end": "2026-11-30",
  "subtotal": "150.00", "discount_amount": "15.00", "tax_amount": "24.30", "total_amount": "159.30",
  "amount_paid": "0.00", "amount_due": "159.30", "currency": "INR",
  "tax_name": "GST", "tax_rate": "18", "notes": null, "terms_and_conditions": null,
  "sent_at": null, "paid_at": null, "voided_at": null,
  "created_by": "b3267bc3-...", "created_at": "2026-10-31T08:52:37.850012Z", "updated_at": null,
  "lines": [{
    "id": "79e9a661-...", "invoice_id": "be98ac61-...", "subscription_line_id": "29abd0cb-...",
    "product_id": "4da7bd6c-...", "variant_id": "617f816a-...", "sequence": 10, "description": "Seat - Premium",
    "quantity": "2", "unit_price": "75.00", "discount_percent": "10", "discount_amount": "15.00",
    "tax_id": "95a22588-...", "tax_name": "GST", "tax_rate": "18", "tax_amount": "24.30",
    "subtotal": "150.00", "line_total": "159.30", "created_at": null, "updated_at": null
  }]
}
```
- **`Invoice`** is the same object without `lines`.
- The invoice header has a `tax_name`/`tax_rate` only when every line uses the same tax; otherwise they're `null`. Show tax per line.
- `billing_period_*` is `null` on manual invoices.

**`BillingRunResult`:**
```jsonc
{"created": [/* Invoice[] */],
 "recovered": [{"subscription_id": "uuid", "reason": "This billing period has already been invoiced (INV-001000)"}],
 "skipped":   [{"subscription_id": "uuid", "reason": "Subscription has no lines to invoice"}],
 "failed":    [{"subscription_id": "uuid", "reason": "RuntimeError: ..."}]}
```

---

## 6. Payments ✅ ⚠️

**Statuses:** `pending`, `completed`, `failed`, `refunded`, `partially_refunded`
**Methods:** `bank_transfer`, `credit_card`, `upi`, `cash`, `cheque`, `other`

| Method & path | Roles | Body | Returns |
|---|---|---|---|
| `GET /payments` | all³ | — | `Payment[]` (newest first). Query: `status`, `invoice_id`, `customer_id`, `limit`, `offset` |
| `POST /payments` | admin, staff | `PaymentCreate` | `201` `PaymentResult`; **`200`** when the same `payment_reference` is sent again |
| `GET /payments/{id}` | all³ | — | `Payment` |
| `POST /payments/{id}/confirm` | admin, staff | — | `PaymentResult`; pending → completed |
| `POST /payments/{id}/fail` | admin, staff | — | `PaymentResult`; pending → failed |
| `POST /payments/{id}/refund` | **admin** | `{"amount"?: "10.00", "reason"?}` or none | `PaymentResult`; full refund by default |
| `POST /payments/recalculate/{invoice_id}` | admin, staff | — | `Invoice`; repairs the balance |

³ Customers see only their own payments.

**`PaymentCreate`:**
```jsonc
{
  "invoice_id": "uuid*",            // invoice must be sent, partial or overdue
  "amount": "50.00*",               // > 0; pending + completed may not exceed the invoice total
  "method": "upi",                  // default "bank_transfer"
  "status": "completed",            // or "pending" for gateway payments awaiting confirmation
  "payment_date": null,             // default today; cannot be in the future
  "payment_reference": "UPI-123",   // optional but RECOMMENDED: makes retries safe (same ref = 200, no duplicate)
  "currency": null,                 // optional; must equal the invoice currency
  "gateway": null, "gateway_payment_id": null, "gateway_response": {}, "notes": null
}
```

**`PaymentResult`** (example `201`):
```json
{
  "payment": {
    "id": "c4a4f05d-...", "payment_reference": "UPI-123", "invoice_id": "39c75eac-...", "customer_id": "da811475-...",
    "method": "upi", "status": "completed", "amount": "50.00", "currency": "INR", "payment_date": "2026-10-31",
    "gateway": null, "gateway_payment_id": null, "gateway_response": {},
    "refunded_amount": "0.00", "refunded_at": null, "notes": null,
    "recorded_by": "b41f5756-...", "created_at": "2026-10-31T08:52:53.131153Z", "updated_at": null
  },
  "invoice": { "...": "Invoice object", "status": "partial", "amount_paid": "50.00", "amount_due": "109.30" }
}
```

Errors to handle:
- `409 {"detail": "Payment exceeds the outstanding balance of 109.30"}`
- `409` when the invoice isn't payable (draft, paid, void or cancelled)
- `409` when a `payment_reference` is reused for a different payment
- `422` for a currency mismatch or a future date

---

## 6a. Customers (Vaidehi's module) ✅ ⚠️

All customer endpoints require a Bearer token (since `853f58c`; earlier versions of this doc said otherwise). There is no `POST /customers/staff` any more. Checked against `develop` at `9679271`.

**Customer name lookup.** Subscriptions, invoices and payments return only `customer_id`. Staff and admin page through `GET /customers/` and map `id → name`, or fetch `GET /customers/{id}` for a single name.

| Method & path | Who may call | Returns |
|---|---|---|
| `GET /customers/?search&limit&offset` | any signed-in user | `Customer[]`, newest first. `limit` 1–100 (default **20**), `offset` ≥ 0, `search` (max 100 chars) matches part of the name or email. Staff and admin see every customer; a customer sees only their own row |
| `GET /customers/{id}` | any signed-in user | `Customer`. `404` if missing. A customer asking for someone else's row gets **`403`** (unlike billing, which returns `404`) |
| `POST /customers/` | any signed-in user | `201` `Customer`. Body: `name`, `email`, `is_active`. For a customer caller the server links the row to their account and forces role `customer`. `409` if that email or account already has a profile |
| `PATCH /customers/{id}` | staff/admin, or the customer for their own row | `Customer`. Body: `name`, `is_active`. For customers only `name` is applied; `role` and `is_active` are ignored |

- Use the trailing slash (`/customers/`). `/customers` answers with a 307 redirect, which can drop the `Authorization` header across origins.
- **`Customer` fields:** `id`, `name`, `email`, `is_active`, `role`, `auth_user_id` (nullable), `created_at` (nullable). There is **no** `phone` or `company`.
- **Validation:** `name` is 1–100 characters; `email` must match a basic email pattern and is stored lowercased.
- ✅ **Database mismatch fixed in `9679271`:** the live `customers` table has no `updated_at`, `phone` or `company` column (checked 31 Oct). Earlier versions of the router wrote `updated_at`, so create and edit failed against the live database; `9679271` stops writing it. Run that version (or later) of `develop`.
- 🔴 **Known bug (unresolved):** `POST /customers/` called by **staff or admin** returns `500`, because the code reads an `auth_user_id` field that `CustomerCreate` does not have. A customer creating their own profile is not affected. Staff "add customer" forms should use mocks until this is fixed.

---

## 6b. Dashboard metrics — no dedicated endpoint

There is **no** dashboard, metrics, stats or reports endpoint. Calculate the numbers in the frontend from the list endpoints, paging with `?limit=200&offset=` (staff/admin token):

| Metric | Source |
|---|---|
| Active subscriptions | `GET /subscriptions?status=active`, count rows |
| MRR | sum `total_amount` of active subscriptions, normalised by the plan's `interval` from `GET /plans/` (daily ×30, weekly ×4.33, monthly ×1, yearly ÷12) |
| ARR | MRR × 12 |
| Outstanding | `GET /invoices`, sum `amount_due` where `status` is `sent`, `partial` or `overdue` |
| Overdue | `GET /invoices?status=overdue`, count rows or sum `amount_due` |
| Collected | `GET /payments?status=completed`, sum `amount − refunded_amount` (add `partially_refunded` rows the same way) |

All amounts are decimal strings; use a decimal library for sums. On 31 Oct the live project had 82 active subscriptions (INR) and **no invoices or payments**, so invoice and payment metrics are zero until a staff billing run is done.

---

## 6c. Catalogue and other modules (Vaidehi's modules)

Contracts are in `/docs`; access rules as registered on `develop`:

| Endpoints | Who may call |
|---|---|
| `GET /plans/` (`?is_active`), `GET /plans/{id}`, `GET /variants/` (`?product_id&is_active`), `GET /variants/{id}`, `GET /quotation-templates/` (`?is_active`), `GET /quotation-templates/{id}` | **no token needed** |
| `POST /plans/`, `PATCH /plans/{id}`, `POST /variants/`, `PATCH /variants/{id}`, `POST /quotation-templates/`, `PATCH /quotation-templates/{id}` | admin |
| `GET /taxes/` (`?is_active`), `POST /taxes/`, `GET /taxes/{id}`, `PATCH /taxes/{id}` | admin |
| `GET /discounts/` (`?is_active`), `POST /discounts/`, `GET /discounts/{id}`, `PATCH /discounts/{id}` | admin |
| `POST /discounts/validate?code&amount&quantity` | **no token needed** |
| `GET /change-requests/`, `POST /change-requests/`, `GET /change-requests/{id}` | any signed-in user (non-admins see only their own) |
| `PATCH /change-requests/{id}` | admin |

Catalogue list endpoints are not paginated.

---

## 7. Screen-by-screen status

**Dashboard (staff/admin):**

| Screen (`frontend/src/app/(dashboard)/…`) | Backend |
|---|---|
| subscriptions | ✅ Section 4 |
| invoices | ✅ Section 5 (including billing run and overdue marking) |
| payments | ✅ Section 6 |
| plans, taxes, discounts, products (variants) | ✅ Section 6c (contracts in `/docs`). There is no `/products` endpoint; products appear only through `variants` |
| customers | ✅ Section 6a. Listing and editing work; 🔴 staff/admin "add customer" returns `500` until the `auth_user_id` bug is fixed |
| staff | ⏳ No staff endpoint (`POST /customers/staff` was removed). Staff accounts are managed in Supabase |
| quotation-templates | ✅ Section 6c |
| dunning | ⏳ Not implemented (`POST /invoices/mark-overdue` ✅ is the only building block) |
| command-center | ⚠️ No metrics endpoint; compute from list endpoints (Section 6b) |
| health-radar, leak-detective, reports, simulator | ⏳ Not implemented |

**Customer portal:**

| Screen (`frontend/src/app/(portal)/portal/…`) | Backend |
|---|---|
| subscriptions | ✅ `GET /subscriptions`, `GET /subscriptions/{id}`, `GET /subscriptions/{id}/history`, accept a quote: `POST /subscriptions/{id}/confirm` |
| invoices | ✅ `GET /invoices`, `GET /invoices/{id}` (no drafts). ⏳ PDF download not implemented |
| payments | ✅ `GET /payments`, `GET /payments/{id}`. ⏳ **Customers cannot pay online.** There's no payment gateway or checkout endpoint; payments are recorded by staff |
| profile | ✅ `GET /customers/` returns the customer's own row (name, email); `PATCH /customers/{id}` updates their `name`. No phone or company fields exist. Email/password changes go through Supabase Auth |
| login, register, forgot/reset password, verify email | Supabase Auth (Section 1) |

---

## 8. Environment variables (names only)

| Variable | Used by | Status |
|---|---|---|
| `BACKEND_URL` | frontend → API base URL (`http://localhost:8000`) | in `.env.example` |
| `FRONTEND_URL` | backend email links | in `.env.example` (not used by the backend code yet) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Supabase project | in `.env.example` |
| `SUPABASE_SERVICE_ROLE_KEY` | **backend only, never in the frontend** | in `.env.example` |
| `NEXTAUTH_URL`, `NEXTAUTH_SECRET` | NextAuth | in `.env.example`. ⚠️ May be obsolete given the Supabase Auth decision |
| `NEXT_PUBLIC_API_URL` | browser-side API base URL | Already read by the frontend code (`feat/seena-frontend`); ⏳ not yet in `.env.example` |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser-side Supabase Auth (use the publishable key) | names agreed and used in local `frontend/.env.local`; ⏳ not yet in `.env.example`, and no frontend code reads them yet |
| `ALLOWED_ORIGINS` | backend CORS (comma-separated) | optional; defaults listed in Section 3 |
| `SUPABASE_JWT_SECRET` | backend | not needed: the project signs tokens with ES256 and the backend uses its published keys (JWKS). Only for legacy HS256 projects |

Ask the team lead for the values; never commit them.

---

## 9. Not verified against live Supabase ⚠️

The billing contracts are tested against an in-memory database stand-in, the schema file `database/remaining_schema.sql`, and a local PostgreSQL copy of that schema.

**Checked against the live project on 31 Oct (read-only):** every billing table has every column the API reads or writes, as do the columns billing reads from customers, plans, products, variants, taxes and quotation templates. The live `customers` table has **no** `updated_at`, `phone` or `company` column; the customers router stopped writing `updated_at` in `9679271` (see Section 6a).

Still unconfirmed:
- the exact number formatting in responses;
- the database's `SUB-`/`INV-` numbering;
- that the database rejects duplicate billing periods (the `uix_invoice_live_period` index).

Report anything that differs to Aadya.
