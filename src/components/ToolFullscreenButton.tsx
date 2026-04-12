"use client";

import { Maximize2, Minimize2 } from "lucide-react";

type ToolFullscreenButtonProps = {
  isFullscreen: boolean;
  onToggle: () => void;
  supported: boolean;
};

export default function ToolFullscreenButton({
  isFullscreen,
  onToggle,
  supported,
}: ToolFullscreenButtonProps) {
  if (!supported) {
    return null;
  }

  return (
    <button
      className="btn btnSecondary"
      onClick={onToggle}
      title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      type="button"
    >
      {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
      {isFullscreen ? "Exit fullscreen" : "Fullscreen"}
    </button>
  );
}
