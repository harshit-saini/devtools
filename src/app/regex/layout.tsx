import type { Metadata } from "next";
import { createRouteMetadata } from "@/lib/routeMetadata";

export const metadata: Metadata = createRouteMetadata({
  title: "Regex Tester",
  description: "Test regular expressions live with flags, capture groups, and replacement preview.",
  canonicalPath: "/regex",
});

export default function RegexLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
