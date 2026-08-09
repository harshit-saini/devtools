"use client";

import { useEffect, useMemo, useState } from "react";
import { Clipboard, Dices, Download, Fingerprint, RotateCcw } from "lucide-react";
import styles from "./uuid-generator.module.css";
import ToolFullscreenButton from "@/components/ToolFullscreenButton";
import { useToolFullscreen } from "@/components/useToolFullscreen";

type UuidVersion = "v4" | "v7";
type WrapStyle = "none" | "braces" | "quotes";

const MIN_COUNT = 1;
const MAX_COUNT = 1000;
const DEFAULT_COUNT = 5;

const VERSION_KEY = "devtools.uuidGenerator.version";
const COUNT_KEY = "devtools.uuidGenerator.count";
const UPPERCASE_KEY = "devtools.uuidGenerator.uppercase";
const HYPHENS_KEY = "devtools.uuidGenerator.hyphens";
const WRAP_KEY = "devtools.uuidGenerator.wrap";

function readLocalString(key: string, fallback: string): string {
  if (typeof window === "undefined") {
    return fallback;
  }

  return window.localStorage.getItem(key) ?? fallback;
}

function readLocalBoolean(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") {
    return fallback;
  }

  const stored = window.localStorage.getItem(key);
  return stored === null ? fallback : stored === "true";
}

function timestampByte(timestamp: number, byteShift: number): number {
  return Math.floor(timestamp / 2 ** byteShift) % 256;
}

function generateUuidV7(): string {
  const timestamp = Date.now();
  const random = crypto.getRandomValues(new Uint8Array(10));
  const bytes = new Uint8Array(16);

  bytes[0] = timestampByte(timestamp, 40);
  bytes[1] = timestampByte(timestamp, 32);
  bytes[2] = timestampByte(timestamp, 24);
  bytes[3] = timestampByte(timestamp, 16);
  bytes[4] = timestampByte(timestamp, 8);
  bytes[5] = timestampByte(timestamp, 0);

  bytes[6] = 0x70 | (random[0] & 0x0f);
  bytes[7] = random[1];
  bytes[8] = 0x80 | (random[2] & 0x3f);
  bytes[9] = random[3];
  bytes[10] = random[4];
  bytes[11] = random[5];
  bytes[12] = random[6];
  bytes[13] = random[7];
  bytes[14] = random[8];
  bytes[15] = random[9];

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function generateUuid(version: UuidVersion): string {
  return version === "v4" ? crypto.randomUUID() : generateUuidV7();
}

function clampCount(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_COUNT;
  }

  return Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(value)));
}

function formatUuid(raw: string, uppercase: boolean, hyphens: boolean, wrap: WrapStyle): string {
  let value = hyphens ? raw : raw.replace(/-/g, "");
  value = uppercase ? value.toUpperCase() : value;

  if (wrap === "braces") {
    return `{${value}}`;
  }

  if (wrap === "quotes") {
    return `"${value}"`;
  }

  return value;
}

export default function UuidGeneratorPage() {
  const { containerRef, isFullscreen, fullscreenSupported, toggleFullscreen } =
    useToolFullscreen<HTMLDivElement>();

  const [version, setVersion] = useState<UuidVersion>(() => {
    const stored = readLocalString(VERSION_KEY, "v4");
    return stored === "v7" ? "v7" : "v4";
  });
  const [count, setCount] = useState(() => clampCount(Number(readLocalString(COUNT_KEY, String(DEFAULT_COUNT)))));
  const [uppercase, setUppercase] = useState(() => readLocalBoolean(UPPERCASE_KEY, false));
  const [hyphens, setHyphens] = useState(() => readLocalBoolean(HYPHENS_KEY, true));
  const [wrap, setWrap] = useState<WrapStyle>(() => {
    const stored = readLocalString(WRAP_KEY, "none");
    return stored === "braces" || stored === "quotes" ? stored : "none";
  });
  const [rawItems, setRawItems] = useState<string[]>(() =>
    Array.from({ length: DEFAULT_COUNT }, () => generateUuid("v4")),
  );
  const [notice, setNotice] = useState("");

  useEffect(() => {
    window.localStorage.setItem(VERSION_KEY, version);
  }, [version]);

  useEffect(() => {
    window.localStorage.setItem(COUNT_KEY, String(count));
  }, [count]);

  useEffect(() => {
    window.localStorage.setItem(UPPERCASE_KEY, String(uppercase));
  }, [uppercase]);

  useEffect(() => {
    window.localStorage.setItem(HYPHENS_KEY, String(hyphens));
  }, [hyphens]);

  useEffect(() => {
    window.localStorage.setItem(WRAP_KEY, wrap);
  }, [wrap]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeoutId = window.setTimeout(() => setNotice(""), 1600);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const formattedItems = useMemo(
    () => rawItems.map((item) => formatUuid(item, uppercase, hyphens, wrap)),
    [rawItems, uppercase, hyphens, wrap],
  );

  const generate = () => {
    setRawItems(Array.from({ length: count }, () => generateUuid(version)));
    setNotice(`Generated ${count} ${version.toUpperCase()} UUID${count === 1 ? "" : "s"}`);
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

  const downloadTxt = () => {
    if (formattedItems.length === 0) {
      setNotice("Generate UUIDs first");
      return;
    }

    const blob = new Blob([formattedItems.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "uuids.txt";
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("uuids.txt downloaded");
  };

  const clearAll = () => {
    setRawItems([]);
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
            <Fingerprint size={22} />
          </span>
          <div>
            <h2 className="toolTitle">UUID Generator</h2>
            <p className="toolSubtitle">Generate v4 or v7 UUIDs in bulk, locally, with custom formatting.</p>
          </div>
        </div>

        <div className={styles.actions}>
          <ToolFullscreenButton
            isFullscreen={isFullscreen}
            onToggle={toggleFullscreen}
            supported={fullscreenSupported}
          />
          <button className="btn btnPrimary" onClick={generate}>
            <Dices size={15} />
            Generate
          </button>
          <button className="btn btnSecondary" onClick={() => copyValue(formattedItems.join("\n"), "All UUIDs")}>
            <Clipboard size={15} />
            Copy all
          </button>
          <button className="btn btnSecondary" onClick={downloadTxt}>
            <Download size={15} />
            Download .txt
          </button>
          <button className="btn btnDanger" onClick={clearAll}>
            <RotateCcw size={15} />
            Clear
          </button>
        </div>
      </header>

      <div className="toolMetaRow">
        <span className="statusChip">Version: {version.toUpperCase()}</span>
        <span className="statusChip">Generated: {formattedItems.length}</span>
        {notice && <span className={styles.notice}>{notice}</span>}
      </div>

      <section className={`${styles.optionsCard} panel`}>
        <label className={styles.optionGroup}>
          Count
          <input
            type="number"
            min={MIN_COUNT}
            max={MAX_COUNT}
            className={styles.countInput}
            value={count}
            onChange={(event) => setCount(clampCount(Number(event.target.value)))}
          />
        </label>

        <label className={styles.optionGroup}>
          Version
          <select
            className={styles.select}
            value={version}
            onChange={(event) => setVersion(event.target.value as UuidVersion)}
          >
            <option value="v4">v4 (random)</option>
            <option value="v7">v7 (time-ordered)</option>
          </select>
        </label>

        <label className={styles.optionGroup}>
          Wrap
          <select
            className={styles.select}
            value={wrap}
            onChange={(event) => setWrap(event.target.value as WrapStyle)}
          >
            <option value="none">None</option>
            <option value="braces">Braces {"{}"}</option>
            <option value="quotes">Quotes &quot;&quot;</option>
          </select>
        </label>

        <label className={styles.toggleWrap}>
          <input type="checkbox" checked={uppercase} onChange={(event) => setUppercase(event.target.checked)} />
          Uppercase
        </label>

        <label className={styles.toggleWrap}>
          <input type="checkbox" checked={hyphens} onChange={(event) => setHyphens(event.target.checked)} />
          Hyphens
        </label>
      </section>

      <section className={`${styles.listCard} panel`}>
        {formattedItems.length === 0 ? (
          <p className={styles.emptyText}>Click Generate to create UUIDs.</p>
        ) : (
          formattedItems.map((item, index) => (
            <div key={index} className={styles.itemRow}>
              <span className={styles.itemIndex}>{index + 1}</span>
              <span className={styles.itemValue}>{item}</span>
              <button
                className={styles.iconButton}
                onClick={() => copyValue(item, `UUID #${index + 1}`)}
                aria-label={`Copy UUID ${index + 1}`}
              >
                <Clipboard size={14} />
              </button>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
