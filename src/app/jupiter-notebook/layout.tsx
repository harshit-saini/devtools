import type { Metadata } from "next";
import { createRouteMetadata } from "@/lib/routeMetadata";

export const metadata: Metadata = createRouteMetadata({
  title: "Jupiter Notebook",
  description: "Notebook-style JavaScript cells that execute fully in-browser with no server.",
  canonicalPath: "/jupiter-notebook",
});

export default function JupiterNotebookLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
