/**
 * Messages the tools exchange over the peer-to-peer data channels, and the guards that validate
 * them.
 *
 * Everything here arrives from another browser, not from a server we control, so nothing is
 * trusted: every field is shape-checked and bounded before it reaches application state. A peer
 * that sends a malformed CRDT position, a 10 MB display name, or a chat payload with a script tag
 * in it should be ignored, not crash the tool.
 */

import type { Position, PositionSegment, TextOp } from "./logoot";
import type { PresenceCursor } from "./textOps";

/** Reliable, ordered channel for control traffic: chat, presence, notepad ops, file offers. */
export const CONTROL_CHANNEL_ID = 0;
/** Reliable, ordered channel for file bytes, kept separate so a transfer cannot stall chat. */
export const BULK_CHANNEL_ID = 1;
export const CONTROL_CHANNEL_LABEL = "devtools-control";
export const BULK_CHANNEL_LABEL = "devtools-bulk";

export const MAX_CHAT_LENGTH = 2000;
export const MAX_NAME_LENGTH = 48;
export const MAX_POSITION_DEPTH = 64;
export const MAX_FILE_NAME_LENGTH = 180;

/**
 * Maximum ops in one `doc-ops` message.
 *
 * A data channel has a maximum message size (262,144 bytes in Chrome) and one serialized op runs
 * to roughly 90 bytes, because a position segment embeds the sending peer's id. 150 ops is
 * comfortably inside that with room to spare for deeper positions, so a large paste - or a whole
 * document being sent to a peer that just joined - is split across messages rather than thrown by
 * `send()`. Splitting is safe because ops are commutative and idempotent.
 */
export const MAX_OPS_PER_MESSAGE = 150;

/** Rejects a peer message that would expand into an implausible amount of local state. */
export const MAX_OPS_PER_MESSAGE_LIMIT = 512;

/** Splits an op list into messages that each fit inside the data channel's size limit. */
export function batchOps<T>(ops: readonly T[], batchSize = MAX_OPS_PER_MESSAGE): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < ops.length; index += batchSize) {
    batches.push(ops.slice(index, index + batchSize));
  }
  return batches;
}

export type ChatMessage = {
  readonly id: string;
  readonly text: string;
  readonly sentAt: number;
};

export type MediaState = {
  readonly camera: boolean;
  readonly microphone: boolean;
  readonly screen: boolean;
};

export type FileOffer = {
  readonly transferId: number;
  readonly name: string;
  readonly size: number;
  readonly mime: string;
  /** Chunk-tree digest of the payload; see fileTransfer.ts. */
  readonly digest: string;
};

export type ControlMessage =
  | { type: "hello"; name: string; color: string }
  | { type: "chat"; message: ChatMessage }
  | { type: "media-state"; state: MediaState }
  | { type: "presence"; cursor: PresenceCursor | null; typing: boolean }
  /** Asks a peer to send the current document as `doc-ops` insert batches. */
  | { type: "doc-request" }
  | { type: "doc-ops"; ops: readonly TextOp[] }
  | { type: "file-offer"; offer: FileOffer }
  | { type: "file-accept"; transferId: number }
  | { type: "file-decline"; transferId: number }
  | { type: "file-cancel"; transferId: number }
  | { type: "file-complete"; transferId: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSafeIndex(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

/**
 * Strips control, zero-width, and bidi characters, collapses runs of whitespace, and truncates.
 * Applied to every string a peer supplies that ends up rendered next to our own UI text, because
 * those characters can hide or visually reorder what sits around them.
 */
export function sanitizeLine(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
}

/**
 * Chat keeps its line breaks - they are meaningful - but still loses the invisible characters and
 * is length-capped. React escapes the result on render, so no markup can be injected.
 */
export function sanitizeChatText(value: unknown, maxLength = MAX_CHAT_LENGTH): string {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/\r\n?/gu, "\n")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (char) => (char === "\n" || char === "\t" ? char : " "))
    .slice(0, maxLength)
    .trimEnd();
}

/** Names that address a device rather than a file on Windows, even with an extension appended. */
const WINDOWS_RESERVED_NAMES =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

/**
 * Reduces a peer-supplied filename to a bare, safe name. Directory separators, traversal
 * segments, Windows-reserved characters, and Windows device names are all removed, so the value
 * can only ever be used as a download filename and never as a path.
 */
export function sanitizeFileName(value: unknown): string {
  const raw = typeof value === "string" ? value : "";
  // Taking the last path segment is what defeats traversal: "../../etc/passwd" becomes "passwd".
  const base = raw.split(/[\\/]/u).pop() ?? "";
  const cleaned = base
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .replace(/[<>:"|?*]/gu, "_")
    .replace(/^\.+/u, "")
    .trim()
    .slice(0, MAX_FILE_NAME_LENGTH);

  if (cleaned.length === 0) {
    return "shared-file";
  }

  return WINDOWS_RESERVED_NAMES.test(cleaned) ? `file-${cleaned}` : cleaned;
}

/** A CSS color a peer proposed for its own presence marker; anything unexpected is dropped. */
function sanitizeColor(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return /^#[0-9a-f]{6}$/iu.test(value.trim()) ? value.trim().toLowerCase() : null;
}

function parsePositionSegment(value: unknown): PositionSegment | null {
  if (!isRecord(value)) {
    return null;
  }

  const { digit, site, clock } = value;
  if (!isFiniteNumber(digit) || !Number.isInteger(digit) || digit < 0) {
    return null;
  }
  if (typeof site !== "string" || site.length > 64) {
    return null;
  }
  if (!isSafeIndex(clock)) {
    return null;
  }

  return { digit, site, clock };
}

/** Positions drive array ordering and map keys, so a malformed one is rejected outright. */
export function parsePosition(value: unknown): Position | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_POSITION_DEPTH) {
    return null;
  }

  const segments: PositionSegment[] = [];
  for (const entry of value) {
    const segment = parsePositionSegment(entry);
    if (!segment) {
      return null;
    }
    segments.push(segment);
  }

  return segments;
}

function parseTextOp(value: unknown): TextOp | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.type === "delete") {
    return typeof value.key === "string" && value.key.length > 0 && value.key.length <= 4096
      ? { type: "delete", key: value.key }
      : null;
  }

  if (value.type === "insert") {
    const position = parsePosition(value.position);
    // One code point per atom; anything longer is not something this document produced.
    if (!position || typeof value.char !== "string" || Array.from(value.char).length !== 1) {
      return null;
    }
    return { type: "insert", position, char: value.char };
  }

  return null;
}

function parseCursor(value: unknown): PresenceCursor | null {
  if (!isRecord(value)) {
    return null;
  }

  const { anchorKey, headKey, anchorOffset, headOffset } = value;
  const keyOk = (key: unknown) => key === null || (typeof key === "string" && key.length <= 4096);

  if (!keyOk(anchorKey) || !keyOk(headKey) || !isSafeIndex(anchorOffset) || !isSafeIndex(headOffset)) {
    return null;
  }

  return {
    anchorKey: (anchorKey as string | null) ?? null,
    headKey: (headKey as string | null) ?? null,
    anchorOffset,
    headOffset,
  };
}

function parseMediaState(value: unknown): MediaState | null {
  if (!isRecord(value)) {
    return null;
  }

  const { camera, microphone, screen } = value;
  if (typeof camera !== "boolean" || typeof microphone !== "boolean" || typeof screen !== "boolean") {
    return null;
  }

  return { camera, microphone, screen };
}

function parseFileOffer(value: unknown, maxFileBytes: number): FileOffer | null {
  if (!isRecord(value)) {
    return null;
  }

  const { transferId, size, mime, digest } = value;
  if (!isSafeIndex(transferId) || !isSafeIndex(size) || size > maxFileBytes) {
    return null;
  }
  if (typeof digest !== "string" || !/^[0-9a-f]{64}$/iu.test(digest)) {
    return null;
  }

  return {
    transferId,
    name: sanitizeFileName(value.name),
    size,
    mime: sanitizeLine(mime, 128),
    digest: digest.toLowerCase(),
  };
}

export type ParseControlOptions = {
  /** Rejects offers larger than this outright, before any UI prompt. */
  maxFileBytes: number;
};

/**
 * Parses one control-channel payload. Returns null for anything that does not match a known
 * message exactly - callers simply ignore those rather than trying to repair them.
 */
export function parseControlMessage(raw: unknown, options: ParseControlOptions): ControlMessage | null {
  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  switch (value.type) {
    case "hello": {
      const name = sanitizeLine(value.name, MAX_NAME_LENGTH);
      return { type: "hello", name, color: sanitizeColor(value.color) ?? "" };
    }

    case "chat": {
      if (!isRecord(value.message)) {
        return null;
      }
      const { id, sentAt } = value.message;
      const text = sanitizeChatText(value.message.text);
      if (typeof id !== "string" || id.length === 0 || id.length > 64 || !isFiniteNumber(sentAt)) {
        return null;
      }
      return text.length > 0 ? { type: "chat", message: { id, text, sentAt } } : null;
    }

    case "media-state": {
      const state = parseMediaState(value.state);
      return state ? { type: "media-state", state } : null;
    }

    case "presence": {
      if (typeof value.typing !== "boolean") {
        return null;
      }
      return {
        type: "presence",
        cursor: value.cursor === null ? null : parseCursor(value.cursor),
        typing: value.typing,
      };
    }

    case "doc-request":
      return { type: "doc-request" };

    case "doc-ops": {
      if (!Array.isArray(value.ops) || value.ops.length > MAX_OPS_PER_MESSAGE_LIMIT) {
        return null;
      }

      const ops: TextOp[] = [];
      for (const entry of value.ops) {
        const op = parseTextOp(entry);
        if (!op) {
          return null;
        }
        ops.push(op);
      }

      return ops.length > 0 ? { type: "doc-ops", ops } : null;
    }

    case "file-offer": {
      const offer = parseFileOffer(value.offer, options.maxFileBytes);
      return offer ? { type: "file-offer", offer } : null;
    }

    case "file-accept":
    case "file-decline":
    case "file-cancel":
    case "file-complete": {
      return isSafeIndex(value.transferId)
        ? { type: value.type, transferId: value.transferId }
        : null;
    }

    default:
      return null;
  }
}

export function encodeControlMessage(message: ControlMessage): string {
  return JSON.stringify(message);
}
