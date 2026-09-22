"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

function subscribeToLocalStorage(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

/**
 * Hydration-safe read of a single localStorage key: renders `defaultValue` on the server and
 * during the client's initial hydration pass (via the getServerSnapshot argument), then swaps to
 * the real persisted value once mounted through useSyncExternalStore's own client resync -
 * instead of a setState call inside a useEffect, which would itself be the same class of
 * hydration-mismatch bug this is meant to avoid.
 */
export function useStoredSnapshot<T>(key: string, defaultValue: T, parse: (raw: string) => T): T {
  return useSyncExternalStore(
    subscribeToLocalStorage,
    () => {
      if (typeof window === "undefined") {
        return defaultValue;
      }
      const raw = window.localStorage.getItem(key);
      return raw === null ? defaultValue : parse(raw);
    },
    () => defaultValue,
  );
}

/**
 * Seeds a normal, freely-mutable useState from useStoredSnapshot's hydration-safe restored value.
 * Re-seeds once when the restored value changes after mount, using React's documented "adjust
 * state while rendering" pattern instead of an effect.
 */
function useRestoredState<T>(key: string, defaultValue: T, parse: (raw: string) => T): [T, (value: T) => void] {
  const restored = useStoredSnapshot(key, defaultValue, parse);
  const [seed, setSeed] = useState(restored);
  const [value, setValue] = useState(restored);

  if (restored !== seed) {
    setSeed(restored);
    setValue(restored);
  }

  return [value, setValue];
}

/**
 * Both hooks below skip persisting on their very first effect firing (mount). Without that
 * guard, a save effect keyed on the same value fires on mount too (its dependency "changes" from
 * nothing to the SSR-safe default), and can win a race against useRestoredState's resync -
 * writing the default back to localStorage and permanently clobbering a real saved value before
 * the restore ever applies. Skipping the first firing means the hook only ever writes a value
 * the user (or the restore) actually produced.
 */
function useSkipFirst(): () => boolean {
  const isFirstRef = useRef(true);
  return () => {
    if (isFirstRef.current) {
      isFirstRef.current = false;
      return true;
    }
    return false;
  };
}

/**
 * A useState-like [value, setValue] pair that's restored from localStorage once (hydration-safe)
 * and written back immediately on every change thereafter.
 */
export function useLocalStorageState<T>(
  key: string,
  defaultValue: T,
  parse: (raw: string) => T,
  serialize: (value: T) => string = String,
): [T, (value: T) => void] {
  const [value, setValue] = useRestoredState(key, defaultValue, parse);
  const isFirst = useSkipFirst();

  useEffect(() => {
    if (isFirst()) {
      return;
    }
    window.localStorage.setItem(key, serialize(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value]);

  return [value, setValue];
}

/**
 * Same as useLocalStorageState, but debounces the localStorage write by debounceMs - for
 * high-frequency changes like typing into a textarea, so every keystroke doesn't hit
 * localStorage.
 */
export function useDebouncedLocalStorageState<T>(
  key: string,
  defaultValue: T,
  parse: (raw: string) => T,
  debounceMs: number,
  serialize: (value: T) => string = String,
): [T, (value: T) => void] {
  const [value, setValue] = useRestoredState(key, defaultValue, parse);
  const isFirst = useSkipFirst();

  useEffect(() => {
    if (isFirst()) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      window.localStorage.setItem(key, serialize(value));
    }, debounceMs);

    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value, debounceMs]);

  return [value, setValue];
}

function subscribeNever(): () => void {
  return () => {};
}

/**
 * True once mounted on the client, false during SSR and the client's initial hydration render -
 * the same useSyncExternalStore two-snapshot trick as useStoredSnapshot above, generalized for
 * gating any one-time, client-only side effect (e.g. generating random content) without a
 * setState call inside a useEffect.
 */
export function useIsMountedOnClient(): boolean {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}
