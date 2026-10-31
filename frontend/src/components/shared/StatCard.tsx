import { TrendingUp, TrendingDown, Minus, type LucideIcon } from "lucide-react";
import { cn } from "cn";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TrendDirection = "up" | "down" | "neutral";

export interface StatCardTrend {
  /** Numeric direction of the change. */
  direction: TrendDirection;
  /** Human-readable change label, e.g. "+12%" or "−3 this week". */
  label: string;
}

export interface StatCardProps {
  /** Card heading, e.g. "Monthly Revenue". */
  title: string;
  /** Primary value displayed prominently, e.g. "$48,230" or "142". */
  value: string | number;
  /** Optional supporting text shown below the value. */
  description?: string;
  /** Optional trend indicator. */
  trend?: StatCardTrend;
  /** Optional Lucide icon shown in the card header. */
  icon?: LucideIcon;
  /** Additional class on the outer card element. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TREND_ICON: Record<TrendDirection, LucideIcon> = {
  up: TrendingUp,
  down: TrendingDown,
  neutral: Minus,
};

const TREND_COLOUR: Record<TrendDirection, string> = {
  up: "text-green-600 dark:text-green-400",
  down: "text-red-600 dark:text-red-400",
  neutral: "text-muted-foreground",
};

// ---------------------------------------------------------------------------
// Component — pure server component (no interaction required)
// ---------------------------------------------------------------------------

export function StatCard({
  title,
  value,
  description,
  trend,
  icon: Icon,
  className,
}: StatCardProps) {
  const TrendIcon = trend ? TREND_ICON[trend.direction] : null;
  const trendColour = trend ? TREND_COLOUR[trend.direction] : "";

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-sm",
        className
      )}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-muted-foreground leading-tight">
          {title}
        </p>
        {Icon && (
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
            aria-hidden="true"
          >
            <Icon className="size-4" />
          </span>
        )}
      </div>

      {/* Value */}
      <p className="text-2xl font-semibold tracking-tight text-foreground leading-none">
        {value}
      </p>

      {/* Trend + description */}
      {(trend || description) && (
        <div className="flex flex-col gap-0.5">
          {trend && TrendIcon && (
            <span
              className={cn(
                "inline-flex items-center gap-1 text-xs font-medium",
                trendColour
              )}
            >
              <TrendIcon className="size-3.5 shrink-0" aria-hidden="true" />
              {trend.label}
            </span>
          )}
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>
      )}
    </div>
  );
}
