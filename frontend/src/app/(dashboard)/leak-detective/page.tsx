import { Search } from "lucide-react";

export default function LeakDetectivePage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Leak Detective</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Identify revenue leakage patterns across subscriptions.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-muted/40 p-8 flex flex-col items-center gap-4 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted border border-border text-muted-foreground">
          <Search className="size-6" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-foreground">Coming Soon</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">
            Leak Detective will automatically flag billing anomalies, missed
            renewals, and pricing discrepancies that cause revenue leakage.
          </p>
        </div>
      </div>
    </div>
  );
}
