import { useState, useCallback, useEffect, useLayoutEffect, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AsyncStatus = "idle" | "loading" | "success" | "error";

export interface AsyncState<T> {
  /** Current lifecycle status. */
  status: AsyncStatus;
  /** Result data, available when status is "success". */
  data: T | null;
  /** Error thrown by the async function, available when status is "error". */
  error: Error | null;
  /** True while the async function is in flight. */
  isLoading: boolean;
  /** True when the async function resolved successfully. */
  isSuccess: boolean;
  /** True when the async function threw. */
  isError: boolean;
}

export interface UseAsyncReturn<T, Args extends unknown[]>
  extends AsyncState<T> {
  /**
   * Execute the async function. Concurrent calls are safe — only the result
   * of the most-recent call is applied to state.
   */
  execute: (...args: Args) => Promise<T | null>;
  /** Reset all state back to idle. */
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * useAsync
 *
 * Wraps an async function and exposes loading, data and error states.
 * Handles stale responses so that only the latest call updates state.
 * Cleans up safely when the component unmounts mid-flight.
 *
 * @example
 * const { execute, data, isLoading, error } = useAsync(
 *   (id: string) => apiClient.get<Subscription>(`/subscriptions/${id}`)
 * );
 *
 * // Trigger from an event:
 * await execute(subscriptionId);
 */
export function useAsync<T, Args extends unknown[] = []>(
  asyncFn: (...args: Args) => Promise<T>
): UseAsyncReturn<T, Args> {
  const [state, setState] = useState<AsyncState<T>>({
    status: "idle",
    data: null,
    error: null,
    isLoading: false,
    isSuccess: false,
    isError: false,
  });

  // Track the invocation counter so stale calls don't clobber newer ones.
  const callIdRef = useRef(0);
  // Track whether the component is still mounted to skip state updates on
  // unmounted components.
  const mountedRef = useRef(true);

  // Keep asyncFn stable across renders — callers often pass an inline arrow.
  // Updated after render (refs must not be written during render).
  const asyncFnRef = useRef(asyncFn);
  useLayoutEffect(() => {
    asyncFnRef.current = asyncFn;
  });

  // Mark unmounted so late results don't set state on an unmounted component.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const execute = useCallback(async (...args: Args): Promise<T | null> => {
    const callId = ++callIdRef.current;

    setState({
      status: "loading",
      data: null,
      error: null,
      isLoading: true,
      isSuccess: false,
      isError: false,
    });

    try {
      const result = await asyncFnRef.current(...args);

      if (mountedRef.current && callId === callIdRef.current) {
        setState({
          status: "success",
          data: result,
          error: null,
          isLoading: false,
          isSuccess: true,
          isError: false,
        });
      }

      return result;
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error(String(err));

      if (mountedRef.current && callId === callIdRef.current) {
        setState({
          status: "error",
          data: null,
          error,
          isLoading: false,
          isSuccess: false,
          isError: true,
        });
      }

      return null;
    }
  }, []); // stable — asyncFn changes are handled via asyncFnRef

  const reset = useCallback(() => {
    callIdRef.current++;
    setState({
      status: "idle",
      data: null,
      error: null,
      isLoading: false,
      isSuccess: false,
      isError: false,
    });
  }, []);

  return { ...state, execute, reset };
}
