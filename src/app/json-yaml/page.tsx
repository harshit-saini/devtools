"use client";

import { useMemo, useState } from "react";
import { ArrowRightLeft, Clipboard, Eraser, FileJson } from "lucide-react";
import ToolFullscreenButton from "@/components/ToolFullscreenButton";
import { useToolFullscreen } from "@/components/useToolFullscreen";
import styles from "./tool.module.css";

function toYaml(value: unknown, indent = 0): string {
  const space = "  ".repeat(indent);
  if (Array.isArray(value)) {
    return value.map((item) => `${space}- ${toYaml(item, indent + 1).trimStart()}`).join("\n");
  }

  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        if (item && typeof item === "object") {
          return `${space}${key}:\n${toYaml(item, indent + 1)}`;
        }
        return `${space}${key}: ${String(item ?? "null")}`;
      })
      .join("\n");
  }

  return `${value ?? "null"}`;
}

export default function Page() {
  const { containerRef, isFullscreen, fullscreenSupported, toggleFullscreen } = useToolFullscreen<HTMLDivElement>();
  const [jsonInput, setJsonInput] = useState('{\n  "name": "theme",\n  "colors": ["#111827", "#60a5fa"]\n}');
  const [yamlOutput, setYamlOutput] = useState("");
  const [error, setError] = useState("");

  const stats = useMemo(() => ({ input: jsonInput.length, output: yamlOutput.length }), [jsonInput.length, yamlOutput.length]);

  const convert = () => {
    try {
      setYamlOutput(toYaml(JSON.parse(jsonInput)));
      setError("");
    } catch {
      setError("Invalid JSON input.");
    }
  };

  const clearAll = () => {
    setJsonInput("");
    setYamlOutput("");
    setError("");
  };

  const copyValue = async (value: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
  };

  return (
    <div ref={containerRef} className={`${styles.container} pageShell animate-enter ${isFullscreen ? "toolFullscreen" : ""}`}>
      <header className="toolHeader">
        <div className="toolTitleRow">
          <span className="toolIconBadge"><FileJson size={20} /></span>
          <div>
            <h2 className="toolTitle">JSON to YAML</h2>
            <p className="toolSubtitle">Convert JSON into readable YAML locally in your browser.</p>
          </div>
        </div>
        <div className={styles.actions}>
          <ToolFullscreenButton isFullscreen={isFullscreen} onToggle={toggleFullscreen} supported={fullscreenSupported} />
          <button className="btn btnSecondary" onClick={convert}><ArrowRightLeft size={14} />Convert</button>
          <button className="btn btnDanger" onClick={clearAll}><Eraser size={14} />Clear</button>
        </div>
      </header>

      <div className="toolMetaRow">
        <span className="statusChip">Input chars: {stats.input}</span>
        <span className="statusChip">Output chars: {stats.output}</span>
        {error && <span className={styles.errorChip}>{error}</span>}
      </div>

      <section className={styles.grid}>
        <article className={`${styles.card} panel`}>
          <div className={styles.cardHead}>
            <h3>JSON Input</h3>
            <button className="btn btnSecondary" onClick={() => copyValue(jsonInput)}><Clipboard size={15} />Copy</button>
          </div>
          <textarea
            className={styles.textarea}
            value={jsonInput}
            onChange={(event) => setJsonInput(event.target.value)}
            placeholder="Paste JSON here..."
            spellCheck={false}
          />
        </article>

        <article className={`${styles.card} panel`}>
          <div className={styles.cardHead}>
            <h3>YAML Output</h3>
            <button className="btn btnSecondary" onClick={() => copyValue(yamlOutput)}><Clipboard size={15} />Copy</button>
          </div>
          <textarea className={styles.textarea} value={yamlOutput} readOnly placeholder="Converted YAML appears here..." spellCheck={false} />
        </article>
      </section>
    </div>
  );
}
