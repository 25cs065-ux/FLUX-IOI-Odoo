
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { UserCog, RefreshCw, WifiOff } from "lucide-react";
import { cn } from "cn";

import { DataTable, StatusBadge, StatCard, type ColumnDef } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { clearApiCache, getAllPages } from "@/lib/api-client";
import { getSupabaseToken } from "@/lib/supabase-token";
import { formatDate } from "@/lib/format";

interface StaffMember {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  address: string | null;
  auth_user_id: string | null;
  role: string;
  is_active: boolean;
  created_at: string | null;
}

function buildColumns(): ColumnDef<StaffMember>[] {
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
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
            row.role === "admin"
              ? "bg-purple-50 text-purple-700 ring-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:ring-purple-800"
              : "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-800"
          )}
        >
          {row.role.charAt(0).toUpperCase() + row.role.slice(1)}
        </span>
      ),
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

export default function StaffPage() {
  const [allStaff, setAllStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingMock, setUsingMock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<"all" | "staff" | "admin">("all");

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const token = await getSupabaseToken();
      // /customers/ accepts at most limit=100, so page through it; filter by role client-side.
      const data = await getAllPages<StaffMember>("/customers/", 100, token ? { token } : undefined);
      // Keep only staff and admin entries
      setAllStaff(data.filter((c) => c.role === "staff" || c.role === "admin"));
      setUsingMock(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load staff";

      setError(msg);
      setAllStaff([]);
      setUsingMock(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Start the fetch after the effect returns, so its setState calls don't run synchronously inside the effect.
    void Promise.resolve().then(() => fetchStaff());
  }, [fetchStaff]);

  const filtered = useMemo(
    () =>
      roleFilter === "all"
        ? allStaff
        : allStaff.filter((staff) => staff.role === roleFilter),
    [allStaff, roleFilter]
  );

  const stats = useMemo(
    () => ({
      total: allStaff.length,
      admins: allStaff.filter((staff) => staff.role === "admin").length,
      staff: allStaff.filter((staff) => staff.role === "staff").length,
      active: allStaff.filter((staff) => staff.is_active).length,
    }),
    [allStaff]
  );

  const columns = useMemo(() => buildColumns(), []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Staff</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Admin and staff members — fetched from the customers table by role
          </p>
        </div>

        <div className="flex items-center gap-2">
          {usingMock && (
            <span className="flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              <WifiOff className="size-3" />
              Offline
            </span>
          )}
          <Button variant="outline" size="sm" onClick={() => { clearApiCache(); void fetchStaff(); }} disabled={loading}>
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} /> Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard title="Total staff" value={stats.total} icon={UserCog} />
        <StatCard title="Admins" value={stats.admins} description="Admin role" />
        <StatCard title="Staff" value={stats.staff} description="Staff role" />
        <StatCard
          title="Active"
          value={stats.active}
          trend={{ direction: "up", label: "of total" }}
        />
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex gap-1">
          {(["all", "admin", "staff"] as const).map((role) => (
            <button
              key={role}
              onClick={() => setRoleFilter(role)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize transition-colors",
                roleFilter === role
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-muted"
              )}
            >
              {role === "all"
                ? "All"
                : role.charAt(0).toUpperCase() + role.slice(1)}
            </button>
          ))}
        </div>

        <DataTable<StaffMember>
          columns={columns}
          data={filtered}
          rowKey="id"
          pageSize={10}
          searchPlaceholder="Search staff…"
          searchKeys={["name", "email", "role"]}
          emptyMessage={
            loading
              ? "Loading…"
              : error
                ? "Failed to load."
                : "No staff members found."
          }
        />
      </div>
    </div>
  );
}
