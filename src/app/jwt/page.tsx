"use client";

import { useEffect, useMemo, useState } from "react";
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
  signingInput: string;
  error: string;
};

type ValidationMessage = {
  level: "ok" | "warn" | "error";
  text: string;
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
      signingInput: "",
      error: "Paste a JWT to decode.",
    };
  }

  const parts = trimmed.split(".");
  if (parts.length !== 3) {
    return {
      header: null,
      payload: null,
      signature: "",
      signingInput: "",
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
      signingInput: `${parts[0]}.${parts[1]}`,
      error: "",
    };
  } catch {
    return {
      header: null,
      payload: null,
      signature: "",
      signingInput: "",
      error: "Could not decode this token. Check the format.",
    };
  }
}

function getNumericClaim(payload: JwtObject, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function verifyHmacSignature(
  algorithm: "HS256" | "HS384" | "HS512",
  secret: string,
  signingInput: string,
  tokenSignature: string,
): Promise<boolean> {
  const hashName = algorithm === "HS256" ? "SHA-256" : algorithm === "HS384" ? "SHA-384" : "SHA-512";
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: hashName }, false, [
    "sign",
  ]);
  const signed = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));
  return toBase64(new Uint8Array(signed)) === tokenSignature;
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
  const [validateExp, setValidateExp] = useState(true);
  const [validateNbf, setValidateNbf] = useState(true);
  const [validateIat, setValidateIat] = useState(false);
  const [clockSkewSeconds, setClockSkewSeconds] = useState("0");
  const [expectedIssuer, setExpectedIssuer] = useState("");
  const [expectedAudience, setExpectedAudience] = useState("");
  const [expectedSubject, setExpectedSubject] = useState("");
  const [hmacSecret, setHmacSecret] = useState("");
  const [validationMessages, setValidationMessages] = useState<ValidationMessage[]>([]);

  const decoded = useMemo(() => decodeJwt(token), [token]);

  useEffect(() => {
    const runValidation = async () => {
      if (decoded.error || !decoded.payload) {
        setValidationMessages([]);
        return;
      }

      const payload = decoded.payload;
      const header = decoded.header ?? {};
      const messages: ValidationMessage[] = [];
      const nowSeconds = Math.floor(Date.now() / 1000);
      const skew = Number.parseInt(clockSkewSeconds, 10);
      const safeSkew = Number.isNaN(skew) ? 0 : Math.max(0, skew);

      const exp = getNumericClaim(payload, "exp");
      if (validateExp) {
        if (exp === null) {
          messages.push({ level: "warn", text: "exp validation enabled, but exp is missing or non-numeric." });
        } else if (nowSeconds - safeSkew >= exp) {
          messages.push({ level: "error", text: "Token is expired based on exp." });
        } else {
          messages.push({ level: "ok", text: "exp check passed." });
        }
      }

      const nbf = getNumericClaim(payload, "nbf");
      if (validateNbf) {
        if (nbf === null) {
          messages.push({ level: "warn", text: "nbf validation enabled, but nbf is missing or non-numeric." });
        } else if (nowSeconds + safeSkew < nbf) {
          messages.push({ level: "error", text: "Token is not active yet based on nbf." });
        } else {
          messages.push({ level: "ok", text: "nbf check passed." });
        }
      }

      const iat = getNumericClaim(payload, "iat");
      if (validateIat) {
        if (iat === null) {
          messages.push({ level: "warn", text: "iat validation enabled, but iat is missing or non-numeric." });
        } else if (nowSeconds + safeSkew < iat) {
          messages.push({ level: "error", text: "Token issue time is in the future based on iat." });
        } else {
          messages.push({ level: "ok", text: "iat check passed." });
        }
      }

      if (expectedIssuer.trim()) {
        if (payload.iss === expectedIssuer.trim()) {
          messages.push({ level: "ok", text: "Issuer (iss) matches expected value." });
        } else {
          messages.push({ level: "error", text: "Issuer (iss) does not match expected value." });
        }
      }

      if (expectedSubject.trim()) {
        if (payload.sub === expectedSubject.trim()) {
          messages.push({ level: "ok", text: "Subject (sub) matches expected value." });
        } else {
          messages.push({ level: "error", text: "Subject (sub) does not match expected value." });
        }
      }

      if (expectedAudience.trim()) {
        const aud = payload.aud;
        const matchesAudience =
          aud === expectedAudience.trim() || (Array.isArray(aud) && aud.includes(expectedAudience.trim()));
        if (matchesAudience) {
          messages.push({ level: "ok", text: "Audience (aud) matches expected value." });
        } else {
          messages.push({ level: "error", text: "Audience (aud) does not match expected value." });
        }
      }

      if (hmacSecret) {
        const alg = header.alg;
        if (alg === "HS256" || alg === "HS384" || alg === "HS512") {
          try {
            const valid = await verifyHmacSignature(alg, hmacSecret, decoded.signingInput, decoded.signature);
            messages.push({
              level: valid ? "ok" : "error",
              text: valid ? `Signature is valid for ${alg} using provided shared secret.` : `Signature is invalid for ${alg}.`,
            });
          } catch {
            messages.push({ level: "error", text: "Unable to verify HMAC signature in this browser context." });
          }
        } else {
          messages.push({ level: "warn", text: "Shared-secret verification supports only HS256/HS384/HS512." });
        }
      }

      if (messages.length === 0) {
        messages.push({ level: "warn", text: "No validation options selected yet." });
      }

      setValidationMessages(messages);
    };

    void runValidation();
  }, [
    clockSkewSeconds,
    decoded,
    expectedAudience,
    expectedIssuer,
    expectedSubject,
    hmacSecret,
    validateExp,
    validateIat,
    validateNbf,
  ]);

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

      <section className={`${styles.validationBlock} panel`}>
        <h3>Validation options</h3>
        <div className={styles.validationGrid}>
          <label className={styles.toggle}>
            <input type="checkbox" checked={validateExp} onChange={(event) => setValidateExp(event.target.checked)} />
            Validate expiration (exp)
          </label>
          <label className={styles.toggle}>
            <input type="checkbox" checked={validateNbf} onChange={(event) => setValidateNbf(event.target.checked)} />
            Validate not-before (nbf)
          </label>
          <label className={styles.toggle}>
            <input type="checkbox" checked={validateIat} onChange={(event) => setValidateIat(event.target.checked)} />
            Validate issue time (iat)
          </label>
          <label className={styles.fieldLabel}>
            Clock skew (seconds)
            <input
              className={styles.textInput}
              type="number"
              min={0}
              value={clockSkewSeconds}
              onChange={(event) => setClockSkewSeconds(event.target.value)}
            />
          </label>
          <label className={styles.fieldLabel}>
            Expected issuer (iss)
            <input
              className={styles.textInput}
              value={expectedIssuer}
              onChange={(event) => setExpectedIssuer(event.target.value)}
              placeholder="https://issuer.example"
            />
          </label>
          <label className={styles.fieldLabel}>
            Expected audience (aud)
            <input
              className={styles.textInput}
              value={expectedAudience}
              onChange={(event) => setExpectedAudience(event.target.value)}
              placeholder="my-audience"
            />
          </label>
          <label className={styles.fieldLabel}>
            Expected subject (sub)
            <input
              className={styles.textInput}
              value={expectedSubject}
              onChange={(event) => setExpectedSubject(event.target.value)}
              placeholder="user-id"
            />
          </label>
          <label className={styles.fieldLabel}>
            Shared secret (HS*)
            <input
              className={styles.textInput}
              value={hmacSecret}
              onChange={(event) => setHmacSecret(event.target.value)}
              placeholder="Optional: verify HS256/384/512 signature"
            />
          </label>
        </div>

        <ul className={styles.validationList}>
          {validationMessages.map((message) => (
            <li key={message.text} className={styles[`validation${message.level}`]}>
              {message.text}
            </li>
          ))}
        </ul>
      </section>

      <div className={styles.grid}>
        <ClaimTable title="Header" data={decoded.header} />
        <ClaimTable title="Payload" data={decoded.payload} />
      </div>
    </div>
  );
}
