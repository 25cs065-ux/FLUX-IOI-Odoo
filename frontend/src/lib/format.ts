// ---------------------------------------------------------------------------
// Formatting helpers shared by the Subscriptions, Invoices and Payments pages.
// All money values are stored as integer cents to avoid floating-point issues.
// ---------------------------------------------------------------------------

/**
 * Format cents as a localised currency string.
 * e.g. formatCents(4900, "USD") → "$49.00"
 *
 * Existing callers pass "USD" or row.currency — unchanged behaviour.
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
 * Format a cent value as Indian Rupees (₹) using the en-IN locale.
 * Uses compact notation for large values (≥ 1 lakh).
 *
 * e.g. formatInrCents(743000000) → "₹74.3L"
 *      formatInrCents(4900)      → "₹49.00"
 *
 * This is a separate export so existing USD call-sites are not affected.
 */
export function formatInrCents(cents: number): string {
  const rupees = cents / 100;
  if (rupees >= 10_000_000) {
    // ≥ 1 crore — show as "₹XCr"
    return `₹${(rupees / 10_000_000).toLocaleString("en-IN", {
      maximumFractionDigits: 1,
    })}Cr`;
  }
  if (rupees >= 100_000) {
    // ≥ 1 lakh — show as "₹XL"
    return `₹${(rupees / 100_000).toLocaleString("en-IN", {
      maximumFractionDigits: 1,
    })}L`;
  }
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/**
 * Format a cent value as INR with full precision (no compact notation).
 * Suitable for tooltips and detail views.
 *
 * e.g. formatInrCentsFull(743000000) → "₹74,30,000.00"
 */
export function formatInrCentsFull(cents: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
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

/**
 * Format a decimal string as Indian Rupees (₹) using the en-IN locale.
 * The backend sends all money values as decimal strings e.g. "159.30".
 *
 * e.g. formatDecimalInr("159.30")      → "₹159.30"
 *      formatDecimalInr("74300000.00") → "₹7.43Cr"
 *
 * Returns "₹0.00" for null, undefined or unparseable values.
 */
export function formatDecimalInr(value: string | null | undefined): string {
  if (!value) return "₹0.00";
  const num = parseFloat(value);
  if (isNaN(num)) return "₹0.00";
  if (num >= 10_000_000) {
    return `₹${(num / 10_000_000).toLocaleString("en-IN", {
      maximumFractionDigits: 1,
    })}Cr`;
  }
  if (num >= 100_000) {
    return `₹${(num / 100_000).toLocaleString("en-IN", {
      maximumFractionDigits: 1,
    })}L`;
  }
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}
