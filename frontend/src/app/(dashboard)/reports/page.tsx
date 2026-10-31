import { BarChart2 } from "lucide-react";

export default function ReportsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Reports</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Financial and operational reports.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-muted/40 p-8 flex flex-col items-center gap-4 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted border border-border text-muted-foreground">
          <BarChart2 className="size-6" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-foreground">Coming Soon</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">
            Reports will provide exportable MRR, ARR, churn, and cohort analysis
            with date-range filtering and CSV download.
          </p>
        </div>
      </div>
    </div>
  );
}
