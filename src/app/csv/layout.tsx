import type { Metadata } from "next";
import { createRouteMetadata } from "@/lib/routeMetadata";

export const metadata: Metadata = createRouteMetadata({
  title: "CSV Viewer",
  description: "Open CSV files in a sortable, filterable grid and export rows quickly.",
  canonicalPath: "/csv",
});

export default function CsvLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
