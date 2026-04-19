import type { Metadata } from "next";
import { siteName } from "@/lib/siteConfig";

type RouteMetadataInput = {
  title: string;
  description: string;
  canonicalPath: string;
};

export function createRouteMetadata({
  title,
  description,
  canonicalPath,
}: RouteMetadataInput): Metadata {
  const fullTitle = `${title} | ${siteName}`;

  return {
    title,
    description,
    alternates: {
      canonical: canonicalPath,
    },
    openGraph: {
      title: fullTitle,
      description,
      url: canonicalPath,
      type: "website",
    },
    twitter: {
      card: "summary",
      title: fullTitle,
      description,
    },
  };
}
