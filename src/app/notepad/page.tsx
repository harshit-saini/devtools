"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Clipboard, Download, FileUp, NotebookPen, Trash2 } from "lucide-react";
import styles from "./notepad.module.css";
import ToolFullscreenButton from "@/components/ToolFullscreenButton";
import { useToolFullscreen } from "@/components/useToolFullscreen";

const CONTENT_KEY = "devtools.notepad.content";
const SAVED_AT_KEY = "devtools.notepad.savedAt";

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

export default function Notepad() {
  const { containerRef, isFullscreen, fullscreenSupported, toggleFullscreen } =
    useToolFullscreen<HTMLDivElement>();
  const [content, setContent] = useState<string>(() => readLocalString(CONTENT_KEY));
  const [isPendingSave, setIsPendingSave] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(() => readLocalNumber(SAVED_AT_KEY));
  const [notice, setNotice] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    }, 450);

    return () => window.clearTimeout(timeoutId);
  }, [content, isPendingSave]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setNotice("");
    }, 1700);

    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const stats = useMemo(() => {
    const normalized = content.trim();

    return {
      words: normalized.length === 0 ? 0 : normalized.split(/\s+/).length,
      lines: content.length === 0 ? 0 : content.split(/\r?\n/).length,
      characters: content.length,
    };
  }, [content]);

  const handleChange = (value: string) => {
    setContent(value);
    setIsPendingSave(true);
  };

  const handleClear = () => {
    if (!window.confirm("Clear the whole note?")) {
      return;
    }

    handleChange("");
    setNotice("Note cleared");
  };

  const handleCopy = async () => {
    if (!content) {
      setNotice("Nothing to copy");
      return;
    }

    try {
      await navigator.clipboard.writeText(content);
      setNotice("Copied to clipboard");
    } catch {
      setNotice("Clipboard copy failed");
    }
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "notes.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      handleChange(text);
      setNotice(`Imported ${file.name}`);
    } catch {
      setNotice("Could not import file");
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
        <div>
          <div className="toolTitleRow">
            <span className="toolIconBadge">
              <NotebookPen size={22} />
            </span>
            <div>
              <h2 className="toolTitle">Notepad</h2>
              <p className="toolSubtitle">Quick notes with local auto-save, import, and export.</p>
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          <ToolFullscreenButton
            isFullscreen={isFullscreen}
            onToggle={toggleFullscreen}
            supported={fullscreenSupported}
          />
          <button className="btn btnSecondary" onClick={handleCopy}>
            <Clipboard size={15} />
            Copy
          </button>
          <button className="btn btnSecondary" onClick={handleDownload}>
            <Download size={15} />
            Download
          </button>
          <button className="btn btnSecondary" onClick={() => fileInputRef.current?.click()}>
            <FileUp size={15} />
            Import
          </button>
          <button className="btn btnDanger" onClick={handleClear}>
            <Trash2 size={15} />
            Clear
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.log"
            onChange={handleImport}
            className={styles.hiddenInput}
          />
        </div>
      </header>

      <div className="toolMetaRow">
        <span className="statusChip">{isPendingSave ? "Saving draft..." : formatSavedAt(lastSavedAt)}</span>
        <span className="statusChip">Words: {stats.words}</span>
        <span className="statusChip">Lines: {stats.lines}</span>
        <span className="statusChip">Characters: {stats.characters}</span>
        {notice && <span className={styles.notice}>{notice}</span>}
      </div>

      <section className={`${styles.editorCard} panel`}>
        <textarea
          className={styles.textarea}
          value={content}
          onChange={(event) => handleChange(event.target.value)}
          placeholder="Write notes, snippets, todos, or links..."
          spellCheck={false}
        />
      </section>
    </div>
  );
}
