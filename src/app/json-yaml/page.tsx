"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Clipboard, Eraser, FileJson } from "lucide-react";
import ToolFullscreenButton from "@/components/ToolFullscreenButton";
import { useToolFullscreen } from "@/components/useToolFullscreen";
import styles from "./tool.module.css";

const SAMPLE_JSON = '{\n  "name": "theme",\n  "colors": ["#111827", "#60a5fa"]\n}';
const INPUT_KEY = "devtools.jsonYaml.input";

// YAML values need quoting/escaping whenever they contain characters that are significant to the
// YAML grammar - otherwise e.g. {"key": "a: b"} becomes `key: a: b`, which either fails to parse
// back or reparses to a different value than the original JSON.
const YAML_NEEDS_QUOTING = /^[\s]|[\s]$|^[-?:,[\]{}#&*!|>'"%@`]|: |:$|^$|[\n\t]/;

function formatYamlScalar(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  const text = String(value);
  if (YAML_NEEDS_QUOTING.test(text)) {
    return JSON.stringify(text);
  }

  return text;
}

function toYaml(value: unknown, indent = 0): string {
  const space = "  ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${space}[]`;
    }

    return value
      .map((item) => {
        if (item && typeof item === "object") {
          return `${space}- ${toYaml(item, indent + 1).trimStart()}`;
        }
        return `${space}- ${formatYamlScalar(item)}`;
      })
      .join("\n");
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return `${space}{}`;
    }

    return entries
      .map(([key, item]) => {
        const formattedKey = YAML_NEEDS_QUOTING.test(key) ? JSON.stringify(key) : key;
        if (item && typeof item === "object") {
          return `${space}${formattedKey}:\n${toYaml(item, indent + 1)}`;
        }
        return `${space}${formattedKey}: ${formatYamlScalar(item)}`;
      })
      .join("\n");
  }

  return `${space}${formatYamlScalar(value)}`;
}

function readLocalString(key: string, fallback: string): string {
  if (typeof window === "undefined") {
    return fallback;
  }

  return window.localStorage.getItem(key) ?? fallback;
}

export default function Page() {
  const { containerRef, isFullscreen, fullscreenSupported, toggleFullscreen } = useToolFullscreen<HTMLDivElement>();
  // Initial state intentionally matches what the server renders (the hardcoded sample, not
  // localStorage) so hydration never mismatches. Saved value is restored once, after mount, below.
  const [jsonInput, setJsonInput] = useState(SAMPLE_JSON);
  const [yamlOutput, setYamlOutput] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setJsonInput(readLocalString(INPUT_KEY, SAMPLE_JSON));
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      window.localStorage.setItem(INPUT_KEY, jsonInput);
    }, 400);
    return () => window.clearTimeout(timeoutId);
  }, [jsonInput]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeoutId = window.setTimeout(() => setNotice(""), 1600);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const stats = useMemo(() => ({ input: jsonInput.length, output: yamlOutput.length }), [jsonInput.length, yamlOutput.length]);

  const convert = () => {
    try {
      setYamlOutput(toYaml(JSON.parse(jsonInput)));
      setError("");
      setNotice("Converted to YAML");
    } catch {
      setError("Invalid JSON input.");
    }
  };

  const loadSample = () => {
    setJsonInput(SAMPLE_JSON);
    setYamlOutput("");
    setError("");
    setNotice("Sample loaded");
  };

  const clearAll = () => {
    setJsonInput("");
    setYamlOutput("");
    setError("");
  };

  const copyValue = async (value: string, label: string) => {
    if (!value) {
      setNotice(`No ${label.toLowerCase()} to copy`);
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied`);
    } catch {
      setNotice("Clipboard copy failed");
    }
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
          <button className="btn btnSecondary" onClick={loadSample}>Load sample</button>
          <button className="btn btnDanger" onClick={clearAll}><Eraser size={14} />Clear</button>
        </div>
      </header>

      <div className="toolMetaRow">
        <span className="statusChip">Input chars: {stats.input}</span>
        <span className="statusChip">Output chars: {stats.output}</span>
        {error && <span className={styles.errorChip}>{error}</span>}
        {notice && <span className={styles.notice}>{notice}</span>}
        <span role="status" aria-live="polite" className={styles.srOnly}>
          {error || notice}
        </span>
      </div>

      <section className={styles.grid}>
        <article className={`${styles.card} panel`}>
          <div className={styles.cardHead}>
            <h3>JSON Input</h3>
            <button className="btn btnSecondary" onClick={() => copyValue(jsonInput, "JSON input")}><Clipboard size={15} />Copy</button>
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
            <button className="btn btnSecondary" onClick={() => copyValue(yamlOutput, "YAML output")}><Clipboard size={15} />Copy</button>
          </div>
          <textarea className={styles.textarea} value={yamlOutput} readOnly placeholder="Converted YAML appears here..." spellCheck={false} />
        </article>
      </section>
    </div>
  );
}
