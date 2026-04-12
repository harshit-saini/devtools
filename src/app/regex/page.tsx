"use client";

import { useMemo, useState } from "react";
import { Clipboard, Regex as RegexIcon, RotateCcw } from "lucide-react";
import styles from "./regex.module.css";
import ToolFullscreenButton from "@/components/ToolFullscreenButton";
import { useToolFullscreen } from "@/components/useToolFullscreen";

const sampleText = `// TODO: upgrade auth middleware\n// TODO: add retry behavior\nconst note = "done";`;

type MatchResult = {
  value: string;
  index: number;
  captures: string[];
};

const flagOrder = ["g", "i", "m", "s", "u", "y"] as const;

type FlagKey = (typeof flagOrder)[number];

type FlagState = Record<FlagKey, boolean>;

function toFlagString(flags: FlagState): string {
  return flagOrder.filter((flag) => flags[flag]).join("");
}

export default function RegexTesterPage() {
  const { containerRef, isFullscreen, fullscreenSupported, toggleFullscreen } =
    useToolFullscreen<HTMLDivElement>();
  const [pattern, setPattern] = useState("\\bTODO\\b");
  const [flags, setFlags] = useState<FlagState>({ g: true, i: false, m: true, s: false, u: false, y: false });
  const [testText, setTestText] = useState(sampleText);
  const [replacement, setReplacement] = useState("DONE");
  const [notice, setNotice] = useState("");

  const flagString = useMemo(() => toFlagString(flags), [flags]);

  const compiled = useMemo(() => {
    try {
      return {
        regex: new RegExp(pattern, flagString),
        error: "",
      };
    } catch (error) {
      return {
        regex: null,
        error: error instanceof Error ? error.message : "Invalid regular expression",
      };
    }
  }, [flagString, pattern]);

  const matches = useMemo<MatchResult[]>(() => {
    if (!compiled.regex) {
      return [];
    }

    const regex = new RegExp(compiled.regex.source, compiled.regex.flags);
    const found: MatchResult[] = [];

    if (regex.global) {
      let currentMatch: RegExpExecArray | null = regex.exec(testText);

      while (currentMatch) {
        found.push({
          value: currentMatch[0],
          index: currentMatch.index,
          captures: currentMatch.slice(1).filter((value): value is string => typeof value === "string"),
        });

        if (currentMatch[0] === "") {
          regex.lastIndex += 1;
        }

        currentMatch = regex.exec(testText);
      }
    } else {
      const firstMatch = regex.exec(testText);
      if (firstMatch) {
        found.push({
          value: firstMatch[0],
          index: firstMatch.index,
          captures: firstMatch.slice(1).filter((value): value is string => typeof value === "string"),
        });
      }
    }

    return found;
  }, [compiled.regex, testText]);

  const replacementPreview = useMemo(() => {
    if (!compiled.regex) {
      return "";
    }

    try {
      const regex = new RegExp(compiled.regex.source, compiled.regex.flags);
      return testText.replace(regex, replacement);
    } catch {
      return "";
    }
  }, [compiled.regex, replacement, testText]);

  const copyReplacement = async () => {
    if (!replacementPreview) {
      setNotice("No replacement output to copy");
      window.setTimeout(() => setNotice(""), 1400);
      return;
    }

    try {
      await navigator.clipboard.writeText(replacementPreview);
      setNotice("Replacement output copied");
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
              <RegexIcon size={22} />
            </span>
            <div>
              <h2 className="toolTitle">Regex Tester</h2>
              <p className="toolSubtitle">Test regex patterns live, inspect captures, and preview replacements.</p>
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          <ToolFullscreenButton
            isFullscreen={isFullscreen}
            onToggle={toggleFullscreen}
            supported={fullscreenSupported}
          />
          <button className="btn btnSecondary" onClick={copyReplacement}>
            <Clipboard size={15} />
            Copy output
          </button>
          <button
            className="btn btnSecondary"
            onClick={() => {
              setTestText(sampleText);
              setNotice("Sample text loaded");
              window.setTimeout(() => setNotice(""), 1400);
            }}
          >
            Load sample
          </button>
          <button
            className="btn btnDanger"
            onClick={() => {
              setPattern("");
              setTestText("");
              setReplacement("");
            }}
          >
            <RotateCcw size={15} />
            Clear
          </button>
        </div>
      </header>

      <div className="toolMetaRow">
        <span className="statusChip">Flags: {flagString || "none"}</span>
        <span className="statusChip">Matches: {matches.length}</span>
        {notice && <span className={styles.notice}>{notice}</span>}
        {compiled.error && <span className={styles.error}>{compiled.error}</span>}
      </div>

      <section className={`${styles.patternCard} panel`}>
        <label className={styles.label}>Pattern</label>
        <input
          className={styles.patternInput}
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
          placeholder="Enter regex pattern"
          spellCheck={false}
        />

        <div className={styles.flagRow}>
          {flagOrder.map((flag) => (
            <label key={flag} className={styles.flagToggle}>
              <input
                type="checkbox"
                checked={flags[flag]}
                onChange={(event) =>
                  setFlags((previous) => ({
                    ...previous,
                    [flag]: event.target.checked,
                  }))
                }
              />
              <span>{flag}</span>
            </label>
          ))}
        </div>
      </section>

      <div className={styles.grid}>
        <section className={`${styles.block} panel`}>
          <h3>Test text</h3>
          <textarea
            className={styles.textarea}
            value={testText}
            onChange={(event) => setTestText(event.target.value)}
            spellCheck={false}
            placeholder="Paste text to test"
          />
        </section>

        <section className={`${styles.block} panel`}>
          <h3>Replacement</h3>
          <input
            className={styles.replacementInput}
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            placeholder="Replacement template"
          />

          <textarea
            className={styles.textarea}
            value={replacementPreview}
            readOnly
            spellCheck={false}
            placeholder="Replacement preview"
          />
        </section>
      </div>

      <section className={`${styles.matchBlock} panel`}>
        <h3>Matches</h3>
        {matches.length === 0 ? (
          <p className={styles.emptyText}>No matches found.</p>
        ) : (
          <div className={styles.matchList}>
            {matches.map((match, index) => (
              <article key={`${match.index}-${index}`} className={styles.matchItem}>
                <p className={styles.matchValue}>{match.value || "(empty match)"}</p>
                <p className={styles.matchMeta}>Index: {match.index}</p>
                {match.captures.length > 0 && (
                  <p className={styles.matchMeta}>Captures: {match.captures.join(" | ")}</p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
