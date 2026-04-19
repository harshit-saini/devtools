export type SiteRoute = {
  path: string;
  name: string;
  description: string;
  changeFrequency: "daily" | "weekly" | "monthly";
  priority: number;
};

export const siteName = "DevTool Deck";
export const siteDescription =
  "Free, install-free developer tools that run in your browser: JSON formatter, regex tester, JWT decoder, drawing pad, QR generator, and more.";

function normalizeSiteUrl(value: string): string {
  const trimmed = value.trim();
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

function resolveSiteUrl(): string {
  const candidate =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    process.env.VERCEL_URL ??
    "http://localhost:3000";

  return normalizeSiteUrl(candidate);
}

export const siteUrl = resolveSiteUrl();

export const siteRoutes: SiteRoute[] = [
  {
    path: "/",
    name: "Developer Tools Dashboard",
    description: "Explore browser-based developer tools without installing anything.",
    changeFrequency: "daily",
    priority: 1,
  },
  {
    path: "/notepad",
    name: "Notepad Tool",
    description: "Auto-saving browser notepad for quick developer notes and snippets.",
    changeFrequency: "weekly",
    priority: 0.82,
  },
  {
    path: "/editor",
    name: "Code Editor Tool",
    description: "Monaco-powered online code editor with language templates and quick export.",
    changeFrequency: "weekly",
    priority: 0.82,
  },
  {
    path: "/draw",
    name: "Drawing Pad Tool",
    description: "Excalidraw whiteboard for architecture sketches, flows, and diagrams.",
    changeFrequency: "weekly",
    priority: 0.78,
  },
  {
    path: "/qr",
    name: "QR Code Generator",
    description: "Generate downloadable PNG QR codes from URLs instantly in your browser.",
    changeFrequency: "weekly",
    priority: 0.8,
  },
  {
    path: "/diff",
    name: "Diff Tool",
    description: "Visual side-by-side text and code difference comparison tool.",
    changeFrequency: "weekly",
    priority: 0.8,
  },
  {
    path: "/csv",
    name: "CSV Viewer",
    description: "Interactive CSV viewer with filtering, quick search, and export options.",
    changeFrequency: "weekly",
    priority: 0.8,
  },
  {
    path: "/json",
    name: "JSON Formatter",
    description: "Validate, prettify, minify, and sort JSON in one place.",
    changeFrequency: "weekly",
    priority: 0.84,
  },
  {
    path: "/regex",
    name: "Regex Tester",
    description: "Test regular expressions with live matches, captures, and replacement preview.",
    changeFrequency: "weekly",
    priority: 0.8,
  },
  {
    path: "/jwt",
    name: "JWT Decoder",
    description: "Decode JWT header and payload claims locally and safely in the browser.",
    changeFrequency: "weekly",
    priority: 0.8,
  },
];

export const toolRoutes = siteRoutes.filter((route) => route.path !== "/");

export function toAbsoluteUrl(path: string): string {
  return new URL(path, siteUrl).toString();
}
