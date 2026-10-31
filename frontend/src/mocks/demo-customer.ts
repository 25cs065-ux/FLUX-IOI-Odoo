// ---------------------------------------------------------------------------
// Demo Customer
//
// A fixed mock customer used throughout the Customer Portal.
// This simulates a logged-in customer session without actual authentication.
// Replace with Supabase Auth session data when authentication is integrated.
//
// All portal pages filter records by DEMO_CUSTOMER.id.
// ---------------------------------------------------------------------------

export interface DemoCustomer {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string;
  /** ISO 8601 date string — when the account was created. */
  createdAt: string;
}

/**
 * The demo customer used for all portal pages.
 * Corresponds to cus_003 in the mock dataset (Initech Ltd).
 */
export const DEMO_CUSTOMER: DemoCustomer = {
  id: "cus_003",
  name: "Morgan Chen",
  email: "morgan.chen@initech.example",
  phone: "+91 98765 43210",
  company: "Initech Ltd",
  createdAt: "2023-07-20",
};
