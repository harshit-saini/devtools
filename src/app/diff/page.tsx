"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import type { IDisposable, editor as MonacoEditor } from "monaco-editor";
import {
  ArrowLeftRight,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Download,
  Eraser,
  FileDiff,
  FileUp,
  RotateCcw,
} from "lucide-react";
import styles from "./diff.module.css";
import ToolFullscreenButton from "@/components/ToolFullscreenButton";
import { useToolFullscreen } from "@/components/useToolFullscreen";

type DiffStats = {
  changedBlocks: number;
  addedLines: number;
  removedLines: number;
  changedLines: number;
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
  { id: "yaml", name: "YAML" },
  { id: "plaintext", name: "Plain text" },
];

const defaultOriginal = `function sum(a, b) {\n  return a + b;\n}\n\nconsole.log(sum(2, 3));`;
const defaultModified = `function sum(a, b, c = 0) {\n  return a + b + c;\n}\n\nconsole.log(sum(2, 3, 5));`;

const ORIGINAL_KEY = "devtools.diff.original";
const MODIFIED_KEY = "devtools.diff.modified";
const ORIGINAL_LANG_KEY = "devtools.diff.originalLanguage";
const MODIFIED_LANG_KEY = "devtools.diff.modifiedLanguage";
const SIDE_BY_SIDE_KEY = "devtools.diff.sideBySide";
const IGNORE_TRIM_KEY = "devtools.diff.ignoreTrim";
const WORD_WRAP_KEY = "devtools.diff.wordWrap";
const INDENT_GUIDES_KEY = "devtools.diff.indentGuides";

const SAVE_DEBOUNCE_MS = 400;
const NARROW_VIEWPORT_QUERY = "(max-width: 760px)";

function subscribeToViewport(callback: () => void) {
  const mediaQuery = window.matchMedia(NARROW_VIEWPORT_QUERY);
  mediaQuery.addEventListener("change", callback);
  return () => mediaQuery.removeEventListener("change", callback);
}

function getViewportSnapshot() {
  return window.matchMedia(NARROW_VIEWPORT_QUERY).matches;
}

function getViewportServerSnapshot() {
  return false;
}

function readLocalString(key: string, fallback: string): string {
  if (typeof window === "undefined") {
    return fallback;
  }

  const stored = window.localStorage.getItem(key);
  return stored ?? fallback;
}

function readLocalBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") {
    return fallback;
  }

  const stored = window.localStorage.getItem(key);
  if (stored === null) {
    return fallback;
  }

  return stored === "true";
}

function calculateStats(changes: readonly MonacoEditor.ILineChange[] | null): DiffStats {
  if (!changes || changes.length === 0) {
    return { changedBlocks: 0, addedLines: 0, removedLines: 0, changedLines: 0 };
  }

  let addedLines = 0;
  let removedLines = 0;
  let changedLines = 0;

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

    changedLines += Math.min(originalLines, modifiedLines);
    if (modifiedLines > originalLines) {
      addedLines += modifiedLines - originalLines;
    } else if (originalLines > modifiedLines) {
      removedLines += originalLines - modifiedLines;
    }
  }

  return { changedBlocks: changes.length, addedLines, removedLines, changedLines };
}

function copyToClipboard(value: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard
      .writeText(value)
      .then(() => true)
      .catch(() => copyWithFallback(value));
  }

  return Promise.resolve(copyWithFallback(value));
}

function copyWithFallback(value: string): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  let succeeded = false;
  try {
    succeeded = document.execCommand("copy");
  } catch {
    succeeded = false;
  }

  document.body.removeChild(textarea);
  return succeeded;
}

function buildUnifiedDiff(
  changes: readonly MonacoEditor.ILineChange[] | null,
  originalModel: MonacoEditor.ITextModel,
  modifiedModel: MonacoEditor.ITextModel,
): string {
  if (!changes || changes.length === 0) {
    return "";
  }

  const hunks: string[] = ["--- original", "+++ modified"];

  for (const change of changes) {
    const originalLines = Math.max(change.originalEndLineNumber - change.originalStartLineNumber + 1, 0);
    const modifiedLines = Math.max(change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1, 0);

    hunks.push(
      `@@ -${change.originalStartLineNumber},${originalLines} +${change.modifiedStartLineNumber},${modifiedLines} @@`,
    );

    if (change.originalEndLineNumber !== 0) {
      for (let line = change.originalStartLineNumber; line <= change.originalEndLineNumber; line += 1) {
        hunks.push(`-${originalModel.getLineContent(line)}`);
      }
    }

    if (change.modifiedEndLineNumber !== 0) {
      for (let line = change.modifiedStartLineNumber; line <= change.modifiedEndLineNumber; line += 1) {
        hunks.push(`+${modifiedModel.getLineContent(line)}`);
      }
    }
  }

  return hunks.join("\n");
}

export default function DiffTool() {
  const { containerRef, isFullscreen, fullscreenSupported, toggleFullscreen } =
    useToolFullscreen<HTMLDivElement>();

  // Initial state below intentionally matches what the server renders (hardcoded defaults, not
  // localStorage) so hydration never mismatches. Saved values are restored once, after mount,
  // in the effect further down — see the comment there.
  const [original, setOriginal] = useState(defaultOriginal);
  const [modified, setModified] = useState(defaultModified);
  const [originalLanguage, setOriginalLanguage] = useState("typescript");
  const [modifiedLanguage, setModifiedLanguage] = useState("typescript");
  const [renderSideBySide, setRenderSideBySide] = useState(true);
  const [ignoreTrimWhitespace, setIgnoreTrimWhitespace] = useState(false);
  const [wordWrap, setWordWrap] = useState(true);
  const [showIndentGuides, setShowIndentGuides] = useState(true);
  const isNarrowViewport = useSyncExternalStore(
    subscribeToViewport,
    getViewportSnapshot,
    getViewportServerSnapshot,
  );
  const [notice, setNotice] = useState<{ id: number; text: string }>({ id: 0, text: "" });
  const [stats, setStats] = useState<DiffStats>(() => ({
    changedBlocks: 0,
    addedLines: 0,
    removedLines: 0,
    changedLines: 0,
  }));

  const diffEditorRef = useRef<MonacoEditor.IStandaloneDiffEditor | null>(null);
  const disposablesRef = useRef<IDisposable[]>([]);
  const originalFileInputRef = useRef<HTMLInputElement>(null);
  const modifiedFileInputRef = useRef<HTMLInputElement>(null);
  const noticeCounterRef = useRef(0);

  const announce = (text: string) => {
    noticeCounterRef.current += 1;
    setNotice({ id: noticeCounterRef.current, text });
  };

  useEffect(() => {
    return () => {
      for (const disposable of disposablesRef.current) {
        disposable.dispose();
      }
    };
  }, []);

  useEffect(() => {
    if (!notice.text) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setNotice((current) => (current.id === notice.id ? { ...current, text: "" } : current));
    }, 1800);

    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  // Runs once after mount to restore anything saved from a previous visit. This must happen
  // after mount (not in the initial useState above) so the client's first render still matches
  // the server-rendered defaults - reading localStorage during the initial render would mismatch
  // hydration whenever a saved value differs from the hardcoded default.
  useEffect(() => {
    setOriginal(readLocalString(ORIGINAL_KEY, defaultOriginal));
    setModified(readLocalString(MODIFIED_KEY, defaultModified));
    setOriginalLanguage(readLocalString(ORIGINAL_LANG_KEY, "typescript"));
    setModifiedLanguage(readLocalString(MODIFIED_LANG_KEY, "typescript"));
    setRenderSideBySide(readLocalBoolean(SIDE_BY_SIDE_KEY, true));
    setIgnoreTrimWhitespace(readLocalBoolean(IGNORE_TRIM_KEY, false));
    setWordWrap(readLocalBoolean(WORD_WRAP_KEY, true));
    setShowIndentGuides(readLocalBoolean(INDENT_GUIDES_KEY, true));
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      window.localStorage.setItem(ORIGINAL_KEY, original);
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [original]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      window.localStorage.setItem(MODIFIED_KEY, modified);
    }, SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [modified]);

  useEffect(() => {
    window.localStorage.setItem(ORIGINAL_LANG_KEY, originalLanguage);
  }, [originalLanguage]);

  useEffect(() => {
    window.localStorage.setItem(MODIFIED_LANG_KEY, modifiedLanguage);
  }, [modifiedLanguage]);

  useEffect(() => {
    window.localStorage.setItem(SIDE_BY_SIDE_KEY, String(renderSideBySide));
  }, [renderSideBySide]);

  useEffect(() => {
    window.localStorage.setItem(IGNORE_TRIM_KEY, String(ignoreTrimWhitespace));
  }, [ignoreTrimWhitespace]);

  useEffect(() => {
    window.localStorage.setItem(WORD_WRAP_KEY, String(wordWrap));
  }, [wordWrap]);

  useEffect(() => {
    window.localStorage.setItem(INDENT_GUIDES_KEY, String(showIndentGuides));
  }, [showIndentGuides]);

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
    const swappedLanguage = originalLanguage;
    setOriginalLanguage(modifiedLanguage);
    setModifiedLanguage(swappedLanguage);
    announce("Swapped original and modified panes");
  };

  const clearBoth = () => {
    setOriginal("");
    setModified("");
    announce("Cleared both panes");
  };

  const resetToSample = () => {
    setOriginal(defaultOriginal);
    setModified(defaultModified);
    announce("Restored sample content");
  };

  const copyPane = async (value: string, label: string) => {
    if (!value) {
      announce(`No ${label.toLowerCase()} content to copy`);
      return;
    }

    const succeeded = await copyToClipboard(value);
    announce(succeeded ? `${label} copied` : "Clipboard copy failed");
  };

  const importFile = async (event: React.ChangeEvent<HTMLInputElement>, side: "original" | "modified") => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      if (side === "original") {
        setOriginal(text);
      } else {
        setModified(text);
      }
      announce(`Loaded ${file.name} into ${side}`);
    } catch {
      announce("Could not read that file");
    }
  };

  const downloadPatch = () => {
    const editorInstance = diffEditorRef.current;
    const model = editorInstance?.getModel();
    if (!editorInstance || !model) {
      return;
    }

    const patch = buildUnifiedDiff(editorInstance.getLineChanges(), model.original, model.modified);
    if (!patch) {
      announce("No differences to export");
      return;
    }

    const blob = new Blob([patch], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "diff.patch";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const goToDiff = (direction: "next" | "previous") => {
    diffEditorRef.current?.goToDiff(direction);
  };

  const isIdentical = original === modified;
  const effectiveSideBySide = renderSideBySide && !isNarrowViewport;

  const similarity = useMemo(() => {
    const modifiedLineCount = modified.length === 0 ? 0 : modified.split("\n").length;
    if (modifiedLineCount === 0) {
      return null;
    }

    const touchedLines = stats.addedLines + stats.changedLines;
    const unchangedLines = Math.max(modifiedLineCount - touchedLines, 0);
    return Math.round((unchangedLines / modifiedLineCount) * 100);
  }, [modified, stats]);

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

          <button
            className="btn btnSecondary"
            onClick={() => originalFileInputRef.current?.click()}
            aria-label="Load left file"
            title="Load left file"
          >
            <FileUp size={15} />
            <span className={styles.btnLabel}>Load left</span>
          </button>
          <button
            className="btn btnSecondary"
            onClick={() => modifiedFileInputRef.current?.click()}
            aria-label="Load right file"
            title="Load right file"
          >
            <FileUp size={15} />
            <span className={styles.btnLabel}>Load right</span>
          </button>
          <input
            ref={originalFileInputRef}
            type="file"
            className={styles.hiddenInput}
            onChange={(event) => importFile(event, "original")}
          />
          <input
            ref={modifiedFileInputRef}
            type="file"
            className={styles.hiddenInput}
            onChange={(event) => importFile(event, "modified")}
          />

          <button
            className="btn btnSecondary"
            onClick={() => copyPane(original, "Original")}
            aria-label="Copy left pane"
            title="Copy left pane"
          >
            <Clipboard size={15} />
            <span className={styles.btnLabel}>Copy left</span>
          </button>
          <button
            className="btn btnSecondary"
            onClick={() => copyPane(modified, "Modified")}
            aria-label="Copy right pane"
            title="Copy right pane"
          >
            <Clipboard size={15} />
            <span className={styles.btnLabel}>Copy right</span>
          </button>
          <button className="btn btnSecondary" onClick={swapSides} aria-label="Swap panes" title="Swap panes">
            <ArrowLeftRight size={15} />
            <span className={styles.btnLabel}>Swap</span>
          </button>
          <button
            className="btn btnSecondary"
            onClick={downloadPatch}
            aria-label="Export patch"
            title="Export patch"
          >
            <Download size={15} />
            <span className={styles.btnLabel}>Export patch</span>
          </button>
          <button className="btn btnGhost" onClick={resetToSample} aria-label="Reset sample" title="Reset sample">
            <RotateCcw size={15} />
            <span className={styles.btnLabel}>Reset sample</span>
          </button>
          <button className="btn btnDanger" onClick={clearBoth} aria-label="Clear both panes" title="Clear both panes">
            <Eraser size={15} />
            <span className={styles.btnLabel}>Clear</span>
          </button>
        </div>
      </header>

      <div className="toolMetaRow">
        <div className={styles.langGroup}>
          <label className={styles.langLabel} htmlFor="diff-original-language">
            Left
            <select
              id="diff-original-language"
              value={originalLanguage}
              className={styles.languageSelect}
              onChange={(event) => setOriginalLanguage(event.target.value)}
            >
              {languageOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.langLabel} htmlFor="diff-modified-language">
            Right
            <select
              id="diff-modified-language"
              value={modifiedLanguage}
              className={styles.languageSelect}
              onChange={(event) => setModifiedLanguage(event.target.value)}
            >
              {languageOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {isIdentical ? (
          <span className={`statusChip ${styles.identicalChip}`}>Panes are identical</span>
        ) : (
          <>
            <span className="statusChip">Blocks changed: {stats.changedBlocks}</span>
            <span className="statusChip">Added: {stats.addedLines}</span>
            <span className="statusChip">Removed: {stats.removedLines}</span>
            <span className="statusChip">Changed: {stats.changedLines}</span>
            {similarity !== null && <span className="statusChip">{similarity}% similar</span>}
          </>
        )}

        <div className={styles.navGroup}>
          <button
            className="btn btnGhost"
            onClick={() => goToDiff("previous")}
            disabled={stats.changedBlocks === 0}
            aria-label="Go to previous change"
            title="Previous change (Shift+F7)"
          >
            <ChevronUp size={15} />
          </button>
          <button
            className="btn btnGhost"
            onClick={() => goToDiff("next")}
            disabled={stats.changedBlocks === 0}
            aria-label="Go to next change"
            title="Next change (F7)"
          >
            <ChevronDown size={15} />
          </button>
        </div>

        <label className={styles.toggleWrap}>
          <input
            type="checkbox"
            checked={renderSideBySide}
            disabled={isNarrowViewport}
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

        <label className={styles.toggleWrap}>
          <input
            type="checkbox"
            checked={wordWrap}
            onChange={(event) => setWordWrap(event.target.checked)}
          />
          Wrap long lines
        </label>

        <label className={styles.toggleWrap}>
          <input
            type="checkbox"
            checked={showIndentGuides}
            onChange={(event) => setShowIndentGuides(event.target.checked)}
          />
          Indent guides
        </label>

        <span className={styles.notice} aria-hidden={!notice.text}>
          {notice.text}
        </span>
        <span role="status" aria-live="polite" className={styles.srOnly}>
          {notice.text}
        </span>
      </div>

      {isNarrowViewport && renderSideBySide && (
        <p className="helperText">Side-by-side view is switched to inline on small screens.</p>
      )}

      <section className={`${styles.editorCard} panel`}>
        <DiffEditor
          height="100%"
          theme="vs-dark"
          originalLanguage={originalLanguage}
          modifiedLanguage={modifiedLanguage}
          original={original}
          modified={modified}
          onMount={handleDiffMount}
          options={{
            renderSideBySide: effectiveSideBySide,
            originalEditable: true,
            ignoreTrimWhitespace,
            minimap: { enabled: false },
            wordWrap: wordWrap ? "on" : "off",
            diffWordWrap: wordWrap ? "on" : "off",
            wrappingIndent: wordWrap ? "same" : "none",
            guides: { indentation: showIndentGuides },
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
