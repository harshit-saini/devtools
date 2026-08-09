import type { Metadata } from "next";
import { createRouteMetadata } from "@/lib/routeMetadata";

export const metadata: Metadata = createRouteMetadata({
  title: "Time Converter",
  description: "Convert Unix timestamps and dates, with auto unit detection and relative time.",
  canonicalPath: "/time-converter",
});

export default function TimeConverterLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
