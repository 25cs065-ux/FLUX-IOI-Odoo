import { Package } from "lucide-react";

// Products backend router is not yet merged into develop.
// This page will be wired to /products once the backend is available.

export default function ProductsPage() {
  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-foreground">Products</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Manage your product catalogue and variants.
        </p>
      </div>

      {/* Coming soon card */}
      <div className="rounded-xl border border-border bg-muted/40 p-8 flex flex-col items-center gap-4 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted border border-border text-muted-foreground">
          <Package className="size-6" />
        </span>
        <div>
          <h2 className="text-base font-semibold text-foreground">Coming Soon</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">
            The Products module is being implemented. Once the backend router is
            merged into <code className="text-xs bg-muted border border-border rounded px-1 py-0.5">develop</code>,
            this page will display the full product catalogue with variant management.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
          Planned route: <code>GET /products</code> · <code>POST /products</code> ·{" "}
          <code>PATCH /products/{"{id}"}</code>
        </div>
      </div>
    </div>
  );
}
