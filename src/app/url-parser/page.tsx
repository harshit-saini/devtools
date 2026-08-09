"use client";

import { useEffect, useMemo, useState } from "react";
import { Clipboard, Link2, Plus, RotateCcw, Trash2 } from "lucide-react";
import styles from "./url-parser.module.css";
import ToolFullscreenButton from "@/components/ToolFullscreenButton";
import { useToolFullscreen } from "@/components/useToolFullscreen";

type EditablePart = "protocol" | "username" | "password" | "hostname" | "port" | "pathname" | "search" | "hash";

type FieldConfig = {
  part: EditablePart;
  label: string;
};

const FIELDS: FieldConfig[] = [
  { part: "protocol", label: "Protocol" },
  { part: "username", label: "User" },
  { part: "password", label: "Pass" },
  { part: "hostname", label: "Host" },
  { part: "port", label: "Port" },
  { part: "pathname", label: "Path" },
  { part: "search", label: "Query" },
  { part: "hash", label: "Hash" },
];

const SAMPLE_URL = "https://user:pass@example.com:8443/path/to/resource?search=devtools&sort=asc&sort=desc#section-2";
const URL_KEY = "devtools.urlParser.url";

function readLocalString(key: string, fallback: string): string {
  if (typeof window === "undefined") {
    return fallback;
  }

  return window.localStorage.getItem(key) ?? fallback;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function withUpdatedPart(url: URL, part: EditablePart, value: string): URL {
  const next = new URL(url.toString());
  if (part === "protocol") {
    next.protocol = value.endsWith(":") ? value : `${value}:`;
  } else {
    next[part] = value;
  }

  return next;
}

function withQueryPairs(url: URL, pairs: [string, string][]): URL {
  const next = new URL(url.toString());
  const params = new URLSearchParams();
  for (const [key, value] of pairs) {
    if (key) {
      params.append(key, value);
    }
  }

  next.search = params.toString();
  return next;
}

function displayValue(url: URL, part: EditablePart): string {
  const raw = String(url[part]);
  if (part === "protocol") {
    return raw.replace(/:$/, "");
  }

  if (part === "search") {
    return raw.replace(/^\?/, "");
  }

  if (part === "hash") {
    return raw.replace(/^#/, "");
  }

  return raw;
}

function tryEncode(value: string): string {
  try {
    return encodeURIComponent(value);
  } catch {
    return "Could not encode this text";
  }
}

function tryDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "Malformed URI sequence";
  }
}

export default function UrlParserPage() {
  const { containerRef, isFullscreen, fullscreenSupported, toggleFullscreen } =
    useToolFullscreen<HTMLDivElement>();

  const [urlText, setUrlText] = useState(() => readLocalString(URL_KEY, SAMPLE_URL));
  const [encodeInput, setEncodeInput] = useState("hello world/devtools?");
  const [decodeInput, setDecodeInput] = useState("hello%20world%2Fdevtools%3F");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      window.localStorage.setItem(URL_KEY, urlText);
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [urlText]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeoutId = window.setTimeout(() => setNotice(""), 1600);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const parsed = useMemo(() => parseUrl(urlText), [urlText]);
  const queryPairs = useMemo<[string, string][]>(
    () => (parsed ? Array.from(parsed.searchParams.entries()) : []),
    [parsed],
  );

  const updateField = (part: EditablePart, value: string) => {
    if (!parsed) {
      return;
    }

    setUrlText(withUpdatedPart(parsed, part, value).toString());
  };

  const updateQueryPair = (index: number, field: "key" | "value", value: string) => {
    if (!parsed) {
      return;
    }

    const nextPairs = queryPairs.map((pair, pairIndex) =>
      pairIndex === index ? ([field === "key" ? value : pair[0], field === "value" ? value : pair[1]] as [string, string]) : pair,
    );
    setUrlText(withQueryPairs(parsed, nextPairs).toString());
  };

  const addQueryPair = () => {
    if (!parsed) {
      return;
    }

    setUrlText(withQueryPairs(parsed, [...queryPairs, ["param", ""]]).toString());
  };

  const removeQueryPair = (index: number) => {
    if (!parsed) {
      return;
    }

    setUrlText(withQueryPairs(parsed, queryPairs.filter((_, pairIndex) => pairIndex !== index)).toString());
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
    setUrlText(SAMPLE_URL);
    setNotice("Sample URL loaded");
  };

  const clearAll = () => {
    setUrlText("");
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
            <Link2 size={22} />
          </span>
          <div>
            <h2 className="toolTitle">URL Parser / Builder</h2>
            <p className="toolSubtitle">
              Break a URL into parts, edit query parameters live, and rebuild it as you go.
            </p>
          </div>
        </div>

        <div className={styles.actions}>
          <ToolFullscreenButton
            isFullscreen={isFullscreen}
            onToggle={toggleFullscreen}
            supported={fullscreenSupported}
          />
          <button className="btn btnSecondary" onClick={() => copyValue(urlText, "URL")}>
            <Clipboard size={15} />
            Copy URL
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
        {parsed ? (
          <>
            <span className="statusChip">Origin: {parsed.origin}</span>
            <span className="statusChip">Params: {queryPairs.length}</span>
          </>
        ) : (
          <span className={styles.error}>Enter a valid absolute URL (including a protocol) to see its breakdown.</span>
        )}
        {notice && <span className={styles.notice}>{notice}</span>}
      </div>

      <section className={`${styles.inputCard} panel`}>
        <label className={styles.label} htmlFor="url-parser-input">
          Full URL
        </label>
        <input
          id="url-parser-input"
          className={styles.urlInput}
          value={urlText}
          onChange={(event) => setUrlText(event.target.value)}
          aria-invalid={!parsed}
          placeholder="https://example.com/path?query=1"
          autoComplete="off"
          spellCheck={false}
        />
      </section>

      <div className={styles.grid}>
        <section className={`${styles.card} panel`}>
          <h3 className={styles.sectionTitle}>Parts</h3>
          {FIELDS.map((field) => (
            <div key={field.part} className={styles.fieldRow}>
              <span className={styles.fieldLabel}>{field.label}</span>
              <input
                className={styles.fieldInput}
                value={parsed ? displayValue(parsed, field.part) : ""}
                onChange={(event) => updateField(field.part, event.target.value)}
                disabled={!parsed}
                spellCheck={false}
              />
              <button
                className={styles.iconButton}
                onClick={() => copyValue(parsed ? displayValue(parsed, field.part) : "", field.label)}
                disabled={!parsed}
                aria-label={`Copy ${field.label}`}
                title={`Copy ${field.label}`}
              >
                <Clipboard size={14} />
              </button>
            </div>
          ))}
        </section>

        <section className={`${styles.card} panel`}>
          <h3 className={styles.sectionTitle}>Query parameters</h3>
          <div className={styles.paramsList}>
            {queryPairs.length === 0 && <p className={styles.emptyText}>No query parameters yet.</p>}
            {queryPairs.map(([key, value], index) => (
              <div key={index} className={styles.paramRow}>
                <input
                  className={styles.fieldInput}
                  value={key}
                  onChange={(event) => updateQueryPair(index, "key", event.target.value)}
                  placeholder="key"
                  spellCheck={false}
                />
                <input
                  className={styles.fieldInput}
                  value={value}
                  onChange={(event) => updateQueryPair(index, "value", event.target.value)}
                  placeholder="value"
                  spellCheck={false}
                />
                <button
                  className={styles.iconButton}
                  onClick={() => removeQueryPair(index)}
                  aria-label={`Remove parameter ${key || index + 1}`}
                  title="Remove parameter"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          <button className="btn btnSecondary" onClick={addQueryPair} disabled={!parsed}>
            <Plus size={15} />
            Add parameter
          </button>
        </section>
      </div>

      <section className={`${styles.card} panel`}>
        <h3 className={styles.sectionTitle}>Component encode / decode</h3>
        <div className={styles.encodeGrid}>
          <div className={styles.encodeField}>
            <label className={styles.label} htmlFor="url-encode-input">
              Text to encode
            </label>
            <input
              id="url-encode-input"
              className={styles.fieldInput}
              value={encodeInput}
              onChange={(event) => setEncodeInput(event.target.value)}
              spellCheck={false}
            />
            <div className={styles.encodeOutputRow}>
              <span className={styles.encodeOutput}>{tryEncode(encodeInput)}</span>
              <button
                className={styles.iconButton}
                onClick={() => copyValue(tryEncode(encodeInput), "Encoded text")}
                aria-label="Copy encoded text"
              >
                <Clipboard size={14} />
              </button>
            </div>
          </div>

          <div className={styles.encodeField}>
            <label className={styles.label} htmlFor="url-decode-input">
              Text to decode
            </label>
            <input
              id="url-decode-input"
              className={styles.fieldInput}
              value={decodeInput}
              onChange={(event) => setDecodeInput(event.target.value)}
              spellCheck={false}
            />
            <div className={styles.encodeOutputRow}>
              <span className={styles.encodeOutput}>{tryDecode(decodeInput)}</span>
              <button
                className={styles.iconButton}
                onClick={() => copyValue(tryDecode(decodeInput), "Decoded text")}
                aria-label="Copy decoded text"
              >
                <Clipboard size={14} />
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
