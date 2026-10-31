"use client";

import { useState, useMemo, useId } from "react";
import { ChevronLeft, ChevronRight, Search, ChevronsUpDown } from "lucide-react";
import { cn } from "cn";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ColumnDef<TRow> {
  /** Unique key matching a property of TRow, or a custom identifier. */
  key: string;
  /** Column header label. */
  header: string;
  /** Custom cell renderer. Defaults to `String(row[key])`. */
  cell?: (row: TRow) => React.ReactNode;
  /** CSS class applied to both th and td for this column. */
  className?: string;
  /** Allow this column to be hidden on small screens (adds a responsive class). */
  hideOnMobile?: boolean;
}

export interface DataTableProps<TRow extends Record<string, unknown>> {
  /** Column definitions. */
  columns: ColumnDef<TRow>[];
  /** Row data. Each row must have a unique identifier field. */
  data: TRow[];
  /** Key in TRow used as the React list key. Defaults to "id". */
  rowKey?: keyof TRow;
  /** Number of rows per page. Defaults to 10. */
  pageSize?: number;
  /** Placeholder text for the search input. */
  searchPlaceholder?: string;
  /**
   * Fields to include in text search. Searches all string/number fields
   * when omitted.
   */
  searchKeys?: (keyof TRow)[];
  /** Optional slot rendered between the search bar and the table. */
  filterControls?: React.ReactNode;
  /** Message shown when no rows match. */
  emptyMessage?: string;
  /** Additional class on the outer wrapper. */
  className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchesSearch<TRow extends Record<string, unknown>>(
  row: TRow,
  query: string,
  keys?: (keyof TRow)[]
): boolean {
  const q = query.toLowerCase();
  const fields = keys ?? (Object.keys(row) as (keyof TRow)[]);
  return fields.some((k) => {
    const v = row[k];
    return (typeof v === "string" || typeof v === "number") &&
      String(v).toLowerCase().includes(q);
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DataTable<TRow extends Record<string, unknown>>({
  columns,
  data,
  rowKey = "id" as keyof TRow,
  pageSize = 10,
  searchPlaceholder = "Search…",
  searchKeys,
  filterControls,
  emptyMessage = "No results found.",
  className,
}: DataTableProps<TRow>) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const searchId = useId();

  const filtered = useMemo(
    () =>
      query.trim()
        ? data.filter((row) => matchesSearch(row, query, searchKeys))
        : data,
    [data, query, searchKeys]
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);

  const pageRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, safePage, pageSize]);

  // Reset to page 1 when search changes
  const handleSearch = (value: string) => {
    setQuery(value);
    setPage(1);
  };

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label="Search table"
            className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
          />
        </div>
        {filterControls && <div className="flex items-center gap-2">{filterControls}</div>}
      </div>

      {/* Table scroll wrapper */}
      <div className="w-full overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    "px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                    col.hideOnMobile && "hidden sm:table-cell",
                    col.className
                  )}
                >
                  <span className="flex items-center gap-1">
                    {col.header}
                    <ChevronsUpDown className="size-3 text-muted-foreground/50" aria-hidden="true" />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-3 py-12 text-center text-sm text-muted-foreground"
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              pageRows.map((row) => (
                <tr
                  key={String(row[rowKey])}
                  className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        "px-3 py-2.5 text-foreground",
                        col.hideOnMobile && "hidden sm:table-cell",
                        col.className
                      )}
                    >
                      {col.cell
                        ? col.cell(row)
                        : col.key in row
                          ? String(row[col.key] ?? "")
                          : ""}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {filtered.length === 0
            ? "0 results"
            : `${(safePage - 1) * pageSize + 1}–${Math.min(
                safePage * pageSize,
                filtered.length
              )} of ${filtered.length}`}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={safePage === 1}
            aria-label="Previous page"
            className="flex items-center justify-center rounded-md p-1 hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="min-w-[4rem] text-center text-xs">
            Page {safePage} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
            aria-label="Next page"
            className="flex items-center justify-center rounded-md p-1 hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
