"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Users, RefreshCw, Search } from "lucide-react";
import { cn } from "cn";

import { DataTable, StatusBadge, StatCard, type ColumnDef } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { buildQuery, clearApiCache, getAllPages } from "@/lib/api-client";
import { getSupabaseToken } from "@/lib/supabase-token";
import { useDebounce } from "@/hooks/useDebounce";
import { formatDate } from "@/lib/format";
import type { ApiCustomer } from "@/types/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Customer = ApiCustomer;

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

function buildColumns(): ColumnDef<Customer>[] {
  return [
    {
      key: "name",
      header: "Name",
      cell: (row) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: "email",
      header: "Email",
      cell: (row) => <span className="text-sm">{row.email}</span>,
    },
    {
      key: "phone",
      header: "Phone",
      cell: (row) => row.phone ?? <span className="text-muted-foreground/50">—</span>,
      hideOnMobile: true,
    },
    {
      key: "role",
      header: "Role",
      cell: (row) => (
        <span className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
          row.role === "admin"
            ? "bg-purple-50 text-purple-700 ring-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:ring-purple-800"
            : row.role === "staff"
              ? "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-800"
              : "bg-muted text-muted-foreground ring-border"
        )}>
          {row.role.charAt(0).toUpperCase() + row.role.slice(1)}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      key: "created_at",
      header: "Joined",
      cell: (row) => formatDate(row.created_at),
      hideOnMobile: true,
    },
    {
      key: "is_active",
      header: "Status",
      cell: (row) => (
        <StatusBadge
          status={row.is_active ? "active" : "closed"}
          label={row.is_active ? "Active" : "Inactive"}
        />
      ),
    },
  ];
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebounce(searchInput, 400);

  const fetchCustomers = useCallback(async () => {
    try {
      const token = await getSupabaseToken();
      setLoading(true);
      setError(null);
      // Page through every match (the endpoint returns at most 100 per request).
      const qs = buildQuery({ search: debouncedSearch || undefined });
      const data = await getAllPages<Customer>(`/customers/${qs}`, 100, token ? { token } : undefined);
      setCustomers(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load customers";
      setError(msg);
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch]);

  useEffect(() => {
    void Promise.resolve().then(() => fetchCustomers());
  }, [fetchCustomers]);

  const stats = useMemo(() => ({
    total: customers.length,
    active: customers.filter((c) => c.is_active).length,
    staff: customers.filter((c) => c.role === "staff").length,
    admins: customers.filter((c) => c.role === "admin").length,
  }), [customers]);

  const columns = useMemo(() => buildColumns(), []);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Customers</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">All customer accounts</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => { clearApiCache(); void fetchCustomers(); }} disabled={loading}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} /> Refresh
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard title="Total" value={stats.total} icon={Users} />
        <StatCard title="Active" value={stats.active} trend={{ direction: "up", label: "of total" }} />
        <StatCard title="Staff" value={stats.staff} description="Staff role accounts" />
        <StatCard title="Admins" value={stats.admins} description="Admin role accounts" />
      </div>

      {/* Search bar + table */}
      <div className="rounded-xl border border-border bg-card p-4">
        {/* Live search — debounced, hits the API */}
        <div className="relative mb-3 w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name or email…"
            className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </div>
        <DataTable<Customer>
          columns={columns}
          data={customers}
          rowKey="id"
          pageSize={10}
          searchPlaceholder="Filter loaded results…"
          searchKeys={["name", "email", "role"]}
          emptyMessage={loading ? "Loading…" : error ? "Failed to load." : "No customers found."}
        />
      </div>
    </div>
  );
}
