import { Sliders } from "lucide-react";

export default function SimulatorPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Simulator</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Model pricing and revenue scenarios before going live.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-muted/40 p-8 flex flex-col items-center gap-4 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted border border-border text-muted-foreground">
          <Sliders className="size-6" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-foreground">Coming Soon</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">
            The Simulator will let you model pricing changes, plan adjustments,
            and revenue impact before applying them to live subscriptions.
          </p>
        </div>
      </div>
    </div>
  );
}
