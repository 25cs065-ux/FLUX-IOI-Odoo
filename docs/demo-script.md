# Brightloop – Final Demo Script

**Project:** Brightloop – AI-Powered Subscription Lifecycle & Revenue Intelligence Platform

**Demo objective:** Demonstrate how Brightloop manages products, subscription plans, quotations, recurring billing, invoices, taxes, discounts and payments through one integrated platform.

**Target duration:** 8–10 minutes.

---

## 1. Before Starting the Demo

Confirm the following:

- [ ] Frontend is running.
- [ ] FastAPI backend is running.
- [ ] Supabase database is connected.
- [ ] Demo seed data has been inserted.
- [ ] Admin, staff and customer accounts are available.
- [ ] API endpoints are working through `/docs`.
- [ ] All demo data is consistent.
- [ ] No critical errors appear in browser or backend logs.

### Demo Accounts

| Role | Email | Password |
|---|---|---|
| Admin | admin@brightloop.test | DemoAdmin@123 |
| Staff | staff@brightloop.test | DemoStaff@123 |
| Customer | alex@brightloop.test | DemoUser@123 |

These are sample demo credentials. Create these accounts through the application's supported setup process. Use only test accounts and passwords.

---

## 2. Main Demo Storyline

### Step 1 – Admin Login

1. Open Brightloop.
2. Navigate to Login.
3. Enter:
   - Email: `admin@brightloop.test`
   - Password: `DemoAdmin@123`
4. Click Login.
5. Show the Command Center.

**Expected result:** Admin successfully accesses the dashboard and management features.

### Step 2 – Create a Product

Navigate to Products → Add Product.

Enter:

- Product Name: Brightloop Pro
- Product Type: Service
- Sales Price: ₹1,000
- Cost Price: ₹400
- Description: Professional subscription management software

Save the product.

**Expected result:** Product appears in the product catalogue.

### Step 3 – Create a Subscription Plan

Navigate to Plans → Create Plan.

Enter:

- Plan Name: Brightloop Pro Monthly
- Billing Cycle: Monthly
- Price: ₹1,000
- Minimum Quantity: 1
- Auto Renewal: Enabled

Save the plan.

**Expected result:** Monthly subscription plan is available.

### Step 4 – Create a Quotation

Navigate to Quotations → Create Quotation.

Enter:

- Customer: Alex Morgan
- Email: alex@brightloop.test
- Product: Brightloop Pro
- Plan: Brightloop Pro Monthly
- Quantity: 2
- Validity: 7 days

Generate the quotation.

**Expected result:** Quotation displays the customer, selected plan, quantity and calculated price.

### Step 5 – Confirm the Quotation and Create Subscription

1. Open the generated quotation.
2. Confirm the quotation.
3. Create or activate the subscription using the agreed lifecycle.
4. Show the subscription details.

**Expected result:** Subscription moves through the supported status flow and is associated with the correct customer and plan.

### Step 6 – Demonstrate Recurring Billing

Navigate to Billing → Run Billing.

1. Run billing for the current billing date.
2. Open the generated invoice.
3. Run billing again for the same date and billing period.
4. Compare the invoice records.

**Expected result:** The second billing run does not create duplicate invoices.

### Step 7 – Demonstrate Tax Calculation

Open the generated invoice.

Show:

- Product amount.
- Applicable tax rate.
- Tax amount.
- Final invoice total.

Example:

| Item | Amount |
|---|---:|
| Subtotal | ₹2,000 |
| GST at 18% | ₹360 |
| Total | ₹2,360 |

**Expected result:** Tax calculation matches the tax engine and invoice data.

### Step 8 – Demonstrate Discount Application

Use an eligible demo discount:

- Discount Name: Launch Discount
- Discount Type: Percentage
- Discount Value: 10%
- Minimum Purchase: ₹1,000
- Minimum Quantity: 1
- Validity: 01 November 2026 – 30 November 2026

Apply the discount to an eligible invoice.

Show the discount amount and updated taxable amount.

**Expected result:** Only eligible discounts are applied, and expired or ineligible discounts are rejected.

### Step 9 – Record a Payment

Navigate to Payments → Record Payment.

Enter the actual amount due on the demo invoice.

For the example invoice after the 10% discount and 18% tax, assuming discount is applied before tax:

- Subtotal: ₹2,000
- Discount: ₹200
- Taxable amount: ₹1,800
- GST at 18%: ₹324
- Invoice total: ₹2,124

Enter:

- Customer: Alex Morgan
- Invoice: Generated invoice
- Payment Method: UPI
- Amount: ₹2,124
- Payment Note: Demo payment

Save the payment.

**Expected result:** Payment is recorded, and invoice balance and status are updated.

### Step 10 – Demonstrate Partial and Overdue Payments

Navigate to Invoices → Invoice List.

Show the prepared seed-data scenarios:

1. An overdue invoice.
2. A partially paid invoice.
3. An invoice with an outstanding balance.

Explain the difference between paid, partially paid, outstanding and overdue statuses.

**Expected result:** Admin can identify outstanding amounts and overdue customer invoices.

### Step 11 – Demonstrate the Command Center

Navigate to Command Center.

Show:

- Active subscriptions.
- Revenue collected.
- Outstanding payments.
- Overdue invoices.
- Monthly recurring revenue (MRR).
- Monthly revenue trend.

**Expected result:** Dashboard figures match the database records.

### Step 12 – Demonstrate the Customer Portal

Log out from Admin.

Log in as:

- Email: `alex@brightloop.test`
- Password: `DemoUser@123`

Show:

- Customer profile.
- Active subscriptions.
- Upcoming renewals.
- Invoices.
- Payment history.
- Request change/pause/cancel option, if implemented.

**Expected result:** Customer can access their own data only, not another customer's information.

### Step 13 – Demonstrate Reports

Return to the admin account.

Navigate to Reports → Export CSV.

Export the month-end report.

Open the downloaded CSV and show the customer, subscription and invoice information.

**Expected result:** Admin can export the available financial report.

---

## 3. Seed Data Test Scenarios

Before the presentation, verify that these records exist:

| Scenario | Expected result |
|---|---|
| Overdue invoice | Appears in overdue list |
| Partially paid invoice | Shows remaining balance |
| Expired discount still applied | Detected as an invalid discount application |
| Billing run repeated | No duplicate invoice created |

---

## 4. Optional Features

Only demonstrate these if they are implemented, tested and integrated before the feature freeze:

- AI Revenue Leak Detective.
- Subscription Change Impact Simulator.
- AI Subscription Health Radar.
- Automated reminder emails.

Do not demonstrate unfinished features as if they are working.

---

## 5. Final Demo Checklist

- [ ] Login and registration work.
- [ ] Role-based permissions work.
- [ ] Products and variants work.
- [ ] Plans work.
- [ ] Quotations work.
- [ ] Subscription lifecycle works.
- [ ] Billing runs successfully.
- [ ] Repeated billing creates no duplicates.
- [ ] Tax calculation is correct.
- [ ] Discount eligibility is correct.
- [ ] Payments update invoice balances.
- [ ] Overdue and partial invoices display correctly.
- [ ] Command Center displays accurate figures.
- [ ] Customer portal protects customer data.
- [ ] CSV export works.
- [ ] Application works at mobile width.
- [ ] No critical frontend or backend errors.
- [ ] Deployment is accessible.

---

## 6. Closing Statement

"Brightloop is a unified subscription management platform that helps businesses manage their complete subscription lifecycle, from product creation and quotations to recurring billing, invoices and payments.

By combining financial visibility, automated billing and intelligent revenue management, Brightloop helps businesses reduce manual work and make better subscription decisions."