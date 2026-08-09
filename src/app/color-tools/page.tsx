"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Clipboard, Dices, Download, Palette, RotateCcw } from "lucide-react";
import styles from "./color-tools.module.css";
import ToolFullscreenButton from "@/components/ToolFullscreenButton";
import { useToolFullscreen } from "@/components/useToolFullscreen";

type RoleKey = "primary" | "accent" | "background" | "text";
type ColorFormat = "hex" | "rgb" | "hsl";
type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };

type RoleConfig = {
  key: RoleKey;
  label: string;
  hint: string;
};

type Theme = Record<RoleKey, string>;

const ROLES: RoleConfig[] = [
  { key: "primary", label: "Primary", hint: "Buttons, links, brand accents" },
  { key: "accent", label: "Accent", hint: "Highlights, secondary actions" },
  { key: "background", label: "Background", hint: "Page canvas" },
  { key: "text", label: "Text", hint: "Body copy on background" },
];

const SHADE_STOPS: { label: string; lightness: number }[] = [
  { label: "50", lightness: 95 },
  { label: "100", lightness: 90 },
  { label: "200", lightness: 80 },
  { label: "300", lightness: 70 },
  { label: "400", lightness: 60 },
  { label: "500", lightness: 50 },
  { label: "600", lightness: 40 },
  { label: "700", lightness: 30 },
  { label: "800", lightness: 20 },
  { label: "900", lightness: 10 },
];

const PRESETS: { name: string; theme: Theme }[] = [
  { name: "Ocean Teal", theme: { primary: "#0f766e", accent: "#ea580c", background: "#f4f8f8", text: "#142432" } },
  { name: "Midnight", theme: { primary: "#6366f1", accent: "#f59e0b", background: "#0f172a", text: "#e2e8f0" } },
  { name: "Sunset", theme: { primary: "#f97316", accent: "#db2777", background: "#fff7ed", text: "#451a03" } },
  { name: "Forest", theme: { primary: "#16a34a", accent: "#854d0e", background: "#f0fdf4", text: "#14532d" } },
  { name: "Grape", theme: { primary: "#7c3aed", accent: "#ec4899", background: "#faf5ff", text: "#3b0764" } },
];

const DEFAULT_THEME: Theme = PRESETS[0].theme;
const THEME_KEY = "devtools.colorTools.theme";
const FORMAT_KEY = "devtools.colorTools.format";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeHex(input: string): string | null {
  const trimmed = input.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(trimmed)) {
    const expanded = trimmed
      .split("")
      .map((char) => char + char)
      .join("");
    return `#${expanded.toLowerCase()}`;
  }

  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) {
    return `#${trimmed.toLowerCase()}`;
  }

  return null;
}

function hexToRgb(hex: string): Rgb {
  const normalized = normalizeHex(hex) ?? "#000000";
  const value = Number.parseInt(normalized.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function rgbToHex({ r, g, b }: Rgb): string {
  const toHex = (channel: number) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  const delta = max - min;
  const l = (max + min) / 2;

  if (delta === 0) {
    return { h: 0, s: 0, l: Math.round(l * 100) };
  }

  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rNorm) {
    h = ((gNorm - bNorm) / delta) % 6;
  } else if (max === gNorm) {
    h = (bNorm - rNorm) / delta + 2;
  } else {
    h = (rNorm - gNorm) / delta + 4;
  }

  h *= 60;
  if (h < 0) {
    h += 360;
  }

  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lNorm - c / 2;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;

  if (h < 60) {
    rPrime = c;
    gPrime = x;
  } else if (h < 120) {
    rPrime = x;
    gPrime = c;
  } else if (h < 180) {
    gPrime = c;
    bPrime = x;
  } else if (h < 240) {
    gPrime = x;
    bPrime = c;
  } else if (h < 300) {
    rPrime = x;
    bPrime = c;
  } else {
    rPrime = c;
    bPrime = x;
  }

  return {
    r: Math.round((rPrime + m) * 255),
    g: Math.round((gPrime + m) * 255),
    b: Math.round((bPrime + m) * 255),
  };
}

function formatColor(hex: string, format: ColorFormat): string {
  const rgb = hexToRgb(hex);
  if (format === "rgb") {
    return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  }

  if (format === "hsl") {
    const hsl = rgbToHsl(rgb);
    return `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`;
  }

  return normalizeHex(hex) ?? hex;
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(hexA: string, hexB: string): number {
  const luminanceA = relativeLuminance(hexToRgb(hexA));
  const luminanceB = relativeLuminance(hexToRgb(hexB));
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);
  return (lighter + 0.05) / (darker + 0.05);
}

function readableTextColor(hex: string): string {
  return contrastRatio(hex, "#000000") >= contrastRatio(hex, "#ffffff") ? "#0b1220" : "#f8fafc";
}

function generateShadeRamp(hex: string): { label: string; hex: string }[] {
  const base = rgbToHsl(hexToRgb(hex));
  return SHADE_STOPS.map((stop) => ({
    label: stop.label,
    hex: rgbToHex(hslToRgb({ h: base.h, s: base.s, l: stop.lightness })),
  }));
}

function randomHexColor(): string {
  const hsl: Hsl = { h: Math.floor(Math.random() * 360), s: 55 + Math.floor(Math.random() * 30), l: 45 + Math.floor(Math.random() * 15) };
  return rgbToHex(hslToRgb(hsl));
}

function readLocalTheme(): Theme {
  if (typeof window === "undefined") {
    return DEFAULT_THEME;
  }

  const raw = window.localStorage.getItem(THEME_KEY);
  if (!raw) {
    return DEFAULT_THEME;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Theme>;
    const isValid = ROLES.every((role) => typeof parsed[role.key] === "string" && normalizeHex(parsed[role.key]!));
    return isValid ? (parsed as Theme) : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function readLocalFormat(): ColorFormat {
  if (typeof window === "undefined") {
    return "hex";
  }

  const stored = window.localStorage.getItem(FORMAT_KEY);
  return stored === "rgb" || stored === "hsl" ? stored : "hex";
}

const CONTRAST_PAIRS: { label: string; foreground: RoleKey; background: RoleKey }[] = [
  { label: "Text on Background", foreground: "text", background: "background" },
  { label: "Primary on Background", foreground: "primary", background: "background" },
  { label: "Accent on Background", foreground: "accent", background: "background" },
];

export default function ColorToolsPage() {
  const { containerRef, isFullscreen, fullscreenSupported, toggleFullscreen } =
    useToolFullscreen<HTMLDivElement>();

  const [theme, setTheme] = useState<Theme>(() => readLocalTheme());
  const [drafts, setDrafts] = useState<Theme>(theme);
  const [format, setFormat] = useState<ColorFormat>(() => readLocalFormat());
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setDrafts(theme);
  }, [theme]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timeoutId = window.setTimeout(() => setNotice(""), 1600);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  useEffect(() => {
    window.localStorage.setItem(THEME_KEY, JSON.stringify(theme));
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(FORMAT_KEY, format);
  }, [format]);

  const setRole = (role: RoleKey, hex: string) => {
    setTheme((current) => ({ ...current, [role]: hex }));
  };

  const setDraft = (role: RoleKey, value: string) => {
    setDrafts((current) => ({ ...current, [role]: value }));
    const normalized = normalizeHex(value);
    if (normalized) {
      setRole(role, normalized);
    }
  };

  const commitDraft = (role: RoleKey) => {
    setDrafts((current) => ({ ...current, [role]: theme[role] }));
  };

  const applyPreset = (preset: Theme, name: string) => {
    setTheme(preset);
    setNotice(`${name} theme applied`);
  };

  const shuffleTheme = () => {
    const isDark = Math.random() > 0.5;
    setTheme({
      primary: randomHexColor(),
      accent: randomHexColor(),
      background: isDark ? "#0f172a" : "#f8fafc",
      text: isDark ? "#e2e8f0" : "#0f172a",
    });
    setNotice("Random theme generated");
  };

  const resetTheme = () => {
    setTheme(DEFAULT_THEME);
    setNotice("Theme reset to default");
  };

  const copyValue = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied`);
    } catch {
      setNotice("Clipboard copy failed");
    }
  };

  const css = useMemo(() => {
    const lines = [":root {"];
    for (const role of ROLES) {
      lines.push(`  --${role.key}: ${formatColor(theme[role.key], format)};`);
    }

    for (const role of ["primary", "accent"] as const) {
      const ramp = generateShadeRamp(theme[role]);
      for (const shade of ramp) {
        lines.push(`  --${role}-${shade.label}: ${formatColor(shade.hex, format)};`);
      }
    }

    lines.push("}");
    return lines.join("\n");
  }, [theme, format]);

  const downloadCss = () => {
    const blob = new Blob([css], { type: "text/css;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "theme.css";
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("theme.css downloaded");
  };

  return (
    <div
      ref={containerRef}
      className={`${styles.container} pageShell animate-enter ${isFullscreen ? "toolFullscreen" : ""}`}
    >
      <header className="toolHeader">
        <div className="toolTitleRow">
          <span className="toolIconBadge">
            <Palette size={22} />
          </span>
          <div>
            <h2 className="toolTitle">Color Theme Picker</h2>
            <p className="toolSubtitle">
              Pick brand colors, preview them live, check contrast, and export CSS variables.
            </p>
          </div>
        </div>

        <div className={styles.actions}>
          <ToolFullscreenButton
            isFullscreen={isFullscreen}
            onToggle={toggleFullscreen}
            supported={fullscreenSupported}
          />

          <select
            value={format}
            className={styles.formatSelect}
            onChange={(event) => setFormat(event.target.value as ColorFormat)}
            aria-label="Color output format"
          >
            <option value="hex">HEX</option>
            <option value="rgb">RGB</option>
            <option value="hsl">HSL</option>
          </select>

          <button className="btn btnSecondary" onClick={shuffleTheme}>
            <Dices size={15} />
            Shuffle
          </button>
          <button className="btn btnSecondary" onClick={() => copyValue(css, "CSS")}>
            <Clipboard size={15} />
            Copy CSS
          </button>
          <button className="btn btnSecondary" onClick={downloadCss}>
            <Download size={15} />
            Download CSS
          </button>
          <button className="btn btnDanger" onClick={resetTheme}>
            <RotateCcw size={15} />
            Reset
          </button>
        </div>
      </header>

      <div className="toolMetaRow">
        <div className={styles.presetRow}>
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              className={styles.presetChip}
              onClick={() => applyPreset(preset.theme, preset.name)}
            >
              <span className={styles.presetSwatches}>
                <span style={{ background: preset.theme.primary }} />
                <span style={{ background: preset.theme.accent }} />
              </span>
              {preset.name}
            </button>
          ))}
        </div>

        {notice && <span className={styles.notice}>{notice}</span>}
      </div>

      <section className={styles.rolesGrid}>
        {ROLES.map((role) => {
          const isInvalid = normalizeHex(drafts[role.key]) === null;
          return (
            <div key={role.key} className={`${styles.roleCard} panel`}>
              <div className={styles.roleHeader}>
                <span className={styles.roleName}>{role.label}</span>
                <span className={styles.roleHint}>{role.hint}</span>
              </div>
              <div className={styles.swatchRow}>
                <input
                  type="color"
                  className={styles.swatch}
                  value={normalizeHex(theme[role.key]) ?? "#000000"}
                  onChange={(event) => setRole(role.key, event.target.value)}
                  aria-label={`${role.label} color picker`}
                />
                <input
                  type="text"
                  className={styles.hexInput}
                  value={drafts[role.key]}
                  onChange={(event) => setDraft(role.key, event.target.value)}
                  onBlur={() => commitDraft(role.key)}
                  aria-invalid={isInvalid}
                  aria-label={`${role.label} hex value`}
                  spellCheck={false}
                />
              </div>
              <div className={styles.copyChipRow}>
                {(["hex", "rgb", "hsl"] as ColorFormat[]).map((fmt) => (
                  <button
                    key={fmt}
                    className={styles.copyChip}
                    onClick={() => copyValue(formatColor(theme[role.key], fmt), `${role.label} ${fmt.toUpperCase()}`)}
                  >
                    <Clipboard size={11} />
                    {formatColor(theme[role.key], fmt)}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <section className={`${styles.shadesCard} panel`}>
        <h3 className={styles.sectionTitle}>Generated shades</h3>
        {(["primary", "accent"] as const).map((role) => (
          <div key={role} className={styles.shadeGroup}>
            <span className={styles.shadeGroupLabel}>{role === "primary" ? "Primary" : "Accent"}</span>
            <div className={styles.shadeStrip}>
              {generateShadeRamp(theme[role]).map((shade) => (
                <button
                  key={shade.label}
                  className={styles.shadeCell}
                  style={{ background: shade.hex, color: readableTextColor(shade.hex) }}
                  onClick={() => copyValue(formatColor(shade.hex, format), `${role} ${shade.label}`)}
                  title={`Copy --${role}-${shade.label}`}
                >
                  <span className={styles.shadeCellLabel}>{shade.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <div className={styles.previewGrid}>
        <section className={`${styles.previewCard} panel`}>
          <div className={styles.previewSurface} style={{ background: theme.background, color: theme.text }}>
            <h3 className={styles.previewHeading}>Live preview</h3>
            <p className={styles.previewBody}>
              This card uses your chosen background and text colors so you can see how the theme reads before
              exporting it.
            </p>
            <div className={styles.previewButtons}>
              <button
                className={styles.previewButtonPrimary}
                style={{ background: theme.primary, color: readableTextColor(theme.primary) }}
              >
                Primary action
              </button>
              <button
                className={styles.previewButtonAccent}
                style={{ background: theme.accent, color: readableTextColor(theme.accent) }}
              >
                Accent action
              </button>
            </div>
          </div>
          <div className={styles.previewCardFooter} style={{ color: theme.text }}>
            Preview renders live as you edit colors above.
          </div>
        </section>

        <section className={`${styles.contrastCard} panel`}>
          <h3 className={styles.sectionTitle}>Contrast checker</h3>
          {CONTRAST_PAIRS.map((pair) => {
            const ratio = contrastRatio(theme[pair.foreground], theme[pair.background]);
            const passesAA = ratio >= 4.5;
            const passesAAA = ratio >= 7;
            return (
              <div key={pair.label} className={styles.contrastRow}>
                <div className={styles.contrastPair}>
                  <span className={styles.contrastSwatches}>
                    <span style={{ background: theme[pair.background] }} />
                    <span style={{ background: theme[pair.foreground] }} />
                  </span>
                  {pair.label}
                </div>
                <div className={styles.contrastScore}>
                  {ratio.toFixed(2)}:1
                  {passesAA ? (
                    <span className={styles.badgePass}>
                      <Check size={10} style={{ display: "inline", verticalAlign: "-1px" }} /> AA
                    </span>
                  ) : (
                    <span className={styles.badgeFail}>Fails AA</span>
                  )}
                  {passesAAA ? (
                    <span className={styles.badgePass}>AAA</span>
                  ) : (
                    <span className={styles.badgeFail}>Fails AAA</span>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      </div>

      <section className={`${styles.cssCard} panel`}>
        <h3 className={styles.sectionTitle}>Exported CSS variables</h3>
        <textarea className={styles.cssOutput} value={css} readOnly spellCheck={false} />
      </section>
    </div>
  );
}
