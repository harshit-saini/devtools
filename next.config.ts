import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // An empty allowlist - camera=() - disables the feature for every origin including this one, so
  // it blocked getUserMedia on the peer-to-peer video tool. `self` grants it to this origin only,
  // which still keeps it away from any embedded frame.
  //
  // This has to stay on the catch-all rule rather than being scoped to the video route:
  // Permissions-Policy binds to the document, and a client-side navigation does not fetch a new
  // one. A route-scoped grant would work on a hard load of /meet and silently fail after
  // navigating there from another tool.
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), display-capture=(self), geolocation=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
