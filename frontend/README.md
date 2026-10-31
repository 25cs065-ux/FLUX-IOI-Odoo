# Brightloop Subscription Platform

Next.js (App Router) frontend for the Brightloop Subscription Platform, built with Tailwind CSS and shadcn/ui. Authentication uses NextAuth.js, which calls the FastAPI backend for login and issues the session token.

---

## Demo Accounts

Use these pre-seeded credentials to log in (Password for all accounts: `Test@1234`):

* **Admin:** `admin@seed.brightloop.test`
* **Staff 1:** `staff1@seed.brightloop.test`
* **Staff 2:** `staff2@seed.brightloop.test`

---

## Seed Scenarios

| Seed Case | Description |
| :--- | :--- |
| **Overdue Invoice** | Past invoice planted with overdue status. |
| **Partially Paid Invoice** | Past invoice planted with partial payment. |
| **Expired Discount** | Exists in data, used by the planned Leak Detective. |
| **Current Period Invoices** | 20 active subscriptions with no invoice for the current period (ready for live billing demo). |

---

## Run locally

```bash
npm install
npm run dev
