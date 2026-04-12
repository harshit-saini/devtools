"use client";

import { useEffect, useRef, useState } from "react";

export function useToolFullscreen<T extends HTMLElement>() {
  const containerRef = useRef<T | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const fullscreenSupported =
    typeof document !== "undefined" ? Boolean(document.fullscreenEnabled) : false;

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
