"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { Clipboard, Code2, Download, Sparkles, RotateCcw } from "lucide-react";
import styles from "./editor.module.css";
import ToolFullscreenButton from "@/components/ToolFullscreenButton";
import { useToolFullscreen } from "@/components/useToolFullscreen";
import { ensureMonacoConfigured } from "@/lib/monacoSetup";

const DRAFTS_KEY = "devtools.editor.drafts";
const LANGUAGE_KEY = "devtools.editor.language";
const SAVED_AT_KEY = "devtools.editor.savedAt";

type LanguageOption = {
  id: string;
  name: string;
};

const languageOptions = [
  { id: "typescript", name: "TypeScript" },
  { id: "javascript", name: "JavaScript" },
  { id: "python", name: "Python" },
  { id: "json", name: "JSON" },
  { id: "html", name: "HTML" },
  { id: "css", name: "CSS" },
  { id: "markdown", name: "Markdown" },
] as const satisfies readonly LanguageOption[];

type LanguageId = (typeof languageOptions)[number]["id"];

const languageExtensions: Record<LanguageId, string> = {
  typescript: "ts",
  javascript: "js",
  python: "py",
  json: "json",
  html: "html",
  css: "css",
  markdown: "md",
};

const defaultSnippets: Record<LanguageId, string> = {
  typescript:
    "type User = {\\n  id: string;\\n  name: string;\\n};\\n\\nexport function formatUser(user: User) {\\n  return `\\${user.name} (\\${user.id})`;\\n}",
  javascript: "function greet(name) {\\n  return `Hello, \\${name}!`;\\n}\\n\\nconsole.log(greet(\"Dev\"));",
  python: `def fibonacci(limit: int) -> list[int]:\n    sequence = [0, 1]\n    while sequence[-1] + sequence[-2] <= limit:\n        sequence.append(sequence[-1] + sequence[-2])\n    return sequence\n\nprint(fibonacci(34))`,
  json: `{"name":"DevTool Deck","features":["editor","diff","csv"]}`,
  html: `<!doctype html>\n<html>\n  <head>\n    <title>Starter</title>\n  </head>\n  <body>\n    <h1>Hello</h1>\n  </body>\n</html>`,
  css: `.card {\n  border-radius: 12px;\n  padding: 12px;\n  background: #ffffff;\n}`,
  markdown: `# Notes\n\n- Keep snippets handy\n- Export when done`,
};

function readLocalNumber(key: string): number | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function readLanguage(): LanguageId {
  if (typeof window === "undefined") {
    return "typescript";
  }

  const saved = window.localStorage.getItem(LANGUAGE_KEY);

  if (!saved) {
    return "typescript";
  }

  const isValid = languageOptions.some((option) => option.id === saved);
  return isValid ? (saved as LanguageId) : "typescript";
}

function readDrafts(): Record<LanguageId, string> {
  if (typeof window === "undefined") {
    return { ...defaultSnippets };
  }

  const raw = window.localStorage.getItem(DRAFTS_KEY);
  if (!raw) {
    return { ...defaultSnippets };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Record<LanguageId, string>>;

    return languageOptions.reduce<Record<LanguageId, string>>((acc, option) => {
      const value = parsed[option.id];
      acc[option.id] = typeof value === "string" ? value : defaultSnippets[option.id];
      return acc;
    }, {} as Record<LanguageId, string>);
  } catch {
    return { ...defaultSnippets };
  }
}

function formatSavedAt(value: number | null): string {
  if (!value) {
    return "Draft ready";
  }

  return `Saved at ${new Date(value).toLocaleTimeString()}`;
}

export default function CodeEditor() {
  const { containerRef, isFullscreen, fullscreenSupported, toggleFullscreen } =
    useToolFullscreen<HTMLDivElement>();
  const [language, setLanguage] = useState<LanguageId>(readLanguage);
  const [drafts, setDrafts] = useState<Record<LanguageId, string>>(readDrafts);
  const [fontSize, setFontSize] = useState(14);
  const [isPendingSave, setIsPendingSave] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(() => readLocalNumber(SAVED_AT_KEY));
  const [notice, setNotice] = useState("");
  const [monacoReady, setMonacoReady] = useState(false);

  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const editorContainerRef = useRef<HTMLDivElement | null>(null);
  const lastMeasuredSizeRef = useRef<{ width: number; height: number } | null>(null);

  // <Editor> must not mount until this resolves - see the comment in monacoSetup.ts for why.
  useEffect(() => {
    let cancelled = false;
    ensureMonacoConfigured().then(() => {
      if (!cancelled) {
        setMonacoReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Monaco's automaticLayout misreads its container's height when the editor mounts
  // asynchronously like this - see the matching comment in the diff tool for the full
  // explanation. Drive layout from a ResizeObserver instead of trusting Monaco's own measurement.
  //
  // The observer's first (correctly-sized) notification fires almost immediately on observe() -
  // before <Editor>'s own async init chain has called onMount, so editorRef.current is still
  // null right when it matters most. Cache the last measured size so handleEditorMount can apply
  // it itself once the editor instance actually exists.
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) {
      return;
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      const size = { width: entry.contentRect.width, height: entry.contentRect.height };
      lastMeasuredSizeRef.current = size;
      editorRef.current?.layout(size);
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [monacoReady]);

  const code = drafts[language] ?? "";

  const stats = useMemo(() => {
    const lineCount = code.length === 0 ? 0 : code.split(/\r?\n/).length;
    return {
      lines: lineCount,
      characters: code.length,
    };
  }, [code]);

  useEffect(() => {
    if (!isPendingSave) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      window.localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
      window.localStorage.setItem(LANGUAGE_KEY, language);
      const now = Date.now();
      window.localStorage.setItem(SAVED_AT_KEY, String(now));
      setLastSavedAt(now);
      setIsPendingSave(false);
    }, 550);

    return () => window.clearTimeout(timeoutId);
  }, [drafts, language, isPendingSave]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setNotice("");
    }, 1700);

    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const handleCodeChange = (nextCode: string) => {
    setDrafts((previous) => ({
      ...previous,
      [language]: nextCode,
    }));
    setIsPendingSave(true);
  };

  const handleLanguageChange = (nextLanguage: LanguageId) => {
    setLanguage(nextLanguage);
    window.localStorage.setItem(LANGUAGE_KEY, nextLanguage);
  };

  const handleCopy = async () => {
    if (!code) {
      setNotice("Nothing to copy");
      return;
    }

    try {
      await navigator.clipboard.writeText(code);
      setNotice("Copied to clipboard");
    } catch {
      setNotice("Clipboard copy failed");
    }
  };

  const handleDownload = () => {
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `snippet.${languageExtensions[language]}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    if (!window.confirm(`Reset the ${languageOptions.find((item) => item.id === language)?.name} draft?`)) {
      return;
    }

    handleCodeChange(defaultSnippets[language]);
    setNotice("Template restored");
  };

  const handleEditorMount: OnMount = (editorInstance) => {
    editorRef.current = editorInstance;

    // See the comment on the ResizeObserver effect above: apply whatever it last measured right
    // now, so the editor doesn't render at whatever tiny size Monaco guessed on its own.
    if (lastMeasuredSizeRef.current) {
      editorInstance.layout(lastMeasuredSizeRef.current);
    }
  };

  const handleFormatJson = () => {
    if (language !== "json") {
      setNotice("Switch language to JSON first");
      return;
    }

    try {
      const parsed = JSON.parse(code);
      handleCodeChange(JSON.stringify(parsed, null, 2));
      setNotice("JSON formatted");
    } catch {
      setNotice("Invalid JSON");
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
              <Code2 size={22} />
            </span>
            <div>
              <h2 className="toolTitle">Code Editor</h2>
              <p className="toolSubtitle">Per-language drafts, templates, and instant export from Monaco.</p>
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          <ToolFullscreenButton
            isFullscreen={isFullscreen}
            onToggle={toggleFullscreen}
            supported={fullscreenSupported}
          />
          <select
            value={language}
            className={styles.languageSelect}
            onChange={(event) => handleLanguageChange(event.target.value as LanguageId)}
            aria-label="Select language"
          >
            {languageOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>

          <button className="btn btnSecondary" onClick={handleCopy}>
            <Clipboard size={15} />
            Copy
          </button>
          <button className="btn btnSecondary" onClick={handleDownload}>
            <Download size={15} />
            Download
          </button>
          <button className="btn btnSecondary" onClick={handleFormatJson}>
            <Sparkles size={15} />
            Format JSON
          </button>
          <button className="btn btnDanger" onClick={handleReset}>
            <RotateCcw size={15} />
            Reset
          </button>
        </div>
      </header>

      <div className="toolMetaRow">
        <span className="statusChip">{isPendingSave ? "Saving draft..." : formatSavedAt(lastSavedAt)}</span>
        <span className="statusChip">Lines: {stats.lines}</span>
        <span className="statusChip">Characters: {stats.characters}</span>
        <label className={styles.fontSizeWrap}>
          Font size
          <input
            className={styles.fontSizeInput}
            type="range"
            min={12}
            max={20}
            value={fontSize}
            onChange={(event) => setFontSize(Number(event.target.value))}
          />
          <span>{fontSize}px</span>
        </label>
        {notice && <span className={styles.notice}>{notice}</span>}
      </div>

      <section className={`${styles.editorCard} panel`} ref={editorContainerRef}>
        {monacoReady ? (
          <Editor
            height="100%"
            language={language}
            theme="vs-dark"
            value={code}
            onChange={(value) => handleCodeChange(value ?? "")}
            onMount={handleEditorMount}
            options={{
              minimap: { enabled: false },
              fontSize,
              fontFamily: "'IBM Plex Mono', Consolas, monospace",
              wordWrap: "on",
              // automaticLayout is intentionally off - a ResizeObserver on this section drives
              // layout manually instead, see the comment above that effect for why.
              automaticLayout: false,
              smoothScrolling: true,
              tabSize: 2,
              padding: { top: 14 },
            }}
            loading={<div className={styles.loading}>Loading editor...</div>}
          />
        ) : (
          <div className={styles.loading}>Loading editor...</div>
        )}
      </section>
    </div>
  );
}
