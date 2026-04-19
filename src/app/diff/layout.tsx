import type { Metadata } from "next";
import { createRouteMetadata } from "@/lib/routeMetadata";

export const metadata: Metadata = createRouteMetadata({
  title: "Diff Tool",
  description: "Compare text and code side-by-side with visual highlights and change stats.",
  canonicalPath: "/diff",
});

export default function DiffLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
