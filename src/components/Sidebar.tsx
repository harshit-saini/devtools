"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Palette,
  Network,
  Link2,
  Fingerprint,
  Clock3,
  ArrowRightLeft,
  Binary,
  Braces,
  ChevronLeft,
  ChevronRight,
  Code2,
  FileDiff,
  FileText,
  House,
  KeyRound,
  NotebookPen,
  PencilRuler,
  QrCode,
  Regex,
  Search,
  Table2,
  Wrench,
  Workflow,
} from "lucide-react";
import styles from "./Sidebar.module.css";

type NavItem = {
  name: string;
  href: string;
  group: string;
  icon: LucideIcon;
};

const navItems: NavItem[] = [
  { name: "Dashboard", href: "/", group: "Explore", icon: House },

  { name: "Notepad", href: "/notepad", group: "Create", icon: NotebookPen },
  { name: "Code Editor", href: "/editor", group: "Create", icon: Code2 },
  { name: "Drawing Pad", href: "/draw", group: "Create", icon: PencilRuler },
  { name: "Jupiter Notebook", href: "/jupiter-notebook", group: "Create", icon: Workflow },
  { name: "QR Generator", href: "/qr", group: "Create", icon: QrCode },
  { name: "Markdown Tool", href: "/markdown", group: "Create", icon: FileText },
  { name: "Color Theme Picker", href: "/color-tools", group: "Create", icon: Palette },


  { name: "Diff Tool", href: "/diff", group: "Analyze", icon: FileDiff },
  { name: "CSV Viewer", href: "/csv", group: "Analyze", icon: Table2 },
  { name: "Base64 Encoder/Decoder", href: "/base64", group: "Analyze", icon: Binary },
  { name: "JSON to YML", href: "/json-yaml", group: "Analyze", icon: ArrowRightLeft },
  { name: "HTTP Header Inspector", href: "/http-headers", group: "Analyze", icon: Network },
  { name: "UUID Generator", href: "/uuid-generator", group: "Analyze", icon: Fingerprint },
  { name: "Time Converter", href: "/time-converter", group: "Analyze", icon: Clock3 },
  { name: "URL Parser / Builder", href: "/url-parser", group: "Analyze", icon: Link2 },

  { name: "JSON Formatter", href: "/json", group: "Analyze", icon: Braces },
  { name: "Regex Tester", href: "/regex", group: "Analyze", icon: Regex },
  { name: "JWT Decoder", href: "/jwt", group: "Analyze", icon: KeyRound },
];

const SIDEBAR_KEY = "devtools.sidebar.collapsed";

export default function Sidebar() {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const storedValue = window.localStorage.getItem(SIDEBAR_KEY);
    if (storedValue === null) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setIsCollapsed(storedValue === "true");
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, []);

  const groupedItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = normalizedQuery
      ? navItems.filter((item) => {
          const haystack = `${item.name} ${item.group}`.toLowerCase();
          return haystack.includes(normalizedQuery);
        })
      : navItems;

    return filtered.reduce<Map<string, NavItem[]>>((acc, item) => {
      const current = acc.get(item.group) ?? [];
      current.push(item);
      acc.set(item.group, current);
      return acc;
    }, new Map());
  }, [query]);

  const toggleSidebar = () => {
    const nextState = !isCollapsed;
    setIsCollapsed(nextState);
    window.localStorage.setItem(SIDEBAR_KEY, String(nextState));
  };

  return (
    <aside className={`${styles.sidebar} ${isCollapsed ? styles.collapsed : ""}`}>
      <div className={styles.brandRow}>
        <div className={styles.logoBadge}>
          <Wrench size={20} />
        </div>
        {!isCollapsed && (
          <div>
            <h1 className={styles.brandTitle}>DevTool Deck</h1>
            <p className={styles.brandSubtitle}>Everyday tools for shipping faster</p>
          </div>
        )}
      </div>

      {!isCollapsed && (
        <label className={styles.searchWrap}>
          <Search size={16} className={styles.searchIcon} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={styles.searchInput}
            placeholder="Find a tool"
            aria-label="Search tools"
          />
          <span className="kbd">/</span>
        </label>
      )}

      <nav className={styles.nav}>
        {Array.from(groupedItems.entries()).map(([group, items]) => (
          <section key={group} className={styles.groupBlock}>
            {!isCollapsed && <p className={styles.groupLabel}>{group}</p>}
            {items.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${styles.navItem} ${isActive ? styles.active : ""}`}
                  title={isCollapsed ? item.name : undefined}
                >
                  <Icon size={18} className={styles.navIcon} />
                  {!isCollapsed && <span className={styles.navText}>{item.name}</span>}
                </Link>
              );
            })}
          </section>
        ))}

        {groupedItems.size === 0 && !isCollapsed && (
          <div className={styles.emptyState}>No tools match your search.</div>
        )}
      </nav>

      {!isCollapsed && (
        <div className={styles.footer}>
          <p>Saved locally. Runs in your browser.</p>
        </div>
      )}

      <button
        className={styles.collapseToggle}
        onClick={toggleSidebar}
        title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>
    </aside>
  );
}
