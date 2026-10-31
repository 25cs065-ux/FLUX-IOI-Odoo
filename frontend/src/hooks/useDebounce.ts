import { useState, useEffect } from "react";

/**
 * useDebounce
 *
 * Returns a debounced copy of `value` that only updates after `delay`
 * milliseconds of inactivity. Cleans up the timer on unmount or when
 * the value changes before the delay fires.
 *
 * @example
 * const debouncedQuery = useDebounce(searchQuery, 300);
 * // use debouncedQuery to trigger API calls
 */
export function useDebounce<T>(value: T, delay: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}
