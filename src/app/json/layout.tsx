import type { Metadata } from "next";
import { createRouteMetadata } from "@/lib/routeMetadata";

export const metadata: Metadata = createRouteMetadata({
  title: "JSON Formatter",
  description: "Validate, format, minify, and sort JSON with instant parse feedback.",
  canonicalPath: "/json",
});

export default function JsonLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
