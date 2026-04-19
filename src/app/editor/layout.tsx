import type { Metadata } from "next";
import { createRouteMetadata } from "@/lib/routeMetadata";

export const metadata: Metadata = createRouteMetadata({
  title: "Code Editor",
  description: "Edit code with Monaco, language presets, and quick export without leaving your browser.",
  canonicalPath: "/editor",
});

export default function EditorLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
