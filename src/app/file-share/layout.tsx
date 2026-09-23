import type { Metadata } from "next";
import { createRouteMetadata } from "@/lib/routeMetadata";

export const metadata: Metadata = createRouteMetadata({
  title: "Peer File Share",
  description:
    "Send files directly between browsers over WebRTC, with progress, end-to-end checksums, and no upload to any server.",
  canonicalPath: "/file-share",
});

export default function FileShareLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
