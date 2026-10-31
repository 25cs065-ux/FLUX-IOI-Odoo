"use client";

import { useState, useEffect, useCallback } from "react";
import { Users, WifiOff } from "lucide-react";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { StatCard } from "@/components/shared/StatCard";
import { apiClient, buildQuery } from "@/lib/api-client";
import { getSupabaseToken } from "@/lib/supabase-token";
import { formatDate } from "@/lib/format";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Customer {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  role: string;
  is_active: boolean;
  created_at: string | null;
}

// ---------------------------------------------------------------------------
// Mock fallback
// ---------------------------------------------------------------------------

const MOCK_CUSTOMERS: Customer[] = [
  { id: "1", name: "Arjun Mehta", email: "arjun@example.com", phone: "+91 98765 43210", address: "Mumbai, MH", role: "customer", is_active: true, created_at: "2026-01-10T00:00:00Z" },
  { id: "2", name: "Priya Sharma", email: "priya@example.com", phone: "+91 91234 56789", address: "Bangalore, KA", role: "customer", is_active: true, created_at: "2026-02-15T00:00:00Z" },
  { id: "3", name: "Rohit Kapoor", email: "rohit@example.com", phone: null, address: null, role: "customer", is_active: false, created_at: "2026-03-01T00:00:00Z" },
];

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const COLUMNS: ColumnDef<Customer>[] = [
  {
    key: "name",
    header: "Name",
    cell: (r) => (
      <div>
        <div className="font-medium text-foreground">{r.name}</div>
        <div className="text-xs text-muted-foreground">{r.email}</div>
      </div>
    ),
  },
  { key: "phone", header: "Phone", cell: (r) => r.phone ?? "—", hideOnMobile: true },
  { key: "address", header: "Address", cell: (r) => r.address ?? "—", hideOnMobile: true },
  { key: "role", header: "Role", cell: (r) => <span className="capitalize">{r.role}</span> },
  {
    key: "is_active",
    header: "Status",
    cell: (r) => <StatusBadge status={r.is_active ? "active" : "closed"} label={r.is_active ? "Active" : "Inactive"} />,
  },
  { key: "created_at", header: "Joined", cell: (r) => formatDate(r.created_at), hideOnMobile: true },
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [usingMock, setUsingMock] = useState(false);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    setApiError(null);
    try {
      const token = await getSupabaseToken();
      const qs = buildQuery({ limit: 100 });
      const { data } = await apiClient.get<Customer[]>(`/customers${qs}`, token ? { token } : undefined);
      if (data && Array.isArray(data)) {
        setCustomers(data);
        setUsingMock(false);
      }
    } catch {
      setCustomers(MOCK_CUSTOMERS);
      setUsingMock(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  const active = customers.filter((c) => c.is_active).length;
  const inactive = customers.filter((c) => !c.is_active).length;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Customers</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            All registered customer profiles.
          </p>
        </div>
        {usingMock && (
          <span className="flex items-center gap-1.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
            <WifiOff className="size-3" />
            Demo data
          </span>
        )}
      </div>

      {/* Stat cards */}
      {!loading && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatCard title="Total Customers" value={customers.length} icon={Users} />
          <StatCard title="Active" value={active} />
          <StatCard title="Inactive" value={inactive} />
        </div>
      )}

      {/* Error */}
      {apiError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {apiError}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-border bg-card p-4">
        <DataTable
          columns={COLUMNS}
          data={customers}
          rowKey="id"
          searchPlaceholder="Search customers…"
          searchKeys={["name", "email", "phone"]}
          emptyMessage={loading ? "Loading…" : "No customers found."}
          pageSize={10}
        />
      </div>
    </div>
  );
}
