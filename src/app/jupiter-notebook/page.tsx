"use client";

import { useMemo, useRef, useState } from "react";
import { Notebook, Play, Plus, Trash2 } from "lucide-react";
import styles from "./jupiter-notebook.module.css";
import ToolFullscreenButton from "@/components/ToolFullscreenButton";
import { useToolFullscreen } from "@/components/useToolFullscreen";

type Cell = { id: number; code: string; output: string; error: string };
const DEFAULT_CODE = `const values = [3, 7, 11];\nvalues.map((n) => n * 2);`;

function runCell(code: string): { output: string; error: string } {
  const logs: string[] = [];
  const consoleProxy = {
    ...console,
    log: (...args: unknown[]) => logs.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ")),
  };

  try {
    const result = new Function("console", `"use strict"; ${code}`)(consoleProxy);
    const resultText = typeof result === "undefined" ? "undefined" : JSON.stringify(result, null, 2);
    return { output: [...logs, `Result: ${resultText}`].join("\n"), error: "" };
  } catch (error) {
    return { output: logs.join("\n"), error: error instanceof Error ? error.message : "Unknown runtime error" };
  }
}

export default function JupiterNotebook() {
  const { containerRef, isFullscreen, fullscreenSupported, toggleFullscreen } = useToolFullscreen<HTMLDivElement>();
  const nextIdRef = useRef(2);
  const [cells, setCells] = useState<Cell[]>([{ id: 1, code: DEFAULT_CODE, output: "", error: "" }]);

  const stats = useMemo(() => {
    const totalLines = cells.reduce((acc, cell) => acc + cell.code.split(/\r?\n/).length, 0);
    return { count: cells.length, totalLines };
  }, [cells]);

  const updateCell = (id: number, code: string) =>
    setCells((current) => current.map((cell) => (cell.id === id ? { ...cell, code } : cell)));

  const executeCell = (id: number) =>
    setCells((current) =>
      current.map((cell) => {
        if (cell.id !== id) return cell;
        const { output, error } = runCell(cell.code);
        return { ...cell, output, error };
      }),
    );

  const addCell = () =>
    setCells((current) => [...current, { id: nextIdRef.current++, code: "", output: "", error: "" }]);
  const removeCell = (id: number) => setCells((current) => (current.length === 1 ? current : current.filter((cell) => cell.id !== id)));

  return (
    <div ref={containerRef} className={`${styles.container} pageShell animate-enter ${isFullscreen ? "toolFullscreen" : ""}`}>
      <header className="toolHeader">
        <div className="toolTitleRow">
          <span className="toolIconBadge"><Notebook size={22} /></span>
          <div>
            <h2 className="toolTitle">Jupiter Notebook</h2>
            <p className="toolSubtitle">Local notebook-style JavaScript cells. Runs fully in-browser with no server.</p>
          </div>
        </div>
        <div className={styles.actions}>
          <ToolFullscreenButton isFullscreen={isFullscreen} onToggle={toggleFullscreen} supported={fullscreenSupported} />
          <button className="btn btnSecondary" onClick={addCell}><Plus size={15} />Add cell</button>
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
                <button className="btn btnSecondary" onClick={() => executeCell(cell.id)}><Play size={15} />Run</button>
                <button className="btn btnDanger" onClick={() => removeCell(cell.id)}><Trash2 size={15} />Remove</button>
              </div>
            </div>

            <textarea className={styles.codeInput} value={cell.code} onChange={(event) => updateCell(cell.id, event.target.value)} placeholder="Write JavaScript here..." spellCheck={false} />

            {(cell.output || cell.error) && <pre className={`${styles.output} ${cell.error ? styles.error : ""}`}>{cell.error ? `Error: ${cell.error}` : cell.output}</pre>}
          </article>
        ))}
      </section>
    </div>
  );
}
