"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Clipboard, Eraser, FileJson } from "lucide-react";
import ToolFullscreenButton from "@/components/ToolFullscreenButton";
import { useToolFullscreen } from "@/components/useToolFullscreen";
import { toYaml } from "@/lib/yaml";
import { useDebouncedLocalStorageState } from "@/lib/useLocalStorageState";
import styles from "./tool.module.css";

const SAMPLE_JSON = '{\n  "name": "theme",\n  "colors": ["#111827", "#60a5fa"]\n}';
const INPUT_KEY = "devtools.jsonYaml.input";

export default function Page() {
  const { containerRef, isFullscreen, fullscreenSupported, toggleFullscreen } = useToolFullscreen<HTMLDivElement>();
  // Initial state intentionally matches what the server renders (the hardcoded sample, not
  // localStorage) so hydration never mismatches. useDebouncedLocalStorageState restores the
  // saved value once after mount (via its own render-phase resync rather than an effect) and
  // debounces writes back to localStorage.
  const [jsonInput, setJsonInput] = useDebouncedLocalStorageState(INPUT_KEY, SAMPLE_JSON, (raw) => raw, 400);
  const [yamlOutput, setYamlOutput] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

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
