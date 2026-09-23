import type { Metadata } from "next";
import { createRouteMetadata } from "@/lib/routeMetadata";

export const metadata: Metadata = createRouteMetadata({
  title: "Live Notepad",
  description:
    "Edit one shared note with other people in real time, peer-to-peer, with live cursors and no server storing your text.",
  canonicalPath: "/live-notepad",
});

export default function LiveNotepadLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
