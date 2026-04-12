import type { Metadata } from "next";
import "@excalidraw/excalidraw/index.css";
import "./globals.css";
import layoutStyles from "./layout.module.css";
import Sidebar from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "DevTool Deck",
  description: "Install-free, browser-first tools for everyday developer workflows.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <div className={layoutStyles.backgroundAura} aria-hidden="true" />
        <div className={layoutStyles.appContainer}>
          <Sidebar />
          <main className={layoutStyles.mainContent}>{children}</main>
        </div>
      </body>
    </html>
  );
}
