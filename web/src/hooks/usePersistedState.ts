import { useCallback, useEffect, useState } from "react";

const KEY_PREFIX = "hamnoise.web.";

function read<T>(key: string, fallback: T, validate?: (value: unknown) => value is T): T {
  try {
    const raw = window.localStorage?.getItem(KEY_PREFIX + key);
    if (raw === null || raw === undefined) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (validate && !validate(parsed)) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

// Small persisted-state hook mirroring the DeepCW pattern: one localStorage key
// per setting, JSON-encoded, validated on read.
export function usePersistedState<T>(
  key: string,
  fallback: T,
  validate?: (value: unknown) => value is T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => read(key, fallback, validate));

  useEffect(() => {
    try {
      window.localStorage?.setItem(KEY_PREFIX + key, JSON.stringify(value));
    } catch {
      // Ignore storage write failures (private mode, quota, etc.).
    }
  }, [key, value]);

  const set = useCallback((next: T) => setValue(next), []);

  return [value, set];
}
