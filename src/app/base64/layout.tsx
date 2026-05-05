import type { Metadata } from "next";
import { createRouteMetadata } from "@/lib/routeMetadata";

export const metadata: Metadata = createRouteMetadata({
  title: "Base64 Encoder/Decoder",
  description: "Encode and decode Base64 strings in your browser with no server calls.",
  canonicalPath: "/base64",
});

export default function Base64Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
