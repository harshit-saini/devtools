"use client";

import { useEffect, useState } from "react";
import { Braces, Clipboard, Minimize2, Sparkles, WandSparkles } from "lucide-react";
import styles from "./json.module.css";
import ToolFullscreenButton from "@/components/ToolFullscreenButton";
import { useToolFullscreen } from "@/components/useToolFullscreen";

const sampleJson = `{
  "service": "devtool-deck",
  "features": ["json", "jwt", "regex"],
  "settings": {
    "autosave": true,
    "theme": "light"
  }
}`;

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const sortedEntries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );

    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of sortedEntries) {
      result[key] = sortJsonValue(entryValue);
    }

    return result;
  }

  return value;
}

export default function JsonFormatterPage() {
  const { containerRef, isFullscreen, fullscreenSupported, toggleFullscreen } =
    useToolFullscreen<HTMLDivElement>();
  const [input, setInput] = useState(sampleJson);
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [indent, setIndent] = useState(2);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setNotice("");
    }, 1600);

    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const parseInput = (): unknown | null => {
    try {
      const parsed = JSON.parse(input);
      setError("");
      return parsed;
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : "Invalid JSON");
      return null;
    }
  };

  const runTransform = (label: string, transformer: (value: unknown) => string) => {
    const parsed = parseInput();
    if (!parsed) {
      return;
    }

    setOutput(transformer(parsed));
    setNotice(label);
  };

  const copyOutput = async () => {
    if (!output) {
      setNotice("No output to copy");
      return;
    }

    try {
      await navigator.clipboard.writeText(output);
      setNotice("Copied output");
    } catch {
      setNotice("Clipboard copy failed");
    }
  };

  return (
    <div
      ref={containerRef}
      className={`${styles.container} pageShell animate-enter ${isFullscreen ? "toolFullscreen" : ""}`}
    >
      <header className="toolHeader">
        <div>
          <div className="toolTitleRow">
            <span className="toolIconBadge">
              <Braces size={22} />
            </span>
            <div>
              <h2 className="toolTitle">JSON Formatter</h2>
              <p className="toolSubtitle">Validate, format, minify, and sort keys with clear parse feedback.</p>
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          <ToolFullscreenButton
            isFullscreen={isFullscreen}
            onToggle={toggleFullscreen}
            supported={fullscreenSupported}
          />
          <label className={styles.indentWrap}>
            Indent
            <select value={indent} onChange={(event) => setIndent(Number(event.target.value))}>
              <option value={2}>2 spaces</option>
              <option value={4}>4 spaces</option>
            </select>
          </label>

          <button
            className="btn btnSecondary"
            onClick={() => runTransform("JSON is valid", (value) => JSON.stringify(value, null, indent))}
          >
            <Sparkles size={15} />
            Validate + Format
          </button>
          <button
            className="btn btnSecondary"
            onClick={() => runTransform("Output minified", (value) => JSON.stringify(value))}
          >
            <Minimize2 size={15} />
            Minify
          </button>
          <button
            className="btn btnSecondary"
            onClick={() =>
              runTransform("Keys sorted", (value) => JSON.stringify(sortJsonValue(value), null, indent))
            }
          >
            <WandSparkles size={15} />
            Sort keys
          </button>
          <button className="btn btnSecondary" onClick={copyOutput}>
            <Clipboard size={15} />
            Copy output
          </button>
        </div>
      </header>

      <div className="toolMetaRow">
        {notice && <span className={styles.notice}>{notice}</span>}
        {error && <span className={styles.error}>{error}</span>}
      </div>

      <div className={styles.grid}>
        <section className={`${styles.block} panel`}>
          <div className={styles.blockHeader}>
            <h3>Input</h3>
            <button className="btn btnGhost" onClick={() => setInput(sampleJson)}>
              Load sample
            </button>
          </div>
          <textarea
            className={styles.textarea}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            spellCheck={false}
            placeholder="Paste JSON here"
          />
        </section>

        <section className={`${styles.block} panel`}>
          <div className={styles.blockHeader}>
            <h3>Output</h3>
            <button
              className="btn btnGhost"
              onClick={() => {
                if (output) {
                  setInput(output);
                  setNotice("Output loaded into input");
                }
              }}
              disabled={!output}
            >
              Use as input
            </button>
          </div>
          <textarea
            className={styles.textarea}
            value={output}
            readOnly
            spellCheck={false}
            placeholder="Run an action to generate output"
          />
        </section>
      </div>
    </div>
  );
}
