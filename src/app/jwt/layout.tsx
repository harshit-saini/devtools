import type { Metadata } from "next";
import { createRouteMetadata } from "@/lib/routeMetadata";

export const metadata: Metadata = createRouteMetadata({
  title: "JWT Decoder",
  description: "Decode JWT header and payload claims locally with readable timestamps.",
  canonicalPath: "/jwt",
});

export default function JwtLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
