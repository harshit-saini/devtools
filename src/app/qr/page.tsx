"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import { Clipboard, Download, QrCode, RotateCcw, Sparkles } from "lucide-react";
import styles from "./qr.module.css";
import ToolFullscreenButton from "@/components/ToolFullscreenButton";
import { useToolFullscreen } from "@/components/useToolFullscreen";

const sampleUrl = "https://nextjs.org/docs";
const sizeOptions = [192, 256, 320, 384, 448, 512] as const;

function normalizeUrl(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return "";
  }

  const hasProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed);
  return hasProtocol ? trimmed : `https://${trimmed}`;
}

function validateUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "Only http/https URLs are supported.";
    }
    return null;
  } catch {
    return "Enter a valid URL.";
  }
}

export default function QrCodeToolPage() {
  const { containerRef, isFullscreen, fullscreenSupported, toggleFullscreen } =
    useToolFullscreen<HTMLDivElement>();
  const [urlInput, setUrlInput] = useState(sampleUrl);
  const [size, setSize] = useState<(typeof sizeOptions)[number]>(320);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [generatedUrl, setGeneratedUrl] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setNotice("");
    }, 1600);

    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const generatedHost = useMemo(() => {
    if (!generatedUrl) {
      return "";
    }

    try {
      return new URL(generatedUrl).hostname;
    } catch {
      return "";
    }
  }, [generatedUrl]);

  const generateQrCode = async () => {
    const normalizedUrl = normalizeUrl(urlInput);
    if (!normalizedUrl) {
      setError("Paste a URL first.");
      setNotice("");
      return;
    }

    const validationError = validateUrl(normalizedUrl);
    if (validationError) {
      setError(validationError);
      setNotice("");
      return;
    }

    setIsGenerating(true);

    try {
      const dataUrl = await QRCode.toDataURL(normalizedUrl, {
        width: size,
        margin: 2,
        errorCorrectionLevel: "M",
        color: {
          dark: "#142432",
          light: "#ffffffff",
        },
      });

      setQrDataUrl(dataUrl);
      setGeneratedUrl(normalizedUrl);
      setError("");
      setNotice("QR code generated");
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Could not generate QR code.");
      setNotice("");
    } finally {
      setIsGenerating(false);
    }
  };

  const copyUrl = async () => {
    const value = generatedUrl || normalizeUrl(urlInput);
    if (!value) {
      setNotice("No URL to copy");
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setNotice("URL copied");
    } catch {
      setNotice("Clipboard copy failed");
    }
  };

  const downloadPng = () => {
    if (!qrDataUrl) {
      setNotice("Generate a QR code first");
      return;
    }

    const suggestedName = generatedHost ? `${generatedHost}-qr-${size}.png` : `qr-code-${size}.png`;
    const anchor = document.createElement("a");
    anchor.href = qrDataUrl;
    anchor.download = suggestedName;
    anchor.click();
    setNotice("PNG downloaded");
  };

  const clearAll = () => {
    setUrlInput("");
    setQrDataUrl("");
    setGeneratedUrl("");
    setError("");
    setNotice("");
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
              <QrCode size={22} />
            </span>
            <div>
              <h2 className="toolTitle">QR Code Generator</h2>
              <p className="toolSubtitle">
                Generate PNG QR codes from URLs instantly. Everything runs locally in your browser.
              </p>
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          <ToolFullscreenButton
            isFullscreen={isFullscreen}
            onToggle={toggleFullscreen}
            supported={fullscreenSupported}
          />

          <label className={styles.sizeWrap}>
            Size
            <select
              value={size}
              onChange={(event) => setSize(Number(event.target.value) as (typeof sizeOptions)[number])}
            >
              {sizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option}px
                </option>
              ))}
            </select>
          </label>

          <button className="btn btnSecondary" onClick={copyUrl}>
            <Clipboard size={15} />
            Copy URL
          </button>
          <button className="btn btnSecondary" onClick={downloadPng} disabled={!qrDataUrl}>
            <Download size={15} />
            Download PNG
          </button>
          <button
            className="btn btnSecondary"
            onClick={() => {
              setUrlInput(sampleUrl);
              setNotice("Sample URL loaded");
              setError("");
            }}
          >
            Load sample
          </button>
          <button className="btn btnDanger" onClick={clearAll}>
            <RotateCcw size={15} />
            Clear
          </button>
        </div>
      </header>

      <div className="toolMetaRow">
        <span className="statusChip">Output size: {size}px</span>
        {generatedHost && <span className="statusChip">Domain: {generatedHost}</span>}
        {notice && <span className={styles.notice}>{notice}</span>}
        {error && <span className={styles.error}>{error}</span>}
      </div>

      <section className={`${styles.inputCard} panel`}>
        <label className={styles.label} htmlFor="qr-url-input">
          URL
        </label>
        <div className={styles.inputRow}>
          <input
            id="qr-url-input"
            className={styles.urlInput}
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            placeholder="https://example.com"
            autoComplete="off"
            spellCheck={false}
          />
          <button className="btn btnPrimary" onClick={generateQrCode} disabled={isGenerating}>
            <Sparkles size={15} />
            {isGenerating ? "Generating..." : "Generate"}
          </button>
        </div>
        <p className="helperText">If protocol is missing, the tool automatically prefixes your URL with https://.</p>
      </section>

      <div className={styles.grid}>
        <section className={`${styles.previewCard} panel`}>
          <h3>QR Preview</h3>
          <div className={styles.previewStage}>
            {qrDataUrl ? (
              <Image
                src={qrDataUrl}
                alt={generatedUrl ? `QR code for ${generatedUrl}` : "Generated QR code"}
                width={size}
                height={size}
                className={styles.qrImage}
                unoptimized
              />
            ) : (
              <p className={styles.emptyText}>Generate a QR code to preview it here.</p>
            )}
          </div>
        </section>

        <section className={`${styles.detailsCard} panel`}>
          <h3>Encoded URL</h3>
          {generatedUrl ? <p className={styles.generatedUrl}>{generatedUrl}</p> : <p className={styles.emptyText}>No URL generated yet.</p>}
          <p className={styles.tip}>Best used for share links, docs, localhost tunnels, and quick mobile testing.</p>
        </section>
      </div>
    </div>
  );
}
