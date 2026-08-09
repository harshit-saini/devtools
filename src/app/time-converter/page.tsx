"use client";

import { useEffect, useMemo, useState } from "react";
import { Clipboard, Clock3, RotateCcw, Zap } from "lucide-react";
import styles from "./time-converter.module.css";
import ToolFullscreenButton from "@/components/ToolFullscreenButton";
import { useToolFullscreen } from "@/components/useToolFullscreen";

type EpochUnit = "auto" | "s" | "ms";

const DEFAULT_EPOCH = "1700000000";
const DEFAULT_ISO = "2023-11-14T22:13:20.000Z";
const EPOCH_KEY = "devtools.timeConverter.epoch";
const ISO_KEY = "devtools.timeConverter.iso";
const UNIT_KEY = "devtools.timeConverter.unit";

const RELATIVE_UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: "day", ms: 24 * 60 * 60 * 1000 },
  { unit: "hour", ms: 60 * 60 * 1000 },
  { unit: "minute", ms: 60 * 1000 },
  { unit: "second", ms: 1000 },
];

function readLocalString(key: string, fallback: string): string {
  if (typeof window === "undefined") {
    return fallback;
  }

  return window.localStorage.getItem(key) ?? fallback;
}

function detectUnit(raw: string): "s" | "ms" {
  const digitCount = raw.replace(/[^0-9]/g, "").length;
  return digitCount >= 13 ? "ms" : "s";
}

function parseEpochInput(raw: string, unit: EpochUnit): { ms: number; effectiveUnit: "s" | "ms" } | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return null;
  }

  const effectiveUnit = unit === "auto" ? detectUnit(trimmed) : unit;
  return { ms: effectiveUnit === "ms" ? value : value * 1000, effectiveUnit };
}

function formatRelative(targetMs: number, nowMs: number): string {
  const diff = targetMs - nowMs;
  const abs = Math.abs(diff);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  for (const { unit, ms } of RELATIVE_UNITS) {
    if (abs >= ms || unit === "second") {
      return formatter.format(Math.round(diff / ms), unit);
    }
  }

  return formatter.format(0, "second");
}

function buildOutputs(ms: number, nowMs: number): { label: string; value: string }[] {
  const date = new Date(ms);
  return [
    { label: "Unix (s)", value: String(Math.floor(ms / 1000)) },
    { label: "Unix (ms)", value: String(Math.round(ms)) },
    { label: "ISO (UTC)", value: date.toISOString() },
    { label: "UTC string", value: date.toUTCString() },
    { label: "Local", value: date.toLocaleString(undefined, { dateStyle: "full", timeStyle: "long" }) },
    { label: "Relative", value: formatRelative(ms, nowMs) },
  ];
}

function toDatetimeLocalValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export default function TimeConverterPage() {
  const { containerRef, isFullscreen, fullscreenSupported, toggleFullscreen } =
    useToolFullscreen<HTMLDivElement>();

  const [epochInput, setEpochInput] = useState(() => readLocalString(EPOCH_KEY, DEFAULT_EPOCH));
  const [epochUnit, setEpochUnit] = useState<EpochUnit>(() => {
    const stored = readLocalString(UNIT_KEY, "auto");
    return stored === "s" || stored === "ms" ? stored : "auto";
  });
  const [isoInput, setIsoInput] = useState(() => readLocalString(ISO_KEY, DEFAULT_ISO));
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const intervalId = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(EPOCH_KEY, epochInput);
  }, [epochInput]);

  useEffect(() => {
    window.localStorage.setItem(ISO_KEY, isoInput);
  }, [isoInput]);

  useEffect(() => {
    window.localStorage.setItem(UNIT_KEY, epochUnit);
  }, [epochUnit]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeoutId = window.setTimeout(() => setNotice(""), 1600);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const epochResult = useMemo(() => parseEpochInput(epochInput, epochUnit), [epochInput, epochUnit]);
  const epochOutputs = useMemo(
    () => (epochResult ? buildOutputs(epochResult.ms, nowMs) : null),
    [epochResult, nowMs],
  );

  const isoDate = useMemo(() => {
    const trimmed = isoInput.trim();
    if (!trimmed) {
      return null;
    }

    const date = new Date(trimmed);
    return Number.isNaN(date.getTime()) ? null : date;
  }, [isoInput]);
  const isoOutputs = useMemo(
    () => (isoDate ? buildOutputs(isoDate.getTime(), nowMs) : null),
    [isoDate, nowMs],
  );

  const copyValue = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied`);
    } catch {
      setNotice("Clipboard copy failed");
    }
  };

  const useNow = () => {
    const now = new Date();
    setEpochUnit("s");
    setEpochInput(String(Math.floor(now.getTime() / 1000)));
    setIsoInput(now.toISOString());
    setNotice("Filled with current time");
  };

  const resetToSample = () => {
    setEpochInput(DEFAULT_EPOCH);
    setEpochUnit("auto");
    setIsoInput(DEFAULT_ISO);
    setNotice("Reset to sample values");
  };

  const clearAll = () => {
    setEpochInput("");
    setIsoInput("");
    setNotice("Cleared");
  };

  return (
    <div
      ref={containerRef}
      className={`${styles.container} pageShell animate-enter ${isFullscreen ? "toolFullscreen" : ""}`}
    >
      <header className="toolHeader">
        <div className="toolTitleRow">
          <span className="toolIconBadge">
            <Clock3 size={22} />
          </span>
          <div>
            <h2 className="toolTitle">Time Converter</h2>
            <p className="toolSubtitle">Convert Unix timestamps and dates, with auto unit detection and relative time.</p>
          </div>
        </div>

        <div className={styles.actions}>
          <ToolFullscreenButton
            isFullscreen={isFullscreen}
            onToggle={toggleFullscreen}
            supported={fullscreenSupported}
          />
          <button className="btn btnSecondary" onClick={useNow}>
            <Zap size={15} />
            Use now
          </button>
          <button className="btn btnSecondary" onClick={resetToSample}>
            Load sample
          </button>
          <button className="btn btnDanger" onClick={clearAll}>
            <RotateCcw size={15} />
            Clear
          </button>
        </div>
      </header>

      <div className="toolMetaRow">
        <span className="statusChip">Now: {new Date(nowMs).toLocaleTimeString()}</span>
        <span className="statusChip">Now (Unix s): {Math.floor(nowMs / 1000)}</span>
        {notice && <span className={styles.notice}>{notice}</span>}
      </div>

      <div className={styles.grid}>
        <section className={`${styles.card} panel`}>
          <h3 className={styles.sectionTitle}>Unix timestamp → Date</h3>
          <div className={styles.inputRow}>
            <input
              className={styles.textInput}
              value={epochInput}
              onChange={(event) => setEpochInput(event.target.value)}
              aria-invalid={epochInput.trim() !== "" && !epochResult}
              placeholder="1700000000"
              spellCheck={false}
            />
            <select
              className={styles.unitSelect}
              value={epochUnit}
              onChange={(event) => setEpochUnit(event.target.value as EpochUnit)}
              aria-label="Epoch unit"
            >
              <option value="auto">Auto-detect</option>
              <option value="s">Seconds</option>
              <option value="ms">Milliseconds</option>
            </select>
          </div>
          {epochResult && epochUnit === "auto" && (
            <p className={styles.hint}>Detected as {epochResult.effectiveUnit === "ms" ? "milliseconds" : "seconds"}.</p>
          )}

          {epochOutputs ? (
            <div className={styles.outputList}>
              {epochOutputs.map((output) => (
                <div key={output.label} className={styles.outputRow}>
                  <span className={styles.outputLabel}>{output.label}</span>
                  <span className={styles.outputValue}>{output.value}</span>
                  <button
                    className={styles.iconButton}
                    onClick={() => copyValue(output.value, output.label)}
                    aria-label={`Copy ${output.label}`}
                  >
                    <Clipboard size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            epochInput.trim() !== "" && <span className={styles.error}>Not a valid timestamp.</span>
          )}
        </section>

        <section className={`${styles.card} panel`}>
          <h3 className={styles.sectionTitle}>Date → Unix timestamp</h3>
          <div className={styles.inputRow}>
            <input
              className={styles.textInput}
              value={isoInput}
              onChange={(event) => setIsoInput(event.target.value)}
              aria-invalid={isoInput.trim() !== "" && !isoDate}
              placeholder="2023-11-14T22:13:20.000Z"
              spellCheck={false}
            />
            <input
              type="datetime-local"
              step="1"
              className={styles.pickerInput}
              value={isoDate ? toDatetimeLocalValue(isoDate) : ""}
              onChange={(event) => {
                if (!event.target.value) {
                  return;
                }

                const picked = new Date(event.target.value);
                if (!Number.isNaN(picked.getTime())) {
                  setIsoInput(picked.toISOString());
                }
              }}
              aria-label="Pick a date and time"
            />
          </div>
          <p className={styles.hint}>Accepts ISO 8601 or most human-readable date formats.</p>

          {isoOutputs ? (
            <div className={styles.outputList}>
              {isoOutputs.map((output) => (
                <div key={output.label} className={styles.outputRow}>
                  <span className={styles.outputLabel}>{output.label}</span>
                  <span className={styles.outputValue}>{output.value}</span>
                  <button
                    className={styles.iconButton}
                    onClick={() => copyValue(output.value, output.label)}
                    aria-label={`Copy ${output.label}`}
                  >
                    <Clipboard size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            isoInput.trim() !== "" && <span className={styles.error}>Not a valid date.</span>
          )}
        </section>
      </div>
    </div>
  );
}
