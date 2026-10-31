// ---------------------------------------------------------------------------
// API Client
//
// Thin fetch wrapper centralising:
//   - Base URL:  NEXT_PUBLIC_API_URL (default http://localhost:8000)
//   - Auth:      Bearer <supabase_access_token>
//   - Errors:    ApiError with typed status + message
//   - 401 flow:  refresh session once → retry → sign-out + redirect to /login
//
// Token lifecycle (callers don't need to manage this):
//   - Pass { token } in RequestOptions for authenticated requests.
//   - The refresh+retry path is handled automatically inside `request()`.
//   - Never falls back to mock data on 401 or 403 — it throws ApiError.
//
// Usage:
//   import { apiClient, buildQuery } from "@/lib/api-client";
//
//   // Authenticated GET
//   const token = await getSupabaseToken();
//   const { data } = await apiClient.get<Subscription[]>(
//     "/subscriptions" + buildQuery({ status: "active", limit: 20 }),
//     { token }
//   );
//
//   // Unauthenticated POST (public endpoint)
//   const { data } = await apiClient.post<Result>("/public/endpoint", body);
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Request options
// ---------------------------------------------------------------------------

export interface RequestOptions {
  /**
   * Raw Supabase access token (without "Bearer " prefix).
   * The prefix is added automatically in buildHeaders.
   */
  token?: string;
  /** Additional headers merged with the defaults. */
  headers?: Record<string, string>;
  /** AbortSignal for request cancellation. */
  signal?: AbortSignal;
  /**
   * Internal flag — set to true on the one automatic retry after a token
   * refresh. Prevents indefinite retry loops.
   */
  _isRetry?: boolean;
}

// ---------------------------------------------------------------------------
// Query-parameter builder
// ---------------------------------------------------------------------------

/**
 * Build a URL query string from a plain object, omitting null/undefined/empty values.
 *
 * buildQuery({ status: "active", limit: 20, offset: undefined })
 *   → "?status=active&limit=20"
 */
export function buildQuery(
  params: Record<string, string | number | boolean | null | undefined>
): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== null && v !== undefined && v !== ""
  );
  if (entries.length === 0) return "";
  const qs = entries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return `?${qs}`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getBaseUrl(): string {
  // NEXT_PUBLIC_API_URL is the canonical variable.
  // Fall back to NEXT_PUBLIC_BACKEND_URL for backward compatibility
  // with existing .env.local files that use the old name.
  const url =
    process.env.NEXT_PUBLIC_API_URL ??
    process.env.NEXT_PUBLIC_BACKEND_URL;

  if (!url) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[api-client] NEXT_PUBLIC_API_URL is not set. " +
          "Defaulting to http://localhost:8000. " +
          "Set NEXT_PUBLIC_API_URL in frontend/.env.local."
      );
    }
    return "http://localhost:8000";
  }
  // Strip a trailing slash so callers can always prefix paths with "/".
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function buildHeaders(options?: RequestOptions): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (options?.token) {
    const raw = options.token.startsWith("Bearer ")
      ? options.token
      : `Bearer ${options.token}`;
    headers["Authorization"] = raw;
  }

  if (options?.headers) {
    Object.assign(headers, options.headers);
  }

  return headers;
}

/** Parse the response body. Returns null for 204 or non-JSON responses. */
async function parseBody<T>(response: Response): Promise<T | null> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (
    response.status === 204 ||
    !contentType.includes("application/json")
  ) {
    return null;
  }

  const text = await response.text();
  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(
      response.status,
      `Invalid JSON response: ${text.slice(0, 120)}`
    );
  }
}

/**
 * Normalise the FastAPI `detail` field:
 *   - Shape A (422 field errors): array of { msg, loc }
 *   - Shape B (business rule): plain string
 */
function parseDetail(
  detail:
    | string
    | Array<{ msg?: string; message?: string; loc?: Array<string | number> }>
    | undefined
): string | undefined {
  if (!detail) return undefined;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        const location = item.loc
          ?.filter((part) => !["body", "query", "path"].includes(String(part)))
          .join(".");
        const message = item.msg ?? item.message ?? "Validation error";
        return location ? `${location}: ${message}` : message;
      })
      .join("; ");
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Core fetch + 401-refresh logic
// ---------------------------------------------------------------------------

/**
 * Execute a fetch request and normalise errors into ApiError.
 *
 * On 401: refresh the Supabase session once and retry with the new token.
 * If the retry also fails with 401/403, sign the user out and redirect to /login.
 *
 * Important: 401 and 403 are NEVER silently swallowed — they always throw.
 */
async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: RequestOptions
): Promise<{ data: T | null; status: number }> {
  const url = `${getBaseUrl()}${path}`;

  let token = options?.token;
  if (!token && typeof window !== "undefined") {
    const { getSupabaseToken } = await import("@/lib/supabase-token");
    token = (await getSupabaseToken()) ?? undefined;
  }

  if (!token) {
    const { refreshSupabaseSession } = await import("@/lib/supabase-token");
    const session = await refreshSupabaseSession();
    if (session?.access_token) {
      return request<T>(method, path, body, {
        ...options,
        token: session.access_token,
        _isRetry: true,
      });
    }
    await signOutAndRedirect();
    throw new ApiError(401, "Session expired. Please sign in again.");
  }

  const requestOptions = { ...options, token };
  let response: Response;

  try {
    response = await fetch(url, {
      method,
      headers: buildHeaders(requestOptions),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: requestOptions.signal,
    });
  } catch {
    throw new ApiError(
      0,
      `Unable to connect to the backend at ${getBaseUrl()}. Check that it is running and try again.`
    );
  }

  // ── 401: token expired — attempt one refresh + retry ────────────────────
  if (response.status === 401 && !requestOptions._isRetry) {
    const { refreshSupabaseSession } = await import("@/lib/supabase-token");

    const newSession = await refreshSupabaseSession();

    if (newSession?.access_token) {
      // Retry exactly once with the fresh token.
      return request<T>(method, path, body, {
        ...requestOptions,
        token: newSession.access_token,
        _isRetry: true,
      });
    }

    await signOutAndRedirect();
    throw new ApiError(401, "Session expired. Please sign in again.");
  }

  if (!response.ok) {
    // Special-case human-readable messages for well-known codes.
    if (response.status === 503) {
      throw new ApiError(
        503,
        "Authentication service is unavailable. Check server configuration."
      );
    }

    // Read server-supplied error message.
    let serverMessage: string | undefined;
    try {
      const errorBody = await parseBody<{
        message?: string;
        detail?: string | Array<{ msg?: string; message?: string; loc?: Array<string | number> }>;
      }>(response);
      serverMessage =
        errorBody?.message ?? parseDetail(errorBody?.detail) ?? undefined;
    } catch {
      // Ignore parse failures on error responses.
    }

    if (response.status === 401) {
      await signOutAndRedirect();
      throw new ApiError(401, serverMessage ?? "Unauthorized. Please sign in.");
    }

    if (response.status === 403) {
      throw new ApiError(
        403,
        serverMessage ?? "You do not have permission to perform this action."
      );
    }

    if (response.status === 409) {
      throw new ApiError(
        409,
        serverMessage ??
          "Conflict — the action cannot be completed in the current state."
      );
    }

    throw new ApiError(
      response.status,
      serverMessage ?? (response.statusText || `HTTP ${response.status}`)
    );
  }

  const data = await parseBody<T>(response);
  return { data, status: response.status };
}

async function signOutAndRedirect(): Promise<void> {
  if (typeof window === "undefined") return;
  clearApiCache();
  const { supabase } = await import("@/lib/supabase");
  await supabase.auth.signOut();
  window.location.replace("/login");
}

// ---------------------------------------------------------------------------
// GET cache
//
// Pages share lookup lists (customers, plans, subscriptions…) and React may
// mount a page twice. Identical GETs within GET_CACHE_MS reuse one request,
// including requests still in flight. The key includes the caller's token so
// two signed-in users never share data. Any successful POST/PUT/PATCH/DELETE
// clears the cache, and Refresh buttons call clearApiCache() first.
// ---------------------------------------------------------------------------

const GET_CACHE_MS = 30_000;
const getCache = new Map<string, { expires: number; promise: Promise<{ data: unknown; status: number }> }>();

/** Forget every cached GET response (call after a change or on Refresh). */
export function clearApiCache(): void {
  getCache.clear();
}

async function cachedGet<T>(path: string, options?: RequestOptions): Promise<{ data: T | null; status: number }> {
  // Resolve the token first so it can be part of the key.
  let token = options?.token;
  if (!token && typeof window !== "undefined") {
    const { getSupabaseToken } = await import("@/lib/supabase-token");
    token = (await getSupabaseToken()) ?? undefined;
  }
  const key = `${token ? token.slice(-24) : "anon"} ${path}`;
  const now = Date.now();
  const hit = getCache.get(key);
  if (hit && hit.expires > now) {
    return hit.promise as Promise<{ data: T | null; status: number }>;
  }
  const promise = request<T>("GET", path, undefined, { ...options, token });
  getCache.set(key, { expires: now + GET_CACHE_MS, promise });
  promise.catch(() => {
    // Never keep failures: the next call retries.
    if (getCache.get(key)?.promise === promise) getCache.delete(key);
  });
  return promise;
}

async function mutate<T>(method: string, path: string, body: unknown, options?: RequestOptions) {
  const result = await request<T>(method, path, body, options);
  clearApiCache();
  return result;
}

// ---------------------------------------------------------------------------
// Public API client
// ---------------------------------------------------------------------------

export const apiClient = {
  /** GET request (briefly cached and de-duplicated; see GET cache above). */
  get<T>(path: string, options?: RequestOptions) {
    return cachedGet<T>(path, options);
  },

  /** POST request with a JSON body. */
  post<T>(path: string, body: unknown, options?: RequestOptions) {
    return mutate<T>("POST", path, body, options);
  },

  /** PUT request with a JSON body. */
  put<T>(path: string, body: unknown, options?: RequestOptions) {
    return mutate<T>("PUT", path, body, options);
  },

  /** PATCH request with a partial JSON body. */
  patch<T>(path: string, body: unknown, options?: RequestOptions) {
    return mutate<T>("PATCH", path, body, options);
  },

  /** DELETE request. Body is optional. */
  delete<T>(path: string, body?: unknown, options?: RequestOptions) {
    return mutate<T>("DELETE", path, body, options);
  },
} as const;

// Largest `limit` each list endpoint accepts (larger values return HTTP 422).
const MAX_PAGE_SIZE: Array<[prefix: string, max: number]> = [
  ["/customers", 100],
];
const DEFAULT_MAX_PAGE_SIZE = 200;

function maxPageSize(path: string): number {
  return MAX_PAGE_SIZE.find(([prefix]) => path.startsWith(prefix))?.[1] ?? DEFAULT_MAX_PAGE_SIZE;
}

// Pages requested at the same time once a list turns out to need more than one.
const PAGE_CONCURRENCY = 4;

/**
 * Fetch every page of a list endpoint. `pageSize` is capped at the endpoint's
 * maximum, so callers can never trigger the backend's 422 for an oversized limit.
 *
 * The first page is fetched alone (most lists fit in it). Larger lists are then
 * fetched PAGE_CONCURRENCY pages at a time, so 1,200 customers take 4 round
 * trips instead of 13 one after another.
 */
export async function getAllPages<T>(
  path: string,
  pageSize = DEFAULT_MAX_PAGE_SIZE,
  options?: RequestOptions
): Promise<T[]> {
  const limit = Math.min(pageSize, maxPageSize(path));

  async function page(offset: number): Promise<T[]> {
    const pagination = buildQuery({ limit, offset });
    const url = path.includes("?") ? `${path}&${pagination.slice(1)}` : `${path}${pagination}`;
    const { data } = await apiClient.get<T[]>(url, options);
    if (!data) throw new ApiError(200, `The ${path} endpoint returned no data.`);
    return data;
  }

  const items = await page(0);
  if (items.length < limit) return items;

  let offset = limit;
  while (true) {
    const offsets = Array.from({ length: PAGE_CONCURRENCY }, (_, i) => offset + i * limit);
    const pages = await Promise.all(offsets.map(page));
    for (const data of pages) {
      items.push(...data);
      if (data.length < limit) return items;
    }
    offset += PAGE_CONCURRENCY * limit;
  }
}
