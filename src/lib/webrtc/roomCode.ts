/**
 * Room codes and per-peer identity.
 *
 * A room code has to be short enough to read over a call yet hard enough to guess that a stranger
 * cannot stumble into a private notepad. Three words plus four digits drawn from the lists below
 * gives roughly 24 bits of entropy, which is the same order as a typical meeting link and is
 * combined with the fact that a room only exists while its members are connected.
 */

const ADJECTIVES = [
  "amber", "azure", "brisk", "calm", "clever", "coral", "crisp", "dusky",
  "eager", "fleet", "gentle", "glossy", "hazel", "ivory", "jolly", "keen",
  "lucid", "mellow", "nimble", "olive", "plucky", "quiet", "rapid", "rusty",
  "shy", "sleek", "solar", "swift", "teal", "tidy", "vivid", "witty",
] as const;

const NOUNS = [
  "anchor", "badger", "beacon", "cactus", "canyon", "cedar", "comet", "coral",
  "dolphin", "ember", "falcon", "fern", "harbor", "heron", "island", "jasper",
  "kite", "lantern", "maple", "meadow", "nebula", "otter", "pebble", "quartz",
  "raven", "ridge", "sparrow", "summit", "thicket", "tundra", "walnut", "willow",
] as const;

const ROOM_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

/** Uniform integer in [0, max) drawn from the platform CSPRNG, without modulo bias. */
function randomBelow(max: number): number {
  const limit = Math.floor(0x100000000 / max) * max;
  const buffer = new Uint32Array(1);

  for (;;) {
    crypto.getRandomValues(buffer);
    if (buffer[0] < limit) {
      return buffer[0] % max;
    }
  }
}

function pick<T>(values: readonly T[]): T {
  return values[randomBelow(values.length)];
}

/**
 * A fresh room code, e.g. `swift-otter-meadow-481920`. Two 32-entry word lists plus six digits is
 * about 35 bits - the same order as a typical meeting link, and still short enough to read out.
 * Uses crypto.getRandomValues rather than Math.random because the code is the only thing keeping
 * other people out of the room.
 */
export function generateRoomCode(): string {
  const digits = String(randomBelow(1_000_000)).padStart(6, "0");
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${pick(NOUNS)}-${digits}`;
}

/**
 * Canonicalizes whatever the user typed or pasted: trims, lowercases, turns separators into
 * hyphens, and drops anything else. Returns null when nothing usable is left, so the UI can
 * explain the problem instead of sending a doomed join.
 */
export function normalizeRoomCode(value: string): string | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s_.]+/gu, "-")
    .replace(/[^a-z0-9-]/gu, "")
    .replace(/-{2,}/gu, "-")
    .replace(/^-+|-+$/gu, "");

  return ROOM_CODE_PATTERN.test(normalized) ? normalized : null;
}

/**
 * Room codes travel in the URL *fragment* rather than the query string. The fragment is never
 * sent to a server, so the code stays out of access logs and `Referer` headers - and since it is
 * not part of `searchParams`, reading it needs neither `useSearchParams` nor the `<Suspense>`
 * boundary that hook requires.
 */
export const ROOM_HASH_PREFIX = "#room=";

/** Pulls a room code out of a pasted share link, a bare `#room=` fragment, or a bare code. */
export function extractRoomCode(value: string): string | null {
  const trimmed = value.trim();

  if (/^https?:\/\//iu.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const fromHash = readRoomHash(url.hash);
      if (fromHash) {
        return fromHash;
      }
      // Tolerate a ?room= link, since that is what someone hand-writing one would reach for.
      const fromQuery = url.searchParams.get("room");
      return fromQuery ? normalizeRoomCode(fromQuery) : null;
    } catch {
      return normalizeRoomCode(trimmed);
    }
  }

  return readRoomHash(trimmed) ?? normalizeRoomCode(trimmed);
}

/** Reads a room code out of a `#room=...` fragment, e.g. `window.location.hash`. */
export function readRoomHash(hash: string): string | null {
  const normalized = hash.startsWith("#") ? hash : `#${hash}`;
  if (!normalized.toLowerCase().startsWith(ROOM_HASH_PREFIX)) {
    return null;
  }
  return normalizeRoomCode(decodeURIComponent(normalized.slice(ROOM_HASH_PREFIX.length)));
}

/** Shareable link for a room, with the code in the fragment. */
export function buildShareLink(origin: string, path: string, room: string): string {
  const url = new URL(path, origin.endsWith("/") ? origin : `${origin}/`);
  url.hash = `room=${encodeURIComponent(room)}`;
  return url.toString();
}

/**
 * Presence colors. Fixed, hand-picked, and readable on the light surfaces this app uses - a random
 * hue would regularly produce something illegible against the panel background.
 */
export const PRESENCE_COLORS = [
  "#0f766e",
  "#ea580c",
  "#2563eb",
  "#9333ea",
  "#be123c",
  "#0891b2",
  "#65a30d",
  "#c2410c",
] as const;

/**
 * Deterministically maps a peer id to a color, so every participant sees the same person in the
 * same color without anyone having to agree on it.
 */
export function colorForPeer(peerId: string): string {
  let hash = 0;
  for (let index = 0; index < peerId.length; index += 1) {
    hash = (hash * 31 + peerId.charCodeAt(index)) | 0;
  }
  return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length];
}

/** Up to two initials for an avatar badge. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) {
    return "?";
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

const FALLBACK_NAMES = [
  "Amber Fox", "Azure Crane", "Coral Lynx", "Ember Hawk",
  "Ivory Wren", "Olive Stag", "Teal Heron", "Rust Marten",
] as const;

/** A friendly default so a peer is never listed as an unlabelled UUID. */
export function suggestDisplayName(): string {
  return pick(FALLBACK_NAMES);
}
