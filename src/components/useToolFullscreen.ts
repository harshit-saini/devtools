"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

function subscribeToNothing() {
  return () => {};
}

function getFullscreenSupported() {
  return typeof document !== "undefined" ? Boolean(document.fullscreenEnabled) : false;
}

function getFullscreenSupportedServerSnapshot() {
  return false;
}

export function useToolFullscreen<T extends HTMLElement>() {
  const containerRef = useRef<T | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // Browser fullscreen support is unknown during SSR. Using useSyncExternalStore (rather than
  // computing this at render time) makes the server/client value intentionally mismatch-safe:
  // React renders `false` on the server and during hydration, then re-checks after mount.
  const fullscreenSupported = useSyncExternalStore(
    subscribeToNothing,
    getFullscreenSupported,
    getFullscreenSupportedServerSnapshot,
  );

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    onFullscreenChange();

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  const toggleFullscreen = async () => {
    if (!containerRef.current || !document.fullscreenEnabled) {
      return;
    }

    try {
      if (document.fullscreenElement === containerRef.current) {
        await document.exitFullscreen();
      } else {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        }

        await containerRef.current.requestFullscreen();
      }
    } catch {
      // Ignore browser fullscreen errors (for example blocked by browser policy).
    }
  };

  return {
    containerRef,
    isFullscreen,
    fullscreenSupported,
    toggleFullscreen,
  };
}
