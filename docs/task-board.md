# Brightloop – Team Task Board

**Project:** Brightloop – AI-Powered Subscription Lifecycle & Revenue Intelligence Platform  
**Repository:** FLUX-IOI-Odoo  
**Python:** 3.12 (3.11 also supported)  
**Frontend:** Next.js, React, TypeScript, Tailwind CSS  
**Backend:** FastAPI, Python  
**Database:** Supabase PostgreSQL  

---

## 1. Integration Checkpoints

| Checkpoint | Required work | Expected result |
|---|---|---|
| Hour 2 | Check all branches, review PRs, integrate initial modules, run application | Shared foundation and reference modules ready |
| Hour 4 | Pull latest develop, review and merge tested PRs, verify frontend/backend/database integration | Main application modules connected |
| Hour 6 | Final PR review, resolve critical bugs, run application and freeze features | Feature-complete demo candidate |
| Hour 6–8 | End-to-end testing, performance checks, deployment and demo rehearsal | Stable application ready for submission |

### Feature Freeze Rules
- No new features after Hour 6.
- Only bug fixes, integration fixes and demo-critical improvements are allowed.
- `main` must always contain stable, tested code.
- All feature branches must create PRs targeting `develop`.
- No direct pushes to `main` or `develop`.

---

## 2. Team Responsibilities

### Khushi – Integration Lead + Demo

**Primary folders:**
- Root configuration files
- `.github/`
- `docs/`
- `database/seed/`
- `backend/app/prompts/`
- `backend/app/services/tax_engine.py`
- `backend/app/services/discount_engine.py`
- `backend/app/services/email_service.py`
- Reports/CSV export integration
- Vercel and Supabase setup

**Responsibilities:**
- GitHub repository, branches and collaborator management.
- Supabase and Google AI Studio setup.
- Tax and discount calculation engines with tests.
- Generate realistic demo seed data.
- Prepare email service and Gemini prompts.
- Coordinate CSV export with backend.
- Review and merge PRs into `develop`.
- Run integration and end-to-end tests.
- Deployment, documentation and demo preparation.

### Aadya – Backend Core

**Primary folders:**
- `backend/app/core/`
- `backend/app/routers/`
- `backend/app/services/billing_engine.py`
- `backend/app/main.py`
- `database/schema.sql`

**Responsibilities:**
1. Database connection and schema setup.
2. Authentication and JWT security.
3. Registration and login APIs.
4. Role-based authorization.
5. Reference products router.
6. Subscription lifecycle.
7. Recurring billing and duplicate prevention.
8. Invoice actions.
9. Payments and invoice balances.
10. Dashboard APIs and performance optimization.
11. Help with backend integration and critical bug fixes.

**Important:** Products router must be completed and pushed early so Vaidehi can use it as a reference.

### Seena – Frontend

**Primary folders:**
- `frontend/src/components/`
- `frontend/src/lib/api-client.ts`
- `frontend/src/lib/validators/`
- `frontend/src/hooks/`
- `frontend/src/mocks/`
- `frontend/src/app/(auth)/`
- `frontend/src/app/(portal)/`
- Dashboard pages for command-center, subscriptions, invoices and payments.

**Responsibilities:**
1. Reusable layout and sidebar.
2. Role-based navigation.
3. Navbar.
4. DataTable, StatusBadge, StatCard, FormField and ConfirmDialog.
5. API client with Bearer token and error handling.
6. Authentication pages.
7. NextAuth credentials integration with FastAPI JWT.
8. Role-based route protection.
9. Subscription and invoice screens.
10. Record-payment dialog.
11. Customer portal.
12. Command Center dashboard and revenue chart.
13. Loading, empty and error states.
14. Responsive/mobile design.

### Vaidehi – Feature Modules + QA

**Primary folders:**
- `backend/app/routers/`
- Matching dashboard pages under `frontend/src/app/(dashboard)/`
- `backend/tests/`
- `docs/test-plan.md`
- `docs/bug-log.md`

**Responsibilities:**
1. Wait for Aadya's reference `products.py` router.
2. Read the database schema and prepare test cases.
3. Implement the remaining feature routers using the reference pattern.
4. Build matching frontend pages using Seena's reusable components.
5. Test endpoints through `/docs`.
6. Maintain test-plan and bug-log.
7. Open one PR per module.

**Module build order:** Follow the agreed billing-first order, beginning with variants and other dependencies required by billing. Confirm the remaining order with the team.

---

## 3. Module-wise Task Tracking

Status: Not Started / In Progress / In Review / Blocked / Completed.

| Module / Task | Owner | Status |
|---|---|---|
| Repository and initial project structure | Khushi | Completed |
| Branch and collaborator setup | Khushi | In Progress |
| Supabase project and credentials | Khushi | In Progress |
| Python version and README | Khushi | In Progress |
| Database schema and migrations | Aadya | In Progress |
| Database connection | Aadya | Not Started |
| Authentication and JWT | Aadya | Not Started |
| Role-based access control | Aadya | Not Started |
| Reference products router | Aadya | Not Started |
| Tax engine and tests | Khushi | In Review |
| Discount engine and tests | Khushi | In Review |
| Reusable frontend layout | Seena | Not Started |
| DataTable and shared UI components | Seena | Not Started |
| API client and validators | Seena | Not Started |
| Login and registration pages | Seena | Not Started |
| Subscription and invoice screens | Seena | Not Started |
| Customer portal | Seena | Not Started |
| Command Center and revenue chart | Seena | Not Started |
| Product and variant modules | Vaidehi | Not Started |
| Plan management | Vaidehi | Not Started |
| Tax and discount screens | Vaidehi | Not Started |
| Quotation templates | Vaidehi | Not Started |
| Customer and staff management | Vaidehi | Not Started |
| Subscription lifecycle APIs | Aadya | Not Started |
| Recurring billing engine | Aadya | Not Started |
| Invoice generation and actions | Aadya | Not Started |
| Payment APIs and invoice balances | Aadya | Not Started |
| Dashboard APIs | Aadya | Not Started |
| Email service | Khushi | Not Started |
| Seed data generator | Khushi | Not Started |
| Gemini prompt files | Khushi + Aadya | Not Started |
| CSV export | Khushi + Aadya | Not Started |
| Test plan and bug log | Vaidehi | Not Started |
| Frontend/backend integration | Khushi + Seena + Aadya | Not Started |
| Feature PR review and merging | Khushi | In Progress |
| End-to-end testing | Everyone | Not Started |
| Deployment and environment setup | Khushi | Not Started |
| Demo script and rehearsal | Khushi + Everyone | Not Started |

---

## 4. Development and Git Rules

- Every developer must work on their own feature branch.
- Never push unfinished work directly into `main` or `develop`.
- Open a pull request targeting `develop`.
- One module should have one clearly scoped PR.
- PRs must be tested before merging.
- Communicate API, database and response-format changes to affected teammates.
- Khushi coordinates integration and tracks blockers.
- All members must pull the latest `develop` before starting new integration work.

---

## 5. Daily Team Check-in

Every member must report:

1. What was completed?
2. What is being worked on now?
3. Is anything blocked?
4. Has the latest code been pushed?
5. Is a PR ready for review?

---

## 6. Final Definition of Done

- Customer can register and log in.
- Customer sees only their own information.
- Staff/admin permissions work correctly.
- Product-to-plan-to-quotation-to-subscription flow works.
- Billing creates invoices without duplicates.
- Tax and discount calculations are correct.
- Payments update invoice balances.
- Dashboard displays accurate financial figures.
- Seed data demonstrates the required scenarios.
- End-to-end demo runs without critical errors.
- Project can be cloned and started using the README instructions.