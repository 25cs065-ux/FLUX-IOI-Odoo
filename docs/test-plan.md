# Test Plan & QA Matrix - FLUX-IOI-Odoo

## 1. Scope & Modules
Owner: Vaidehi
Assigned Modules: Variants, Plans, Taxes, Discounts, Customers/Staff, Quotation Templates, Change Requests.

---

## 2. Global Server-Side Validation Rules
- **Price**: Must be >= 0.00. Negative values must return `422 Unprocessable Entity`.
- **Quantity**: Must be >= 1. Zero or negative values must return `422 Unprocessable Entity`.
- **Date Validity**: `end_date` must be strictly after `start_date`.
- **Password Length**: Passwords of exactly 8 characters or fewer must FAIL with `422`. Must be strictly > 8 characters.
- **Unique Constraints**: Duplicate user/staff emails must return `409 Conflict`.

---

## 3. RBAC & Security Test Cases

| Test ID | Endpoint | Method | Role Tested | Expected Status | Description / Assertions |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **SEC-01** | `/taxes` | POST | Customer | `403 Forbidden` | Non-admin cannot create taxes |
| **SEC-02** | `/taxes` | POST | Staff | `403 Forbidden` | Staff cannot create taxes |
| **SEC-03** | `/taxes` | POST | Admin | `201 Created` | Admin can create taxes |
| **SEC-04** | `/discounts` | POST | Customer / Staff | `403 Forbidden` | Only admin can configure discounts |
| **SEC-05** | `/staff` | POST | Customer / Staff | `403 Forbidden` | Only admin can provision staff accounts |
| **SEC-06** | `/invoices/{id}` | GET | Customer A | `403 / 404` | Customer A cannot view Customer B invoice |
| **SEC-07** | `/change-requests` | POST | Customer | `201 Created` | Customer can file request; ID taken from token |

---

## 4. Module Test Vectors

### Module 1: Variants
- [ ] `TC-VAR-01`: Create variant with `extra_price >= 0` -> `201 Created`.
- [ ] `TC-VAR-02`: Create variant with `extra_price < 0` -> `422 Unprocessable Entity`.
- [ ] `TC-VAR-03`: Dynamic calculation: Base Price (100) + Extra (560) = 660.

### Module 2: Plans
- [ ] `TC-PLN-01`: Valid interval in `['daily', 'weekly', 'monthly', 'yearly']` -> `201 Created`.
- [ ] `TC-PLN-02`: Invalid interval (e.g. `'hourly'`) -> `422 Unprocessable Entity`.
- [ ] `TC-PLN-03`: `min_quantity < 1` -> `422 Unprocessable Entity`.
- [ ] `TC-PLN-04`: `end_date <= start_date` -> `422 Unprocessable Entity`.
- [ ] `TC-PLN-05`: Boolean flag defaults (`auto_close`, `closable_early`, `pausable`, `renewable`).

### Module 3: Taxes (Admin Only)
- [ ] `TC-TAX-01`: Admin creates tax with `0 <= rate <= 100` -> `201 Created`.
- [ ] `TC-TAX-02`: Rate > 100 or < 0 -> `422 Unprocessable Entity`.
- [ ] `TC-TAX-03`: Staff/Customer auth token -> `403 Forbidden`.

### Module 4: Discounts (Admin Only)
- [ ] `TC-DISC-01`: Type in `['fixed', 'percentage']` -> `201 Created`.
- [ ] `TC-DISC-02`: Percentage > 100% -> `422 Unprocessable Entity`.
- [ ] `TC-DISC-03`: Usage counter: `usage_count >= usage_limit` blocks subsequent checkouts with `400 Bad Request`.
- [ ] `TC-DISC-04`: Current timestamp outside `[start_date, end_date]` -> `400 Bad Request (Expired)`.

### Module 5: Customers & Staff
- [ ] `TC-AUTH-01`: Register/create with password length == 8 -> `422 Unprocessable Entity`.
- [ ] `TC-AUTH-02`: Register/create with password length == 9 -> `201 Created`.
- [ ] `TC-AUTH-03`: Duplicate email -> `409 Conflict`.
- [ ] `TC-CUST-01`: Staff/Admin can list and search customers.
- [ ] `TC-STAF-01`: Only Admin can create staff accounts (`POST /staff`).

### Module 6: Quotation Templates
- [ ] `TC-TMPL-01`: Create template with valid plan and product line items -> `201 Created`.
- [ ] `TC-TMPL-02`: Line item with `quantity < 1` -> `422 Unprocessable Entity`.
- [ ] `TC-TMPL-03`: `validity_days <= 0` -> `422 Unprocessable Entity`.

### Module 7: Change Requests
- [ ] `TC-CHG-01`: Customer creates change request -> status defaults to `pending`.
- [ ] `TC-CHG-02`: Customer token auto-assigns `customer_id` (cannot spoof another ID).
- [ ] `TC-CHG-03`: Staff/Admin can review and patch status (`in_review`, `approved`, `rejected`).
