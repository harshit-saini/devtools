"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Clipboard, Download, Eye, FileText, FileUp, Split, SquarePen, Trash2 } from "lucide-react";
import styles from "./markdown.module.css";
import ToolFullscreenButton from "@/components/ToolFullscreenButton";
import { useToolFullscreen } from "@/components/useToolFullscreen";

const CONTENT_KEY = "devtools.markdown.content";
const SAVED_AT_KEY = "devtools.markdown.savedAt";

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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function applyInlineMarkdown(text: string): string {
  const escaped = escapeHtml(text);

  return escaped
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/_([^_]+)_/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];

  let inCodeBlock = false;
  let codeLang = "";
  let inUl = false;
  let inOl = false;
  let inBlockquote = false;

  const closeLists = () => {
    if (inUl) {
      html.push("</ul>");
      inUl = false;
    }

    if (inOl) {
      html.push("</ol>");
      inOl = false;
    }
  };

  const closeBlockquote = () => {
    if (inBlockquote) {
      html.push("</blockquote>");
      inBlockquote = false;
    }
  };

  for (const line of lines) {
    if (line.startsWith("```")) {
      closeLists();
      closeBlockquote();

      if (!inCodeBlock) {
        codeLang = line.slice(3).trim();
        html.push(`<pre><code${codeLang ? ` class=\"language-${escapeHtml(codeLang)}\"` : ""}>`);
        inCodeBlock = true;
      } else {
        html.push("</code></pre>");
        inCodeBlock = false;
        codeLang = "";
      }
      continue;
    }

    if (inCodeBlock) {
      html.push(`${escapeHtml(line)}\n`);
      continue;
    }

    if (/^\s*$/.test(line)) {
      closeLists();
      closeBlockquote();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeLists();
      closeBlockquote();
      const level = heading[1].length;
      html.push(`<h${level}>${applyInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      closeLists();
      closeBlockquote();
      html.push("<hr />");
      continue;
    }

    const blockquote = line.match(/^>\s?(.*)$/);
    if (blockquote) {
      closeLists();
      if (!inBlockquote) {
        html.push("<blockquote>");
        inBlockquote = true;
      }
      html.push(`<p>${applyInlineMarkdown(blockquote[1])}</p>`);
      continue;
    }

    closeBlockquote();

    const unorderedItem = line.match(/^[-*+]\s+(.*)$/);
    if (unorderedItem) {
      if (!inUl) {
        closeLists();
        html.push("<ul>");
        inUl = true;
      }
      html.push(`<li>${applyInlineMarkdown(unorderedItem[1])}</li>`);
      continue;
    }

    const orderedItem = line.match(/^\d+\.\s+(.*)$/);
    if (orderedItem) {
      if (!inOl) {
        closeLists();
        html.push("<ol>");
        inOl = true;
      }
      html.push(`<li>${applyInlineMarkdown(orderedItem[1])}</li>`);
      continue;
    }

    closeLists();
    html.push(`<p>${applyInlineMarkdown(line)}</p>`);
  }

  closeLists();
  closeBlockquote();

  if (inCodeBlock) {
    html.push("</code></pre>");
  }

  return html.join("\n");
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

  const [content, setContent] = useState<string>(() => readLocalString(CONTENT_KEY, "# Markdown Tool\n\nStart writing..."));
  const [previewMode, setPreviewMode] = useState<PreviewMode>("split");
  const [notice, setNotice] = useState("");
  const [isPendingSave, setIsPendingSave] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(() => readLocalNumber(SAVED_AT_KEY));
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
    }, 400);

    return () => window.clearTimeout(timeoutId);
  }, [content, isPendingSave]);

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
          >
            <SquarePen size={15} />
            Write
          </button>
          <button
            className={`btn btnSecondary ${previewMode === "split" ? styles.modeActive : ""}`}
            onClick={() => setPreviewMode("split")}
          >
            <Split size={15} />
            Split
          </button>
          <button
            className={`btn btnSecondary ${previewMode === "preview" ? styles.modeActive : ""}`}
            onClick={() => setPreviewMode("preview")}
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
