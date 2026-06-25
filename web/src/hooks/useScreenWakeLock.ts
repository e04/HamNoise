import { useEffect, useRef } from "react";

type WakeLockSentinel = EventTarget & {
  released: boolean;
  release: () => Promise<void>;
};

type WakeLock = {
  request: (type: "screen") => Promise<WakeLockSentinel>;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: WakeLock;
};

export function useScreenWakeLock(enabled: boolean) {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!enabled) {
      void wakeLockRef.current?.release();
      wakeLockRef.current = null;
      return;
    }

    let cancelled = false;

    const requestWakeLock = async () => {
      const wakeLock = (navigator as WakeLockNavigator).wakeLock;
      if (!wakeLock || document.visibilityState !== "visible") {
        return;
      }

      try {
        const sentinel = await wakeLock.request("screen");
        if (cancelled) {
          void sentinel.release();
          return;
        }

        wakeLockRef.current = sentinel;
        sentinel.addEventListener("release", () => {
          if (wakeLockRef.current === sentinel) {
            wakeLockRef.current = null;
          }
        });
      } catch (error) {
        console.warn("Failed to acquire screen wake lock.", error);
      }
    };

    const handleVisibilityChange = () => {
      if (
        document.visibilityState === "visible" &&
        wakeLockRef.current == null
      ) {
        void requestWakeLock();
      }
    };

    void requestWakeLock();
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void wakeLockRef.current?.release();
      wakeLockRef.current = null;
    };
  }, [enabled]);
}
