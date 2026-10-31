// ---------------------------------------------------------------------------
// Formatting helpers shared by the Subscriptions, Invoices and Payments pages.
// All money values are stored as integer cents to avoid floating-point issues.
// ---------------------------------------------------------------------------

/**
 * Format cents as a localised currency string.
 * e.g. formatCents(4900, "USD") → "$49.00"
 */
export function formatCents(cents: number, currency: string = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Format an ISO 8601 date string as a short locale date.
 * e.g. formatDate("2026-11-15") → "Nov 15, 2026"
 * Returns "—" for null/undefined.
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

/**
 * Capitalise the first letter and replace underscores/hyphens with spaces.
 * e.g. "bank_transfer" → "Bank transfer"
 */
export function formatLabel(raw: string): string {
  return raw.charAt(0).toUpperCase() + raw.slice(1).replace(/[_-]/g, " ");
}
