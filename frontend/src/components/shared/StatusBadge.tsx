import { cn } from "cn";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StatusValue =
  | "draft"
  | "confirmed"
  | "active"
  | "paid"
  | "pending"
  | "overdue"
  | "closed"
  | "cancelled"
  | "failed"
  | (string & {}); // allow arbitrary strings while keeping autocomplete

export interface StatusBadgeProps {
  status: StatusValue;
  /** Override the displayed label. Defaults to title-cased status. */
  label?: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Colour map — tailwind classes using theme-aware colours where possible.
// Opacity variants keep the palette consistent with the rest of the app.
// ---------------------------------------------------------------------------

type BadgeStyle = { bg: string; text: string; ring: string };

const STATUS_STYLES: Record<string, BadgeStyle> = {
  draft: {
    bg: "bg-muted",
    text: "text-muted-foreground",
    ring: "ring-border",
  },
  confirmed: {
    bg: "bg-blue-50 dark:bg-blue-950/40",
    text: "text-blue-700 dark:text-blue-300",
    ring: "ring-blue-200 dark:ring-blue-800",
  },
  active: {
    bg: "bg-green-50 dark:bg-green-950/40",
    text: "text-green-700 dark:text-green-300",
    ring: "ring-green-200 dark:ring-green-800",
  },
  paid: {
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    text: "text-emerald-700 dark:text-emerald-300",
    ring: "ring-emerald-200 dark:ring-emerald-800",
  },
  pending: {
    bg: "bg-yellow-50 dark:bg-yellow-950/40",
    text: "text-yellow-700 dark:text-yellow-300",
    ring: "ring-yellow-200 dark:ring-yellow-800",
  },
  overdue: {
    bg: "bg-orange-50 dark:bg-orange-950/40",
    text: "text-orange-700 dark:text-orange-300",
    ring: "ring-orange-200 dark:ring-orange-800",
  },
  closed: {
    bg: "bg-slate-100 dark:bg-slate-800/50",
    text: "text-slate-600 dark:text-slate-400",
    ring: "ring-slate-200 dark:ring-slate-700",
  },
  cancelled: {
    bg: "bg-red-50 dark:bg-red-950/40",
    text: "text-red-600 dark:text-red-400",
    ring: "ring-red-200 dark:ring-red-800",
  },
  failed: {
    bg: "bg-destructive/10 dark:bg-destructive/20",
    text: "text-destructive",
    ring: "ring-destructive/20 dark:ring-destructive/40",
  },
};

/** Fallback style for unknown statuses. */
const UNKNOWN_STYLE: BadgeStyle = {
  bg: "bg-muted",
  text: "text-muted-foreground",
  ring: "ring-border",
};

function toTitleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, " ");
}

// ---------------------------------------------------------------------------
// Component — pure server component (no interaction required)
// ---------------------------------------------------------------------------

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const key = status.toLowerCase();
  const style = STATUS_STYLES[key] ?? UNKNOWN_STYLE;
  const displayLabel = label ?? toTitleCase(status);

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        style.bg,
        style.text,
        style.ring,
        className
      )}
    >
      {displayLabel}
    </span>
  );
}
