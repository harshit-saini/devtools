"use client";

import { useMemo, useRef, useState } from "react";
import { Notebook, Play, Plus, RotateCcw, Square, Trash2 } from "lucide-react";
import styles from "./jupiter-notebook.module.css";
import ToolFullscreenButton from "@/components/ToolFullscreenButton";
import { useToolFullscreen } from "@/components/useToolFullscreen";

type Cell = { id: number; code: string; output: string; error: string; isRunning: boolean };
const DEFAULT_CODE = `const values = [3, 7, 11];\nvalues.map((n) => n * 2);`;
const EXECUTION_TIMEOUT_MS = 5000;

// Cells run inside a fresh Worker per execution instead of `new Function(...)`, for two reasons:
// 1. A Function body never auto-returns its last expression's value (you'd need an explicit
//    `return`), unlike eval'd code, which follows normal REPL completion-value semantics - the
//    same code typed into a browser console or Node REPL does show its last expression's value.
//    Indirect eval (via the comma-operator trick below) gets that same behavior without a
//    fragile source-rewriting heuristic.
// 2. Running on the main thread meant a stray infinite loop froze the whole tab with no way to
//    recover short of closing it. A Worker can be terminated from the outside (a hard timeout,
//    or the user clicking Stop), which is the only way to interrupt a synchronous infinite loop -
//    there's no cooperative preemption for that in JS.
const WORKER_SOURCE = `
self.onmessage = (event) => {
  const code = event.data.code;
  const logs = [];
  console.log = (...args) => {
    logs.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
  };

  try {
    const result = (0, eval)(code);
    const resultText = typeof result === "undefined" ? "undefined" : JSON.stringify(result, null, 2);
    self.postMessage({ ok: true, output: [...logs, "Result: " + resultText].join("\\n") });
  } catch (error) {
    self.postMessage({
      ok: false,
      output: logs.join("\\n"),
      error: error instanceof Error ? error.message : "Unknown runtime error",
    });
  }
};
`;

let cachedWorkerUrl: string | null = null;

function getWorkerUrl(): string {
  if (!cachedWorkerUrl) {
    const blob = new Blob([WORKER_SOURCE], { type: "application/javascript" });
    cachedWorkerUrl = URL.createObjectURL(blob);
  }

  return cachedWorkerUrl;
}

function runCellInWorker(code: string, onSettled: (result: { output: string; error: string }) => void): () => void {
  const worker = new Worker(getWorkerUrl());
  let settled = false;

  const finish = (result: { output: string; error: string }) => {
    if (settled) {
      return;
    }

    settled = true;
    window.clearTimeout(timeoutId);
    worker.terminate();
    onSettled(result);
  };

  const timeoutId = window.setTimeout(() => {
    finish({
      output: "",
      error: `Execution timed out after ${EXECUTION_TIMEOUT_MS / 1000}s (likely an infinite loop). Cell was stopped.`,
    });
  }, EXECUTION_TIMEOUT_MS);

  worker.onmessage = (event) => {
    const data = event.data as { ok: boolean; output: string; error?: string };
    finish({ output: data.output ?? "", error: data.ok ? "" : data.error ?? "Unknown runtime error" });
  };

  worker.onerror = (event) => {
    finish({ output: "", error: event.message || "Worker error" });
  };

  worker.postMessage({ code });

  return () => finish({ output: "", error: "Stopped by user." });
}

export default function JupiterNotebook() {
  const { containerRef, isFullscreen, fullscreenSupported, toggleFullscreen } = useToolFullscreen<HTMLDivElement>();
  const nextIdRef = useRef(2);
  const [cells, setCells] = useState<Cell[]>([{ id: 1, code: DEFAULT_CODE, output: "", error: "", isRunning: false }]);
  const stopHandlersRef = useRef(new Map<number, () => void>());

  const stats = useMemo(() => {
    const totalLines = cells.reduce((acc, cell) => acc + cell.code.split(/\r?\n/).length, 0);
    return { count: cells.length, totalLines };
  }, [cells]);

  const updateCell = (id: number, code: string) =>
    setCells((current) => current.map((cell) => (cell.id === id ? { ...cell, code } : cell)));

  const executeCell = (id: number) => {
    const cell = cells.find((item) => item.id === id);
    if (!cell || cell.isRunning) {
      return;
    }

    setCells((current) => current.map((item) => (item.id === id ? { ...item, isRunning: true } : item)));

    const stop = runCellInWorker(cell.code, ({ output, error }) => {
      stopHandlersRef.current.delete(id);
      setCells((current) =>
        current.map((item) => (item.id === id ? { ...item, output, error, isRunning: false } : item)),
      );
    });

    stopHandlersRef.current.set(id, stop);
  };

  const stopCell = (id: number) => {
    stopHandlersRef.current.get(id)?.();
  };

  const addCell = () =>
    setCells((current) => [...current, { id: nextIdRef.current++, code: "", output: "", error: "", isRunning: false }]);

  const removeCell = (id: number) => {
    if (cells.length === 1) {
      return;
    }

    stopHandlersRef.current.get(id)?.();
    setCells((current) => current.filter((cell) => cell.id !== id));
  };

  const resetNotebook = () => {
    if (!window.confirm("Reset the notebook to a single empty cell? This clears all cells.")) {
      return;
    }

    for (const stop of stopHandlersRef.current.values()) {
      stop();
    }

    stopHandlersRef.current.clear();
    nextIdRef.current = 2;
    setCells([{ id: 1, code: "", output: "", error: "", isRunning: false }]);
  };

  return (
    <div ref={containerRef} className={`${styles.container} pageShell animate-enter ${isFullscreen ? "toolFullscreen" : ""}`}>
      <header className="toolHeader">
        <div className="toolTitleRow">
          <span className="toolIconBadge"><Notebook size={22} /></span>
          <div>
            <h2 className="toolTitle">Jupiter Notebook</h2>
            <p className="toolSubtitle">
              Local notebook-style JavaScript cells. Runs fully in-browser with no server, each cell in its own
              Worker with a {EXECUTION_TIMEOUT_MS / 1000}s timeout.
            </p>
          </div>
        </div>
        <div className={styles.actions}>
          <ToolFullscreenButton isFullscreen={isFullscreen} onToggle={toggleFullscreen} supported={fullscreenSupported} />
          <button className="btn btnSecondary" onClick={addCell}><Plus size={15} />Add cell</button>
          <button className="btn btnDanger" onClick={resetNotebook}><RotateCcw size={15} />Reset</button>
        </div>
      </header>

      <div className="toolMetaRow">
        <span className="statusChip">Cells: {stats.count}</span>
        <span className="statusChip">Code lines: {stats.totalLines}</span>
        <span className="statusChip">No backend required</span>
      </div>

      <section className={styles.cellList}>
        {cells.map((cell, index) => (
          <article key={cell.id} className={`${styles.cellCard} panel`}>
            <div className={styles.cellHeader}>
              <span className="statusChip">Cell {index + 1}</span>
              <div className={styles.cellActions}>
                {cell.isRunning ? (
                  <button className="btn btnDanger" onClick={() => stopCell(cell.id)}>
                    <Square size={15} />
                    Stop
                  </button>
                ) : (
                  <button className="btn btnSecondary" onClick={() => executeCell(cell.id)}>
                    <Play size={15} />
                    Run
                  </button>
                )}
                <button
                  className="btn btnDanger"
                  onClick={() => removeCell(cell.id)}
                  disabled={cells.length === 1}
                  title={cells.length === 1 ? "At least one cell is required" : "Remove this cell"}
                >
                  <Trash2 size={15} />
                  Remove
                </button>
              </div>
            </div>

            <textarea
              className={styles.codeInput}
              value={cell.code}
              onChange={(event) => updateCell(cell.id, event.target.value)}
              placeholder="Write JavaScript here..."
              spellCheck={false}
              disabled={cell.isRunning}
            />

            {cell.isRunning && <p className={styles.runningNote}>Running...</p>}
            {(cell.output || cell.error) && (
              <pre className={`${styles.output} ${cell.error ? styles.error : ""}`}>
                {cell.error ? `Error: ${cell.error}` : cell.output}
              </pre>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
