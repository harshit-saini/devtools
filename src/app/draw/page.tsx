"use client";

import { PencilRuler } from "lucide-react";
import ExcalidrawWrapper from "@/components/ExcalidrawWrapper";
import styles from "./draw.module.css";
import ToolFullscreenButton from "@/components/ToolFullscreenButton";
import { useToolFullscreen } from "@/components/useToolFullscreen";

export default function DrawTool() {
  const { containerRef, isFullscreen, fullscreenSupported, toggleFullscreen } =
    useToolFullscreen<HTMLDivElement>();

  return (
    <div
      ref={containerRef}
      className={`${styles.container} pageShell animate-enter ${isFullscreen ? "toolFullscreen" : ""}`}
    >
      <header className="toolHeader">
        <div>
          <div className="toolTitleRow">
            <span className="toolIconBadge">
              <PencilRuler size={22} />
            </span>
            <div>
              <h2 className="toolTitle">Drawing Pad</h2>
              <p className="toolSubtitle">Sketch flows, architecture, and ideas with Excalidraw and local autosave.</p>
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          <ToolFullscreenButton
            isFullscreen={isFullscreen}
            onToggle={toggleFullscreen}
            supported={fullscreenSupported}
          />
        </div>
      </header>

      <section className={`${styles.canvasCard} panel`}>
        <ExcalidrawWrapper />
      </section>
    </div>
  );
}
