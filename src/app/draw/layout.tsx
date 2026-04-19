import type { Metadata } from "next";
import { createRouteMetadata } from "@/lib/routeMetadata";

export const metadata: Metadata = createRouteMetadata({
  title: "Drawing Pad",
  description: "Sketch flows and architecture diagrams with Excalidraw in a fast browser canvas.",
  canonicalPath: "/draw",
});

export default function DrawLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
