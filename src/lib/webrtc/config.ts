/**
 * Connection configuration for the peer-to-peer tools.
 *
 * The values come from NEXT_PUBLIC_ variables, which Next.js inlines into the browser bundle at
 * build time - so they are read here through literal `process.env.NEXT_PUBLIC_*` references rather
 * than any computed lookup, which would not be substituted.
 */

const DEFAULT_SIGNALING_URL = "ws://localhost:8080";

const DEFAULT_STUN_URLS = [
  "stun:stun.l.google.com:19302",
  "stun:stun1.l.google.com:19302",
];

function splitList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * WebSocket URL of the signaling server (the companion `peer-server` project). Defaults to a local
 * server so the tools work out of the box in development.
 */
export function signalingUrl(): string {
  return process.env.NEXT_PUBLIC_PEER_SERVER_URL?.trim() || DEFAULT_SIGNALING_URL;
}

/**
 * ICE servers used to discover a route between peers.
 *
 * STUN alone is enough for most home and office networks, but it cannot get through symmetric NAT
 * or many corporate firewalls: in those cases ICE fails and there is nothing the browser can do
 * without a relay. Set the TURN variables to supply one - the tools surface the difference so a
 * failure is explainable rather than mysterious.
 */
export function iceServers(): RTCIceServer[] {
  const stunUrls = splitList(process.env.NEXT_PUBLIC_STUN_URLS);
  const servers: RTCIceServer[] = [{ urls: stunUrls.length > 0 ? stunUrls : DEFAULT_STUN_URLS }];

  const turnUrls = splitList(process.env.NEXT_PUBLIC_TURN_URLS);
  if (turnUrls.length > 0) {
    servers.push({
      urls: turnUrls,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    });
  }

  return servers;
}

/** True when a relay is configured, which is what determines whether strict NATs can connect. */
export function hasTurnServer(): boolean {
  return splitList(process.env.NEXT_PUBLIC_TURN_URLS).length > 0;
}

/**
 * WebRTC, getUserMedia, and crypto.subtle all require a secure context: HTTPS, or localhost during
 * development. Checking this up front lets the tools explain the problem instead of failing with
 * an opaque "undefined is not a function".
 */
export function isSecureContextAvailable(): boolean {
  return typeof window !== "undefined" && window.isSecureContext;
}

export function isWebRtcSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.RTCPeerConnection === "function" &&
    typeof window.WebSocket === "function"
  );
}

export function isUserMediaSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

export function isDisplayMediaSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getDisplayMedia === "function"
  );
}
