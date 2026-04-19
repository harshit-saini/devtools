import type { Metadata } from "next";
import { createRouteMetadata } from "@/lib/routeMetadata";

export const metadata: Metadata = createRouteMetadata({
  title: "Notepad",
  description: "Write and autosave quick notes, snippets, and scratch text in your browser.",
  canonicalPath: "/notepad",
});

export default function NotepadLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
