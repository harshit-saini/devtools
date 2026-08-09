"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Clipboard, Network, Plus, RotateCcw, Trash2, X } from "lucide-react";
import styles from "./http-headers.module.css";
import ToolFullscreenButton from "@/components/ToolFullscreenButton";
import { useToolFullscreen } from "@/components/useToolFullscreen";

type HeaderPair = { name: string; value: string };
type ParsedLine =
  | { type: "status"; text: string }
  | { type: "header"; name: string; value: string }
  | { type: "invalid"; text: string };

const RAW_KEY = "devtools.httpHeaders.raw";

const SAMPLE_RAW = [
  "HTTP/1.1 200 OK",
  "Content-Type: application/json",
  "Authorization: Bearer token",
  "Set-Cookie: session=abc123; Path=/",
  "Set-Cookie: theme=dark; Path=/",
  "Cache-Control: no-store",
].join("\n");

const SECURITY_HEADERS: { name: string; hint: string }[] = [
  { name: "Content-Security-Policy", hint: "Restricts sources for scripts, styles, and more." },
  { name: "Strict-Transport-Security", hint: "Forces HTTPS on future visits." },
  { name: "X-Content-Type-Options", hint: 'Blocks MIME-sniffing (expects "nosniff").' },
  { name: "X-Frame-Options", hint: "Prevents clickjacking via framing." },
  { name: "Referrer-Policy", hint: "Controls how much referrer info leaks." },
  { name: "Permissions-Policy", hint: "Restricts access to browser features." },
];

function readLocalString(key: string, fallback: string): string {
  if (typeof window === "undefined") {
    return fallback;
  }

  return window.localStorage.getItem(key) ?? fallback;
}

function parseHeaderText(raw: string): ParsedLine[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line, index) => {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) {
      if (index === 0 && /^HTTP\/\d/i.test(line)) {
        return { type: "status", text: line };
      }

      return { type: "invalid", text: line };
    }

    const name = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (!name) {
      return { type: "invalid", text: line };
    }

    return { type: "header", name, value };
  });
}

function rebuildRaw(statusLine: string | null, headers: HeaderPair[]): string {
  const lines: string[] = [];
  if (statusLine) {
    lines.push(statusLine);
  }

  for (const header of headers) {
    lines.push(`${header.name}: ${header.value}`);
  }

  return lines.join("\n");
}

function toFetchHeadersSnippet(headers: HeaderPair[]): string {
  const record: Record<string, string> = {};
  for (const header of headers) {
    record[header.name] = header.value;
  }

  return JSON.stringify(record, null, 2);
}

function toCurlSnippet(headers: HeaderPair[]): string {
  if (headers.length === 0) {
    return "";
  }

  const flags = headers.map((header) => `-H "${header.name}: ${header.value.replace(/"/g, '\\"')}"`);
  return ["curl \\", ...flags.map((flag, index) => (index === flags.length - 1 ? `  ${flag}` : `  ${flag} \\`))].join(
    "\n",
  );
}

export default function HttpHeadersPage() {
  const { containerRef, isFullscreen, fullscreenSupported, toggleFullscreen } =
    useToolFullscreen<HTMLDivElement>();

  const [raw, setRaw] = useState(() => readLocalString(RAW_KEY, SAMPLE_RAW));
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      window.localStorage.setItem(RAW_KEY, raw);
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [raw]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeoutId = window.setTimeout(() => setNotice(""), 1600);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const parsed = useMemo(() => parseHeaderText(raw), [raw]);
  const statusLine = useMemo(() => {
    const found = parsed.find((line) => line.type === "status");
    return found ? found.text : null;
  }, [parsed]);
  const headers = useMemo(
    () => parsed.filter((line): line is { type: "header"; name: string; value: string } => line.type === "header"),
    [parsed],
  );
  const invalidLines = useMemo(
    () => parsed.filter((line): line is { type: "invalid"; text: string } => line.type === "invalid"),
    [parsed],
  );

  const nameCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const header of headers) {
      const key = header.name.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return counts;
  }, [headers]);

  const presentSecurityHeaders = useMemo(() => {
    const present = new Set(headers.map((header) => header.name.toLowerCase()));
    return new Set(SECURITY_HEADERS.filter((entry) => present.has(entry.name.toLowerCase())).map((entry) => entry.name));
  }, [headers]);

  const updateHeader = (index: number, field: "name" | "value", value: string) => {
    const nextHeaders = headers.map((header, headerIndex) =>
      headerIndex === index ? { ...header, [field]: value } : header,
    );
    setRaw(rebuildRaw(statusLine, nextHeaders));
  };

  const removeHeader = (index: number) => {
    setRaw(rebuildRaw(statusLine, headers.filter((_, headerIndex) => headerIndex !== index)));
  };

  const addHeader = () => {
    setRaw(rebuildRaw(statusLine, [...headers, { name: "X-Header", value: "" }]));
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

  const loadSample = () => {
    setRaw(SAMPLE_RAW);
    setNotice("Sample headers loaded");
  };

  const clearAll = () => {
    setRaw("");
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
            <Network size={22} />
          </span>
          <div>
            <h2 className="toolTitle">HTTP Header Inspector</h2>
            <p className="toolSubtitle">
              Parse, edit, and rebuild HTTP headers, with duplicate detection and a security-header checklist.
            </p>
          </div>
        </div>

        <div className={styles.actions}>
          <ToolFullscreenButton
            isFullscreen={isFullscreen}
            onToggle={toggleFullscreen}
            supported={fullscreenSupported}
          />
          <button className="btn btnSecondary" onClick={() => copyValue(raw, "Raw headers")}>
            <Clipboard size={15} />
            Copy raw
          </button>
          <button className="btn btnSecondary" onClick={loadSample}>
            Load sample
          </button>
          <button className="btn btnDanger" onClick={clearAll}>
            <RotateCcw size={15} />
            Clear
          </button>
        </div>
      </header>

      <div className="toolMetaRow">
        <span className="statusChip">Headers: {headers.length}</span>
        {invalidLines.length > 0 && <span className="statusChip">Invalid lines: {invalidLines.length}</span>}
        <span className="statusChip">
          Security headers present: {presentSecurityHeaders.size}/{SECURITY_HEADERS.length}
        </span>
        {notice && <span className={styles.notice}>{notice}</span>}
      </div>

      <div className={styles.grid}>
        <section className={`${styles.card} panel`}>
          <h3 className={styles.sectionTitle}>Raw headers</h3>
          <textarea
            className={styles.textarea}
            value={raw}
            onChange={(event) => setRaw(event.target.value)}
            spellCheck={false}
            placeholder={"Content-Type: application/json\nAuthorization: Bearer token"}
          />
          {invalidLines.length > 0 && (
            <div className={styles.rowsList}>
              {invalidLines.map((line, index) => (
                <div key={index} className={styles.invalidRow}>
                  Not a valid header (missing &quot;:&quot;): {line.text}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={`${styles.card} panel`}>
          <h3 className={styles.sectionTitle}>Parsed headers</h3>
          {statusLine && <div className={styles.statusRow}>{statusLine}</div>}
          <div className={styles.rowsList}>
            {headers.length === 0 && <p className={styles.emptyText}>No headers parsed yet.</p>}
            {headers.map((header, index) => {
              const duplicateCount = nameCounts.get(header.name.toLowerCase()) ?? 1;
              return (
                <div key={index} className={styles.headerRow}>
                  <input
                    className={styles.fieldInput}
                    value={header.name}
                    onChange={(event) => updateHeader(index, "name", event.target.value)}
                    spellCheck={false}
                  />
                  <input
                    className={styles.fieldInput}
                    value={header.value}
                    onChange={(event) => updateHeader(index, "value", event.target.value)}
                    spellCheck={false}
                  />
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {duplicateCount > 1 && <span className={styles.duplicateBadge}>×{duplicateCount}</span>}
                    <button
                      className={styles.iconButton}
                      onClick={() => copyValue(`${header.name}: ${header.value}`, header.name)}
                      aria-label={`Copy ${header.name}`}
                    >
                      <Clipboard size={14} />
                    </button>
                    <button
                      className={styles.iconButton}
                      onClick={() => removeHeader(index)}
                      aria-label={`Remove ${header.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <button className="btn btnSecondary" onClick={addHeader}>
            <Plus size={15} />
            Add header
          </button>
        </section>
      </div>

      <section className={`${styles.card} panel`}>
        <h3 className={styles.sectionTitle}>Security header checklist</h3>
        <div className={styles.securityList}>
          {SECURITY_HEADERS.map((entry) => {
            const present = presentSecurityHeaders.has(entry.name);
            return (
              <div
                key={entry.name}
                className={`${styles.securityRow} ${present ? styles.securityPresent : styles.securityMissing}`}
              >
                {present ? <Check size={14} /> : <X size={14} />}
                <strong>{entry.name}</strong>
                <span>— {entry.hint}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className={`${styles.card} panel`}>
        <h3 className={styles.sectionTitle}>Export</h3>
        <div className={styles.exportRow}>
          <button className="btn btnSecondary" onClick={() => copyValue(toFetchHeadersSnippet(headers), "fetch() headers")}>
            <Clipboard size={15} />
            Copy as fetch() headers
          </button>
          <button className="btn btnSecondary" onClick={() => copyValue(toCurlSnippet(headers), "curl flags")}>
            <Clipboard size={15} />
            Copy as curl -H flags
          </button>
        </div>
      </section>
    </div>
  );
}
