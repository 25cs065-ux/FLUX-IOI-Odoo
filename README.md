# Brightloop Subscription Platform

One unified platform that runs the full life of a subscription business: products and plans, quotations, subscriptions, automatic invoicing, taxes, discounts, payments, and revenue reporting.

Built for Brightloop Software, a company that earns money every month and needs renewals, invoices and revenue reports to stop depending on spreadsheets and manual work.

---

## The Problem

Brightloop tracks customers in a spreadsheet, types invoices by hand, matches payments by scrolling through bank statements, and builds revenue reports manually every quarter. Renewals get missed, invoices go out wrong, and nobody can say how much recurring revenue the company actually has.

## Our Solution

A single system where:
- Invoices are generated automatically from subscriptions, with customer details, lines, taxes and totals pre-filled
- Billing is **duplicate-proof**, so nothing is billed twice or skipped
- Payment status (paid, partial, outstanding, overdue) is calculated from real payments, so it never goes stale
- Finance sees active subscriptions, revenue, outstanding balances, overdue invoices and MRR on one screen

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router), React, Tailwind CSS, shadcn/ui |
| Authentication | NextAuth.js (credentials) with JWT issued by FastAPI |
| Backend | FastAPI (Python) |
| Database and Storage | Supabase (PostgreSQL) |
| AI (planned modules) | Google AI Studio (Gemini) for wording only |
| Collaboration | Git, GitHub, GitHub Copilot |

---

## Features Built

### Core features

1. **Authentication and Registration:** unique email, strong password rules (more than 8 characters, uppercase, lowercase, special character), login, logout, password reset, email verification
2. **Role-Based Access Control:** Admin, Staff and Customer roles; only the admin can create staff
3. **Customer Portal:** customers see only their own subscriptions, renewals, invoices and payment history, and can request changes
4. **Product Management:** add, update and deactivate products with name, type, sales price, cost price and notes
5. **Product Variants:** brand, edition or configuration with extra charges (for example, the Odoo brand adds 560); the final price updates automatically
6. **Subscription Plans:** daily, weekly, monthly and yearly plans with price, minimum quantity, availability dates, and per-plan pause, early-close and renewal rules
7. **Quotation Templates:** reusable templates with plan and product lines and a validity period
8. **Subscription Lifecycle:** unique subscription numbers and the flow Draft, Quotation, Confirmed, Active, Closed, with pause, renewal, early close and a status history
9. **Renewal Management:** renewals are handled through the next billing period, with duplicate protection
10. **Automated Invoice Generation:** invoices are created from due subscriptions; they can be confirmed, cancelled, sent or printed
11. **Tax Management:** admin-defined tax rules and rates, calculated automatically with a breakdown on each invoice
12. **Discount Management:** admin-only fixed or percentage discounts with minimum quantity or purchase, validity dates and usage limits, applied automatically
13. **Payment Management:** record payments with method, amount, date and note; track paid, partially paid, outstanding and overdue invoices
14. **Financial Dashboard:** active subscriptions, revenue, outstanding balances, overdue invoices and **MRR**, with date filters
15. **Search, Filtering and Performance:** search and filters, pagination and database indexes for fast pages

### Engineering highlights

- **Duplicate-proof billing:** a unique database rule on subscription and billing period, plus safe locking, means running billing twice creates zero duplicate invoices
- **Price snapshots:** invoice lines store the price and tax rate at billing time, so later product changes never rewrite past invoices
- **Computed payment status:** paid, partial, outstanding and overdue come from a database view, not stored values
- **Pure, tested engines:** tax, discount and billing logic are separate functions with automated tests (275 tests passing)

---

## Planned Innovation Modules

These are designed to run on the same clean subscription, invoice and payment data:

- **Revenue Leak Detective:** compares expected billing against actual invoices and payments to find missing invoices, duplicates, wrong amounts and expired discounts still applied
- **Subscription Change Impact Simulator:** previews upgrades, downgrades, quantity changes and cancellations, showing proration, credits, tax and MRR impact before they are confirmed
- **Subscription Health Radar:** explainable customer health scores from payment delays, seat reductions and expiring plans, with suggested retention actions
- **Smart Dunning and Payment Recovery:** a reminder and escalation schedule for overdue invoices, with admin approval and a revenue-recovered tracker

Scores and numbers are rule-based and explainable. AI is used only to write wording such as reminder emails and explanations.

---

## Project Structure

```
brightloop-subscription-platform/
├── backend/          FastAPI app (routers, services, schemas, tests)
├── frontend/         Next.js app (pages, components, lib)
├── database/         SQL schema, migrations and seed script
├── docs/             Task board, demo script, test plan, bug log
├── .env.example      Environment variable names (no real keys)
└── README.md
```

---

## Getting Started

**Requirements:** Python 3.12 (3.11 also works), Node.js 20 or newer, Git, and a Supabase project.

### 1. Clone

```bash
git clone <repo-url>
cd brightloop-subscription-platform
git checkout develop
```

### 2. Environment variables

Copy `.env.example` to `.env` in the project root, and create `frontend/.env.local`. Ask Khushi for the keys privately.

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
JWT_SECRET=
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=
BACKEND_URL=http://127.0.0.1:8000
```

### 3. Backend

```bash
cd backend
python -m venv venv
source venv/Scripts/activate      # Windows Git Bash. PowerShell: .\venv\Scripts\Activate.ps1. Mac/Linux: source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

API docs: http://127.0.0.1:8000/docs

### 4. Frontend

```bash
cd frontend
npm install
npm run dev
```

App: http://localhost:3000

### 5. Seed demo data (optional)

Run this after the database tables exist in Supabase:

```bash
python database/seed/seed_data.py
```

This creates an admin, staff, customers, products, plans, taxes, discounts, subscriptions, invoices and payments, including planted demo cases (an overdue invoice, a partially paid invoice, an active subscription with an expired discount, and subscriptions with no invoice for the current period). Seeded users log in with the password `Test@1234`.

### 6. Run the tests

```bash
cd backend
python -m pytest -q
```

---

## Team

| Name | Role |
|---|---|
| Khushi | Integration Lead: GitHub, tax and discount engines, seed data, demo and submission |
| Aadya | AI Technical Lead: architecture, billing engine, auth, payments, dashboard |
| Seena | Frontend Lead: UI/UX, pages, components, API integration |
| Vaidehi | Feature Developer and QA: CRUD modules, validation, testing |


---

## Rules for Contributors

- Never commit `.env` files or API keys
- Work on `feature/<name>-<module>` branches and open pull requests into `develop`
- Edit only files in your own folders (see `docs/task-board.md`)
- `main` is kept demo-ready

---

## Documentation

- `docs/task-board.md`: who owns what and its status
- `docs/demo-script.md`: the demo walkthrough
- `docs/test-plan.md` and `docs/bug-log.md`: QA records
- API reference: run the backend and open `/docs`
