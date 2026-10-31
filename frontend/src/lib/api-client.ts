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
  const { supabase } = await import("@/lib/supabase");
  await supabase.auth.signOut();
  window.location.replace("/login");
}

// ---------------------------------------------------------------------------
// Public API client
// ---------------------------------------------------------------------------

export const apiClient = {
  /** GET request. */
  get<T>(path: string, options?: RequestOptions) {
    return request<T>("GET", path, undefined, options);
  },

  /** POST request with a JSON body. */
  post<T>(path: string, body: unknown, options?: RequestOptions) {
    return request<T>("POST", path, body, options);
  },

  /** PUT request with a JSON body. */
  put<T>(path: string, body: unknown, options?: RequestOptions) {
    return request<T>("PUT", path, body, options);
  },

  /** PATCH request with a partial JSON body. */
  patch<T>(path: string, body: unknown, options?: RequestOptions) {
    return request<T>("PATCH", path, body, options);
  },

  /** DELETE request. Body is optional. */
  delete<T>(path: string, body?: unknown, options?: RequestOptions) {
    return request<T>("DELETE", path, body, options);
  },
} as const;

export async function getAllPages<T>(
  path: string,
  pageSize = 100,
  options?: RequestOptions
): Promise<T[]> {
  const safePageSize = Math.min(Math.max(pageSize, 1), 100);
  const items: T[] = [];
  let offset = 0;

  while (true) {
    const pagination = buildQuery({ limit: safePageSize, offset });
    const query = pagination.slice(1);
    const separator = path.includes("?") ? "&" : "";
    const { data } = await apiClient.get<T[]>(
      `${path}${separator}${query}`,
      options
    );
    if (!data) throw new ApiError(200, `The ${path} endpoint returned no data.`);
    items.push(...data);
    if (data.length < safePageSize) return items;
    offset += safePageSize;
  }
}
