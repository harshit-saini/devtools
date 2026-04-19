import type { Metadata } from "next";
import "@excalidraw/excalidraw/index.css";
import "./globals.css";
import layoutStyles from "./layout.module.css";
import Sidebar from "@/components/Sidebar";
import { siteDescription, siteName, siteRoutes, siteUrl, toAbsoluteUrl } from "@/lib/siteConfig";

const websiteTitle = `${siteName} | Browser-Based Developer Tools`;

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      name: siteName,
      url: siteUrl,
      description: siteDescription,
      inLanguage: "en-US",
      potentialAction: {
        "@type": "SearchAction",
        target: `${siteUrl}/?q={search_term_string}`,
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@type": "ItemList",
      name: "Developer tools",
      itemListElement: siteRoutes.map((route, index) => ({
        "@type": "ListItem",
        position: index + 1,
        item: {
          "@type": "WebPage",
          name: route.name,
          url: toAbsoluteUrl(route.path),
          description: route.description,
        },
      })),
    },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: websiteTitle,
    template: `%s | ${siteName}`,
  },
  description: siteDescription,
  applicationName: siteName,
  referrer: "origin-when-cross-origin",
  keywords: [
    "developer tools",
    "online developer tools",
    "json formatter",
    "regex tester",
    "jwt decoder",
    "csv viewer",
    "code editor",
    "drawpad",
    "qr code generator",
  ],
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  openGraph: {
    type: "website",
    siteName,
    title: websiteTitle,
    description: siteDescription,
    url: "/",
    locale: "en_US",
  },
  twitter: {
    card: "summary",
    title: websiteTitle,
    description: siteDescription,
  },
  category: "technology",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
        <div className={layoutStyles.backgroundAura} aria-hidden="true" />
        <div className={layoutStyles.appContainer}>
          <Sidebar />
          <main className={layoutStyles.mainContent}>{children}</main>
        </div>
      </body>
    </html>
  );
}
