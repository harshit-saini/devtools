"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRightLeft,
  Binary,
  Palette,
  Network,
  Link2,
  Fingerprint,
  Clock3,
  Braces,
  Code2,
  FileDiff,
  FileText,
  KeyRound,
  NotebookPen,
  PencilRuler,
  QrCode,
  Regex,
  Search,
  Table2,
  Workflow,
} from "lucide-react";
import styles from "./page.module.css";

type ToolCard = {
  name: string;
  description: string;
  href: string;
  category: "Create" | "Analyze";
  icon: LucideIcon;
  highlights: string[];
};

const tools: ToolCard[] = [
  {
    name: "Notepad",
    description: "Scratchpad with auto-save, quick import, export, and clipboard actions.",
    href: "/notepad",
    category: "Create",
    icon: NotebookPen,
    highlights: ["Auto-save", "Word count"],
  },
  {
    name: "Code Editor",
    description: "Monaco-powered editor with templates, per-language drafts, and export actions.",
    href: "/editor",
    category: "Create",
    icon: Code2,
    highlights: ["Monaco", "Templates"],
  },
  {
    name: "Jupiter Notebook",
    description: "Notebook-like JavaScript cells that run fully in your browser with no server.",
    href: "/jupiter-notebook",
    category: "Create",
    icon: Workflow,
    highlights: ["Cell runner", "Local-only"],
  },
  {
    name: "Drawing Pad",
    description: "Excalidraw whiteboard with local autosave and scene export support.",
    href: "/draw",
    category: "Create",
    icon: PencilRuler,
    highlights: ["Excalidraw", "Scene save"],
  },
  {
    name: "QR Generator",
    description: "Turn URLs into downloadable QR codes for quick sharing and mobile testing.",
    href: "/qr",
    category: "Create",
    icon: QrCode,
    highlights: ["PNG export", "Local-only"],
  },
  {
    name: "Markdown Tool",
    description: "Write markdown with a live preview, split view, and import/export actions.",
    href: "/markdown",
    category: "Create",
    icon: FileText,
    highlights: ["Live preview", "Open .md"],
  },
  {
    name: "Diff Tool",
    description: "Visual side-by-side diff with editor controls and change stats.",
    href: "/diff",
    category: "Analyze",
    icon: FileDiff,
    highlights: ["Monaco diff", "Change stats"],
  },
  {
    name: "CSV Viewer",
    description: "Upload CSV files into an interactive grid with filters and quick search.",
    href: "/csv",
    category: "Analyze",
    icon: Table2,
    highlights: ["ag-Grid", "JSON export"],
  },
  {
    name: "JSON to YML",
    description: "Convert JSON data to YAML format without leaving your browser.",
    href: "/json-yaml",
    category: "Analyze",
    icon: ArrowRightLeft,
    highlights: ["JSON", "YAML"],
  },
  {
    name: "HTTP Header Inspector",
    description: "Parse raw request or response headers into readable key/value rows.",
    href: "/http-headers",
    category: "Analyze",
    icon: Network,
    highlights: ["Headers", "Inspector"],
  },
  {
    name: "Color Theme Picker",
    description: "Pick colors and generate CSS variables to build consistent website themes.",
    href: "/color-tools",
    category: "Create",
    icon: Palette,
    highlights: ["Color picker", "Theme CSS"],
  },
  {
    name: "UUID Generator",
    description: "Generate one or many UUID v4 values instantly with browser crypto.",
    href: "/uuid-generator",
    category: "Analyze",
    icon: Fingerprint,
    highlights: ["UUID v4", "Bulk"],
  },
  {
    name: "Time Converter",
    description: "Convert Unix timestamps and ISO date/time values both ways.",
    href: "/time-converter",
    category: "Analyze",
    icon: Clock3,
    highlights: ["Unix", "ISO"],
  },
  {
    name: "URL Parser / Builder",
    description: "Inspect URL parts and query strings for debugging links and APIs.",
    href: "/url-parser",
    category: "Analyze",
    icon: Link2,
    highlights: ["Query params", "URL parts"],
  },
  {
    name: "Base64 Encoder/Decoder",
    description: "Encode or decode Base64 values locally for tokens, fixtures, and API testing.",
    href: "/base64",
    category: "Analyze",
    icon: Binary,
    highlights: ["Encode", "Decode"],
  },
  {
    name: "JSON Formatter",
    description: "Validate, format, minify, and sort JSON with instant parse feedback.",
    href: "/json",
    category: "Analyze",
    icon: Braces,
    highlights: ["Validation", "Sort keys"],
  },
  {
    name: "Regex Tester",
    description: "Live regex matching with flag toggles, captures, and replacement preview.",
    href: "/regex",
    category: "Analyze",
    icon: Regex,
    highlights: ["Captures", "Replace preview"],
  },
  {
    name: "JWT Decoder",
    description: "Decode JWT header and payload with readable claim timestamps.",
    href: "/jwt",
    category: "Analyze",
    icon: KeyRound,
    highlights: ["Claims", "Date hints"],
  },
];

const categories = ["All", "Create", "Analyze"] as const;
type Category = (typeof categories)[number];

export default function Home() {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<Category>("All");

  const visibleTools = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return tools.filter((tool) => {
      const inCategory = activeCategory === "All" || tool.category === activeCategory;
      const inQuery =
        normalizedQuery.length === 0 ||
        `${tool.name} ${tool.description} ${tool.highlights.join(" ")}`.toLowerCase().includes(normalizedQuery);

      return inCategory && inQuery;
    });
  }, [activeCategory, query]);

  return (
    <div className={styles.container}>
      <header className={`${styles.hero} animate-enter`}>
        <div>
          <p className={styles.eyebrow}>Browser-first developer toolkit</p>
          <h1 className={styles.title}>Ship faster with tools that live one click away.</h1>
          <p className={styles.subtitle}>
            No installs. No account wall. Everything runs locally in your browser and keeps your workflow moving.
          </p>
        </div>

        <label className={styles.searchWrap}>
          <Search size={16} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            placeholder="Search tools"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search tools"
          />
        </label>
      </header>

      <div className={styles.filterRow}>
        {categories.map((category) => (
          <button
            key={category}
            onClick={() => setActiveCategory(category)}
            className={`${styles.filterChip} ${activeCategory === category ? styles.filterChipActive : ""}`}
          >
            {category}
          </button>
        ))}
      </div>

      {visibleTools.length === 0 && (
        <div className={`${styles.emptyState} panel`}>
          <p>No tools matched that search. Try another keyword or category.</p>
        </div>
      )}

      <div className={styles.grid}>
        {visibleTools.map((tool, index) => {
          const Icon = tool.icon;

          return (
            <Link
              key={tool.name}
              href={tool.href}
              className={`${styles.card} animate-enter`}
              style={{ animationDelay: `${index * 0.05}s` }}
            >
              <div className={styles.cardHead}>
                <span className={styles.iconWrap}>
                  <Icon size={22} />
                </span>
                <span className={styles.cardCategory}>{tool.category}</span>
              </div>

              <h3 className={styles.cardTitle}>{tool.name}</h3>
              <p className={styles.cardDescription}>{tool.description}</p>

              <div className={styles.highlights}>
                {tool.highlights.map((highlight) => (
                  <span key={highlight} className={styles.highlightPill}>
                    {highlight}
                  </span>
                ))}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
