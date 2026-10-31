// ---------------------------------------------------------------------------
// API Client
//
// A thin fetch wrapper that centralises base URL resolution, JSON
// serialisation, authentication headers and error normalisation.
//
// Base URL is read from the NEXT_PUBLIC_API_URL environment variable so it
// can be configured per-environment without code changes. No endpoint paths
// are hardcoded here — callers supply them.
//
// Usage:
//   import { apiClient } from "@/lib/api-client";
//
//   // GET
//   const { data } = await apiClient.get<Subscription[]>("/subscriptions");
//
//   // POST with auth token
//   const { data } = await apiClient.post<Invoice>("/invoices", body, {
//     token: "Bearer eyJ...",
//   });
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
   * Bearer token to attach as `Authorization: Bearer <token>`.
   * Pass the raw token string — the "Bearer " prefix is added automatically.
   */
  token?: string;
  /** Additional headers merged with the defaults. */
  headers?: Record<string, string>;
  /** AbortSignal for request cancellation. */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_URL;
  if (!url) {
    // Warn clearly during development; fail gracefully in production.
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[api-client] NEXT_PUBLIC_API_URL is not set. " +
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

  if (options?.token) {
    headers["Authorization"] = `Bearer ${options.token}`;
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
 * Execute a fetch request and normalise errors into `ApiError`.
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
    // Attempt to read a server-supplied error message from the body.
    let serverMessage: string | undefined;
    try {
      const errorBody = await parseBody<{ message?: string; detail?: string }>(
        response
      );
      serverMessage =
        errorBody?.message ?? errorBody?.detail ?? undefined;
    } catch {
      // Ignore parse failures on error responses.
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
