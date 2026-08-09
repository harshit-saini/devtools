import type { Metadata } from "next";
import { createRouteMetadata } from "@/lib/routeMetadata";

export const metadata: Metadata = createRouteMetadata({
  title: "HTTP Header Inspector",
  description: "Parse, edit, and build HTTP headers locally, with a security-header checklist.",
  canonicalPath: "/http-headers",
});

export default function HttpHeadersLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
