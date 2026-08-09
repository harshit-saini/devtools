import type { Metadata } from "next";
import { createRouteMetadata } from "@/lib/routeMetadata";

export const metadata: Metadata = createRouteMetadata({
  title: "UUID Generator",
  description: "Generate v4 or v7 UUIDs locally with browser crypto, in bulk with custom formatting.",
  canonicalPath: "/uuid-generator",
});

export default function UuidGeneratorLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
