"use client";

import { useEffect, useRef, useState } from "react";
import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import type { IDisposable, editor as MonacoEditor } from "monaco-editor";
import { ArrowLeftRight, Clipboard, Eraser, FileDiff } from "lucide-react";
import styles from "./diff.module.css";
import ToolFullscreenButton from "@/components/ToolFullscreenButton";
import { useToolFullscreen } from "@/components/useToolFullscreen";

type DiffStats = {
  changedBlocks: number;
  addedLines: number;
  removedLines: number;
};

type LanguageOption = {
  id: string;
  name: string;
};

const languageOptions: LanguageOption[] = [
  { id: "typescript", name: "TypeScript" },
  { id: "javascript", name: "JavaScript" },
  { id: "json", name: "JSON" },
  { id: "python", name: "Python" },
  { id: "markdown", name: "Markdown" },
  { id: "css", name: "CSS" },
  { id: "html", name: "HTML" },
  { id: "plaintext", name: "Plain text" },
];

const defaultOriginal = `function sum(a, b) {\n  return a + b;\n}\n\nconsole.log(sum(2, 3));`;
const defaultModified = `function sum(a, b, c = 0) {\n  return a + b + c;\n}\n\nconsole.log(sum(2, 3, 5));`;

function calculateStats(changes: readonly MonacoEditor.ILineChange[] | null): DiffStats {
  if (!changes || changes.length === 0) {
    return {
      changedBlocks: 0,
      addedLines: 0,
      removedLines: 0,
    };
  }

  let addedLines = 0;
  let removedLines = 0;

  for (const change of changes) {
    const originalLines = Math.max(change.originalEndLineNumber - change.originalStartLineNumber + 1, 0);
    const modifiedLines = Math.max(change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1, 0);

    if (change.originalEndLineNumber === 0) {
      addedLines += modifiedLines;
      continue;
    }

    if (change.modifiedEndLineNumber === 0) {
      removedLines += originalLines;
      continue;
    }

    if (modifiedLines > originalLines) {
      addedLines += modifiedLines - originalLines;
    } else if (originalLines > modifiedLines) {
      removedLines += originalLines - modifiedLines;
    }
  }

  return {
    changedBlocks: changes.length,
    addedLines,
    removedLines,
  };
}

export default function DiffTool() {
  const { containerRef, isFullscreen, fullscreenSupported, toggleFullscreen } =
    useToolFullscreen<HTMLDivElement>();
  const [original, setOriginal] = useState(defaultOriginal);
  const [modified, setModified] = useState(defaultModified);
  const [language, setLanguage] = useState("typescript");
  const [renderSideBySide, setRenderSideBySide] = useState(true);
  const [ignoreTrimWhitespace, setIgnoreTrimWhitespace] = useState(false);
  const [notice, setNotice] = useState("");
  const [stats, setStats] = useState<DiffStats>(() => ({
    changedBlocks: 0,
    addedLines: 0,
    removedLines: 0,
  }));

  const diffEditorRef = useRef<MonacoEditor.IStandaloneDiffEditor | null>(null);
  const disposablesRef = useRef<IDisposable[]>([]);

  useEffect(() => {
    return () => {
      for (const disposable of disposablesRef.current) {
        disposable.dispose();
      }
    };
  }, []);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setNotice("");
    }, 1500);

    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const recalculateStats = (editorInstance?: MonacoEditor.IStandaloneDiffEditor | null) => {
    const activeEditor = editorInstance ?? diffEditorRef.current;
    if (!activeEditor) {
      return;
    }

    setStats(calculateStats(activeEditor.getLineChanges()));
  };

  const handleDiffMount: DiffOnMount = (editorInstance) => {
    diffEditorRef.current = editorInstance;

    for (const disposable of disposablesRef.current) {
      disposable.dispose();
    }

    const model = editorInstance.getModel();
    if (!model) {
      return;
    }

    const originalModel = model.original;
    const modifiedModel = model.modified;

    const nextDisposables: IDisposable[] = [
      originalModel.onDidChangeContent(() => {
        setOriginal(originalModel.getValue());
      }),
      modifiedModel.onDidChangeContent(() => {
        setModified(modifiedModel.getValue());
      }),
      editorInstance.onDidUpdateDiff(() => {
        recalculateStats(editorInstance);
      }),
    ];

    disposablesRef.current = nextDisposables;
    recalculateStats(editorInstance);
  };

  const swapSides = () => {
    setOriginal(modified);
    setModified(original);
    setNotice("Swapped original and modified panes");
  };

  const clearBoth = () => {
    setOriginal("");
    setModified("");
    setNotice("Cleared both panes");
  };

  const copyPane = async (value: string, label: string) => {
    if (!value) {
      setNotice(`No ${label.toLowerCase()} content to copy`);
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
    <div
      ref={containerRef}
      className={`${styles.container} pageShell animate-enter ${isFullscreen ? "toolFullscreen" : ""}`}
    >
      <header className="toolHeader">
        <div>
          <div className="toolTitleRow">
            <span className="toolIconBadge">
              <FileDiff size={22} />
            </span>
            <div>
              <h2 className="toolTitle">Diff Tool</h2>
              <p className="toolSubtitle">Compare versions quickly with Monaco diff and inline controls.</p>
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
            onChange={(event) => setLanguage(event.target.value)}
            aria-label="Select diff language"
          >
            {languageOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>

          <button className="btn btnSecondary" onClick={() => copyPane(original, "Original") }>
            <Clipboard size={15} />
            Copy left
          </button>
          <button className="btn btnSecondary" onClick={() => copyPane(modified, "Modified") }>
            <Clipboard size={15} />
            Copy right
          </button>
          <button className="btn btnSecondary" onClick={swapSides}>
            <ArrowLeftRight size={15} />
            Swap
          </button>
          <button className="btn btnDanger" onClick={clearBoth}>
            <Eraser size={15} />
            Clear
          </button>
        </div>
      </header>

      <div className="toolMetaRow">
        <span className="statusChip">Blocks changed: {stats.changedBlocks}</span>
        <span className="statusChip">Added lines: {stats.addedLines}</span>
        <span className="statusChip">Removed lines: {stats.removedLines}</span>

        <label className={styles.toggleWrap}>
          <input
            type="checkbox"
            checked={renderSideBySide}
            onChange={(event) => setRenderSideBySide(event.target.checked)}
          />
          Side by side
        </label>

        <label className={styles.toggleWrap}>
          <input
            type="checkbox"
            checked={ignoreTrimWhitespace}
            onChange={(event) => setIgnoreTrimWhitespace(event.target.checked)}
          />
          Ignore trim whitespace
        </label>

        {notice && <span className={styles.notice}>{notice}</span>}
      </div>

      <section className={`${styles.editorCard} panel`}>
        <DiffEditor
          height="100%"
          theme="vs-dark"
          language={language}
          original={original}
          modified={modified}
          onMount={handleDiffMount}
          options={{
            renderSideBySide,
            originalEditable: true,
            ignoreTrimWhitespace,
            minimap: { enabled: false },
            wordWrap: "on",
            automaticLayout: true,
            fontSize: 13,
            fontFamily: "'IBM Plex Mono', Consolas, monospace",
            padding: { top: 14 },
          }}
          loading={<div className={styles.loading}>Loading diff editor...</div>}
        />
      </section>
    </div>
  );
}
