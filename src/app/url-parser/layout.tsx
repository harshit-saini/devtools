import type { Metadata } from "next";
import { createRouteMetadata } from "@/lib/routeMetadata";

export const metadata: Metadata = createRouteMetadata({
  title: "URL Parser / Builder",
  description: "Break URLs into parts, edit query parameters live, and rebuild URLs locally.",
  canonicalPath: "/url-parser",
});

export default function UrlParserLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
