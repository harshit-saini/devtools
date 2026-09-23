import type { Metadata } from "next";
import { createRouteMetadata } from "@/lib/routeMetadata";

export const metadata: Metadata = createRouteMetadata({
  title: "Peer Video Chat",
  description:
    "Browser-to-browser video calls with screen sharing and text chat over WebRTC, with no account and no server holding your media.",
  canonicalPath: "/meet",
});

export default function MeetLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
