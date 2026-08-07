import { useEffect, useState } from "react";

/**
 * Returns `value` only after it has stopped changing for `delayMs`.
 *
 * The search box feeds a TanStack Query key, and a new key means a new fetch.
 * Without this, typing "Acme" fires four requests and the first three are
 * already stale by the time they land. Debouncing the value — rather than the
 * request — keeps the query key stable, so the cache isn't churned either.
 */
export function useDebouncedValue(value, delayMs = 300) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    // Cleanup cancels the pending update, so only the last keystroke in a
    // burst ever reaches state.
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
