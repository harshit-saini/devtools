import type { Metadata } from "next";
import { createRouteMetadata } from "@/lib/routeMetadata";

export const metadata: Metadata = createRouteMetadata({
  title: "Markdown Tool",
  description: "Write, preview, and import Markdown files with local autosave in your browser.",
  canonicalPath: "/markdown",
});

export default function MarkdownLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
