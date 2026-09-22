"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Clipboard, Download, Eye, FileText, FileUp, Split, SquarePen, Trash2 } from "lucide-react";
import styles from "./markdown.module.css";
import ToolFullscreenButton from "@/components/ToolFullscreenButton";
import { useToolFullscreen } from "@/components/useToolFullscreen";
import { markdownToHtml } from "@/lib/markdown";

const CONTENT_KEY = "devtools.markdown.content";
const SAVED_AT_KEY = "devtools.markdown.savedAt";
const DEFAULT_CONTENT = "# Markdown Tool\n\nStart writing...";

type PreviewMode = "write" | "preview" | "split";

function readLocalString(key: string, fallback = ""): string {
  if (typeof window === "undefined") {
    return fallback;
  }

  return window.localStorage.getItem(key) ?? fallback;
}

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

function formatSavedAt(value: number | null): string {
  if (!value) {
    return "Draft ready";
  }

  return `Saved at ${new Date(value).toLocaleTimeString()}`;
}

export default function MarkdownToolPage() {
  const { containerRef, isFullscreen, fullscreenSupported, toggleFullscreen } =
    useToolFullscreen<HTMLDivElement>();

  // Initial state below intentionally matches what the server renders (the hardcoded default, not
  // localStorage) so hydration never mismatches. Saved values are restored once, after mount, in
  // the effect further down.
  const [content, setContent] = useState<string>(DEFAULT_CONTENT);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("split");
  const [notice, setNotice] = useState("");
  const [isPendingSave, setIsPendingSave] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef(content);
  const isPendingSaveRef = useRef(isPendingSave);
  contentRef.current = content;
  isPendingSaveRef.current = isPendingSave;

  useEffect(() => {
    setContent(readLocalString(CONTENT_KEY, DEFAULT_CONTENT));
    setLastSavedAt(readLocalNumber(SAVED_AT_KEY));
  }, []);

  useEffect(() => {
    if (!isPendingSave) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      window.localStorage.setItem(CONTENT_KEY, content);
      const now = Date.now();
      window.localStorage.setItem(SAVED_AT_KEY, String(now));
      setLastSavedAt(now);
      setIsPendingSave(false);
    }, 400);

    return () => window.clearTimeout(timeoutId);
  }, [content, isPendingSave]);

  // Flushes a still-pending debounced save on unmount (e.g. navigating away mid-debounce), since
  // the effect above's cleanup only clears the pending timer rather than persisting first. Empty
  // deps so this cleanup fires only on unmount, not on every keystroke.
  useEffect(() => {
    return () => {
      if (isPendingSaveRef.current) {
        window.localStorage.setItem(CONTENT_KEY, contentRef.current);
        window.localStorage.setItem(SAVED_AT_KEY, String(Date.now()));
      }
    };
  }, []);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setNotice("");
    }, 1800);

    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const renderedHtml = useMemo(() => markdownToHtml(content), [content]);

  const stats = useMemo(() => {
    const trimmed = content.trim();
    return {
      words: trimmed ? trimmed.split(/\s+/).length : 0,
      lines: content.length ? content.split(/\r?\n/).length : 0,
      characters: content.length,
    };
  }, [content]);

  const handleChange = (value: string) => {
    setContent(value);
    setIsPendingSave(true);
  };

  const handleCopy = async () => {
    if (!content) {
      setNotice("Nothing to copy");
      return;
    }

    try {
      await navigator.clipboard.writeText(content);
      setNotice("Copied markdown");
    } catch {
      setNotice("Clipboard copy failed");
    }
  };

  const handleClear = () => {
    if (!window.confirm("Clear markdown content?")) {
      return;
    }

    handleChange("");
    setNotice("Markdown cleared");
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "document.md";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    if (content.trim() && !window.confirm("Importing will replace your current document. Continue?")) {
      event.target.value = "";
      return;
    }

    try {
      const text = await file.text();
      handleChange(text);
      setNotice(`Loaded ${file.name}`);
    } catch {
      setNotice("Could not load file");
    } finally {
      event.target.value = "";
    }
  };

  return (
    <div
      ref={containerRef}
      className={`${styles.container} pageShell animate-enter ${isFullscreen ? "toolFullscreen" : ""}`}
    >
      <header className="toolHeader">
        <div className="toolTitleRow">
          <span className="toolIconBadge">
            <FileText size={22} />
          </span>
          <div>
            <h2 className="toolTitle">Markdown Tool</h2>
            <p className="toolSubtitle">Write markdown, preview it instantly, or open existing .md files.</p>
          </div>
        </div>

        <div className={styles.actions}>
          <ToolFullscreenButton
            isFullscreen={isFullscreen}
            onToggle={toggleFullscreen}
            supported={fullscreenSupported}
          />
          <button
            className={`btn btnSecondary ${previewMode === "write" ? styles.modeActive : ""}`}
            onClick={() => setPreviewMode("write")}
            aria-pressed={previewMode === "write"}
          >
            <SquarePen size={15} />
            Write
          </button>
          <button
            className={`btn btnSecondary ${previewMode === "split" ? styles.modeActive : ""}`}
            onClick={() => setPreviewMode("split")}
            aria-pressed={previewMode === "split"}
          >
            <Split size={15} />
            Split
          </button>
          <button
            className={`btn btnSecondary ${previewMode === "preview" ? styles.modeActive : ""}`}
            onClick={() => setPreviewMode("preview")}
            aria-pressed={previewMode === "preview"}
          >
            <Eye size={15} />
            Preview
          </button>
          <button className="btn btnSecondary" onClick={handleCopy}>
            <Clipboard size={15} />
            Copy
          </button>
          <button className="btn btnSecondary" onClick={handleDownload}>
            <Download size={15} />
            Export
          </button>
          <button className="btn btnSecondary" onClick={() => fileInputRef.current?.click()}>
            <FileUp size={15} />
            Open .md
          </button>
          <button className="btn btnDanger" onClick={handleClear}>
            <Trash2 size={15} />
            Clear
          </button>
          <input ref={fileInputRef} type="file" accept=".md,.markdown,.txt" onChange={handleImport} className={styles.hiddenInput} />
        </div>
      </header>

      <div className="toolMetaRow">
        <span className="statusChip">{isPendingSave ? "Saving draft..." : formatSavedAt(lastSavedAt)}</span>
        <span className="statusChip">Words: {stats.words}</span>
        <span className="statusChip">Lines: {stats.lines}</span>
        <span className="statusChip">Characters: {stats.characters}</span>
        {notice && <span className={styles.notice}>{notice}</span>}
        <span role="status" aria-live="polite" className={styles.srOnly}>
          {notice}
        </span>
      </div>

      <section className={`${styles.workspace} panel`}>
        {previewMode !== "preview" && (
          <textarea
            className={styles.editor}
            value={content}
            onChange={(event) => handleChange(event.target.value)}
            placeholder="Write markdown here..."
            spellCheck={false}
          />
        )}

        {previewMode !== "write" && (
          <article className={styles.preview} dangerouslySetInnerHTML={{ __html: renderedHtml }} />
        )}
      </section>
    </div>
  );
}
