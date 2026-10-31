// ---------------------------------------------------------------------------
// API Client
//
// A thin fetch wrapper that centralises base URL resolution, JSON
// serialisation, authentication headers and error normalisation.
//
// Base URL is read from NEXT_PUBLIC_BACKEND_URL (browser-accessible).
// No endpoint paths are hardcoded here — callers supply them.
//
// Usage:
//   import { apiClient, buildQuery } from "@/lib/api-client";
//
//   // GET with query params
//   const { data } = await apiClient.get<Subscription[]>(
//     "/subscriptions" + buildQuery({ status: "active", limit: 20 }),
//     { token }
//   );
//
//   // POST with auth token — pass the raw Supabase access_token string;
//   // the "Bearer " prefix is added automatically.
//   const { data } = await apiClient.post<Invoice>("/invoices", body, { token });
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
}

// ---------------------------------------------------------------------------
// Query-parameter builder
// ---------------------------------------------------------------------------

/**
 * Build a URL query string from a plain object, omitting null/undefined values.
 *
 * buildQuery({ status: "active", limit: 20, offset: undefined })
 *   → "?status=active&limit=20"
 *
 * Returns "" (empty string) when the object has no defined values.
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
  const url = process.env.NEXT_PUBLIC_BACKEND_URL;
  if (!url) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[api-client] NEXT_PUBLIC_BACKEND_URL is not set. " +
          "API requests will be made to a relative path."
      );
    }
    return "";
  }
  // Strip a trailing slash so callers can always prefix paths with "/".
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function buildHeaders(options?: RequestOptions): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // Accept a raw token string — never double-prefix.
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

/**
 * Parse the response body.
 * Returns `null` for 204 No Content or any empty body.
 */
async function parseBody<T>(response: Response): Promise<T | null> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (
    response.status === 204 ||
    !contentType.includes("application/json")
  ) {
    return null;
  }

  const text = await response.text();
  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(response.status, `Invalid JSON response: ${text.slice(0, 120)}`);
  }
}

/**
 * Normalise the FastAPI `detail` field, which can be either:
 *   - a string   e.g. "Subscription is already active"
 *   - an array   e.g. [{ type, loc, msg }]  (Pydantic validation errors)
 */
function parseDetail(
  detail: string | Array<{ msg?: string; message?: string }> | undefined
): string | undefined {
  if (!detail) return undefined;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((d) => d.msg ?? d.message ?? "Validation error").join("; ");
  }
  return undefined;
}

/**
 * Execute a fetch request and normalise errors into `ApiError`.
 *
 * Special status codes:
 *   409 — conflict (e.g. duplicate, invalid state transition)
 *   503 — auth service unavailable (Supabase not configured on server)
 */
async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: RequestOptions
): Promise<{ data: T | null; status: number }> {
  const url = `${getBaseUrl()}${path}`;

  let response: Response;

  try {
    response = await fetch(url, {
      method,
      headers: buildHeaders(options),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: options?.signal,
    });
  } catch (err) {
    // Network error (DNS failure, connection refused, CORS pre-flight blocked…)
    const message =
      err instanceof Error ? err.message : "Network request failed";
    throw new ApiError(0, message);
  }

  if (!response.ok) {
    // Special-case human-readable messages for well-known codes.
    if (response.status === 503) {
      throw new ApiError(503, "Authentication service is unavailable. Check server configuration.");
    }

    // Attempt to read a server-supplied error message from the body.
    let serverMessage: string | undefined;
    try {
      const errorBody = await parseBody<{
        message?: string;
        detail?: string | Array<{ msg?: string; message?: string }>;
      }>(response);
      serverMessage =
        errorBody?.message ??
        parseDetail(errorBody?.detail) ??
        undefined;
    } catch {
      // Ignore parse failures on error responses.
    }

    if (response.status === 409) {
      throw new ApiError(409, serverMessage ?? "Conflict — the action cannot be completed in the current state.");
    }

    throw new ApiError(
      response.status,
      serverMessage ?? (response.statusText || `HTTP ${response.status}`)
    );
  }

  const data = await parseBody<T>(response);
  return { data, status: response.status };
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
