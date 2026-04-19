import type { Metadata } from "next";
import { createRouteMetadata } from "@/lib/routeMetadata";

export const metadata: Metadata = createRouteMetadata({
  title: "QR Code Generator",
  description: "Generate QR codes from URLs and download them as PNG files.",
  canonicalPath: "/qr",
});

export default function QrLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
