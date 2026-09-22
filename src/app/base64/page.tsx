"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Binary, Clipboard, Trash2 } from "lucide-react";
import styles from "./base64.module.css";
import ToolFullscreenButton from "@/components/ToolFullscreenButton";
import { useToolFullscreen } from "@/components/useToolFullscreen";
import { useStoredSnapshot } from "@/lib/useLocalStorageState";

const SAMPLE_PLAIN_TEXT = "Hello, DevTool Deck!";
const PLAIN_KEY = "devtools.base64.plain";

function encodeBase64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

function decodeBase64(value: string): string {
  return decodeURIComponent(escape(atob(value)));
}

export default function Base64Tool() {
  const { containerRef, isFullscreen, fullscreenSupported, toggleFullscreen } = useToolFullscreen<HTMLDivElement>();
  // Initial state intentionally matches what the server renders (the hardcoded sample, not
  // localStorage) so hydration never mismatches. restoredPlainText only reflects the saved value
  // once useStoredSnapshot resyncs after mount; the seed check below then applies it once.
  const restoredPlainText = useStoredSnapshot(PLAIN_KEY, SAMPLE_PLAIN_TEXT, (raw) => raw);
  const [plainText, setPlainText] = useState(SAMPLE_PLAIN_TEXT);
  const [base64Text, setBase64Text] = useState(() => encodeBase64(SAMPLE_PLAIN_TEXT));
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [seededPlainText, setSeededPlainText] = useState(SAMPLE_PLAIN_TEXT);

  if (restoredPlainText !== seededPlainText) {
    setSeededPlainText(restoredPlainText);
    setPlainText(restoredPlainText);
    try {
      setBase64Text(encodeBase64(restoredPlainText));
    } catch {
      setBase64Text("");
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      window.localStorage.setItem(PLAIN_KEY, plainText);
    }, 400);
    return () => window.clearTimeout(timeoutId);
  }, [plainText]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeoutId = window.setTimeout(() => setNotice(""), 1600);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const stats = useMemo(
    () => ({ plain: plainText.length, encoded: base64Text.length }),
    [plainText.length, base64Text.length],
  );

  const handleEncode = () => {
    try {
      setBase64Text(encodeBase64(plainText));
      setError("");
    } catch {
      setError("Could not encode input.");
    }
  };

  const handleDecode = () => {
    try {
      setPlainText(decodeBase64(base64Text.trim()));
      setError("");
    } catch {
      setError("Invalid Base64 string.");
    }
  };

  const handleSwap = () => {
    setPlainText(base64Text);
    setBase64Text(plainText);
    setError("");
  };

  const loadSample = () => {
    setPlainText(SAMPLE_PLAIN_TEXT);
    setBase64Text(encodeBase64(SAMPLE_PLAIN_TEXT));
    setError("");
    setNotice("Sample loaded");
  };

  const clearAll = () => {
    setPlainText("");
    setBase64Text("");
    setError("");
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

  return (
    <div ref={containerRef} className={`${styles.container} pageShell animate-enter ${isFullscreen ? "toolFullscreen" : ""}`}>
      <header className="toolHeader">
        <div className="toolTitleRow">
          <span className="toolIconBadge"><Binary size={22} /></span>
          <div>
            <h2 className="toolTitle">Base64 Encoder/Decoder</h2>
            <p className="toolSubtitle">Encode and decode text locally in your browser.</p>
          </div>
        </div>
        <div className={styles.actions}>
          <ToolFullscreenButton isFullscreen={isFullscreen} onToggle={toggleFullscreen} supported={fullscreenSupported} />
          <button className="btn btnSecondary" onClick={handleEncode}>Encode</button>
          <button className="btn btnSecondary" onClick={handleDecode}>Decode</button>
          <button className="btn btnSecondary" onClick={handleSwap}><ArrowLeftRight size={15} />Swap</button>
          <button className="btn btnSecondary" onClick={loadSample}>Load sample</button>
          <button className="btn btnDanger" onClick={clearAll}><Trash2 size={15} />Clear</button>
        </div>
      </header>

      <div className="toolMetaRow">
        <span className="statusChip">Input chars: {stats.plain}</span>
        <span className="statusChip">Base64 chars: {stats.encoded}</span>
        {error && <span className={styles.errorChip}>{error}</span>}
        {notice && <span className={styles.notice}>{notice}</span>}
        <span role="status" aria-live="polite" className={styles.srOnly}>
          {error || notice}
        </span>
      </div>

      <section className={styles.grid}>
        <article className={`${styles.card} panel`}>
          <div className={styles.cardHead}>
            <h3>Plain Text</h3>
            <button className="btn btnSecondary" onClick={() => copyValue(plainText, "Plain text")}><Clipboard size={15} />Copy</button>
          </div>
          <textarea className={styles.textarea} value={plainText} onChange={(event) => setPlainText(event.target.value)} placeholder="Type plain text..." spellCheck={false} />
        </article>

        <article className={`${styles.card} panel`}>
          <div className={styles.cardHead}>
            <h3>Base64</h3>
            <button className="btn btnSecondary" onClick={() => copyValue(base64Text, "Base64 text")}><Clipboard size={15} />Copy</button>
          </div>
          <textarea className={styles.textarea} value={base64Text} onChange={(event) => setBase64Text(event.target.value)} placeholder="Base64 output/input..." spellCheck={false} />
        </article>
      </section>
    </div>
  );
}
