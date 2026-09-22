import { ImageResponse } from "next/og";
import { siteDescription, siteName } from "@/lib/siteConfig";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "linear-gradient(135deg, #0b1622 0%, #0f766e 100%)",
          color: "#f5fbfa",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 20,
            marginBottom: 28,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 72,
              height: 72,
              borderRadius: 20,
              background: "rgba(255, 255, 255, 0.14)",
              fontSize: 30,
              fontWeight: 700,
            }}
          >
            DD
          </div>
          <div style={{ fontSize: 40, fontWeight: 700 }}>{siteName}</div>
        </div>
        <div style={{ fontSize: 28, lineHeight: 1.4, maxWidth: 920, opacity: 0.9 }}>{siteDescription}</div>
      </div>
    ),
    size,
  );
}
