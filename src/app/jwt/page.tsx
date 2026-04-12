"use client";

import { useMemo, useState } from "react";
import { Clipboard, KeyRound, RotateCcw } from "lucide-react";
import styles from "./jwt.module.css";
import ToolFullscreenButton from "@/components/ToolFullscreenButton";
import { useToolFullscreen } from "@/components/useToolFullscreen";

const sampleJwt =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

type JwtObject = Record<string, unknown>;

type DecodedJwt = {
  header: JwtObject | null;
  payload: JwtObject | null;
  signature: string;
  error: string;
};

function decodeBase64Url(segment: string): string {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return atob(padded);
}

function decodeJwt(token: string): DecodedJwt {
  const trimmed = token.trim();
  if (!trimmed) {
    return {
      header: null,
      payload: null,
      signature: "",
      error: "Paste a JWT to decode.",
    };
  }

  const parts = trimmed.split(".");
  if (parts.length !== 3) {
    return {
      header: null,
      payload: null,
      signature: "",
      error: "JWT must have 3 dot-separated segments.",
    };
  }

  try {
    const header = JSON.parse(decodeBase64Url(parts[0])) as JwtObject;
    const payload = JSON.parse(decodeBase64Url(parts[1])) as JwtObject;

    return {
      header,
      payload,
      signature: parts[2],
      error: "",
    };
  } catch {
    return {
      header: null,
      payload: null,
      signature: "",
      error: "Could not decode this token. Check the format.",
    };
  }
}

function formatClaimValue(key: string, value: unknown): string {
  if (typeof value === "number" && ["iat", "exp", "nbf"].includes(key)) {
    const readable = new Date(value * 1000).toLocaleString();
    return `${value} (${readable})`;
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function ClaimTable({ title, data }: { title: string; data: JwtObject | null }) {
  return (
    <section className={`${styles.claimBlock} panel`}>
      <h3>{title}</h3>
      {data ? (
        <table className={styles.claimTable}>
          <tbody>
            {Object.entries(data).map(([key, value]) => (
              <tr key={key}>
                <th>{key}</th>
                <td>{formatClaimValue(key, value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className={styles.emptyText}>No decoded data yet.</p>
      )}
    </section>
  );
}

export default function JwtDecoderPage() {
  const { containerRef, isFullscreen, fullscreenSupported, toggleFullscreen } =
    useToolFullscreen<HTMLDivElement>();
  const [token, setToken] = useState(sampleJwt);
  const [notice, setNotice] = useState("");

  const decoded = useMemo(() => decodeJwt(token), [token]);

  const copySection = async (section: "header" | "payload") => {
    const value = decoded[section];
    if (!value) {
      setNotice(`No ${section} to copy`);
      return;
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
      setNotice(`${section} copied`);
      window.setTimeout(() => setNotice(""), 1400);
    } catch {
      setNotice("Clipboard copy failed");
      window.setTimeout(() => setNotice(""), 1400);
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
              <KeyRound size={22} />
            </span>
            <div>
              <h2 className="toolTitle">JWT Decoder</h2>
              <p className="toolSubtitle">Decode JWT header and payload locally. No token data leaves your browser.</p>
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          <ToolFullscreenButton
            isFullscreen={isFullscreen}
            onToggle={toggleFullscreen}
            supported={fullscreenSupported}
          />
          <button className="btn btnSecondary" onClick={() => copySection("header")}>
            <Clipboard size={15} />
            Copy header
          </button>
          <button className="btn btnSecondary" onClick={() => copySection("payload")}>
            <Clipboard size={15} />
            Copy payload
          </button>
          <button className="btn btnSecondary" onClick={() => setToken(sampleJwt)}>
            Load sample
          </button>
          <button className="btn btnDanger" onClick={() => setToken("")}>
            <RotateCcw size={15} />
            Clear
          </button>
        </div>
      </header>

      <div className="toolMetaRow">
        <span className="statusChip">Signature length: {decoded.signature.length}</span>
        {notice && <span className={styles.notice}>{notice}</span>}
        {decoded.error && <span className={styles.error}>{decoded.error}</span>}
      </div>

      <section className={`${styles.tokenBlock} panel`}>
        <label className={styles.label}>JWT token</label>
        <textarea
          className={styles.tokenInput}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          spellCheck={false}
          placeholder="Paste JWT here"
        />
      </section>

      <div className={styles.grid}>
        <ClaimTable title="Header" data={decoded.header} />
        <ClaimTable title="Payload" data={decoded.payload} />
      </div>
    </div>
  );
}
