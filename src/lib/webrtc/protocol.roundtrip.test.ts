/**
 * Producer -> encode -> parse round trip for every ControlMessage the three tools actually
 * construct, and for every SignalPayload peerMesh actually emits.
 *
 * A validator that rejects a legitimate message is a silent feature break: `handleMessage` /
 * `onmessage` just drop it, with nothing logged and nothing surfaced. These tests therefore build
 * messages the same way the producers do rather than hand-writing plausible-looking JSON.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_OPS_PER_MESSAGE,
  batchOps,
  encodeControlMessage,
  parseControlMessage,
  type ControlMessage,
} from "./protocol";
import {
  MAX_CANDIDATES_PER_BATCH,
  parseSignalPayload,
  type SignalPayload,
} from "./signaling";
import { LogootDocument } from "./logoot";
import { describeSelection } from "./textOps";
import { colorForPeer, normalizeRoomCode } from "./roomCode";

const OPTIONS = { maxFileBytes: 256 * 1024 * 1024 } as const;

/** What the signaling server actually assigns: a v4 UUID. */
const SELF_ID = "6f9619ff-8b86-d011-b42d-00cf4fc964ff";

function roundTrip(message: ControlMessage): ControlMessage | null {
  return parseControlMessage(encodeControlMessage(message), OPTIONS);
}

/** Serializes through JSON the way the wire does, dropping undefined members. */
function overTheWire<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

describe("ControlMessage round trip (producer -> parse)", () => {
  it("hello, as peerSession.hello() builds it", () => {
    const message: ControlMessage = {
      type: "hello",
      name: "Ada Lovelace",
      color: colorForPeer(SELF_ID),
    };
    expect(roundTrip(message)).toEqual(message);
  });

  it("hello before an id is assigned, i.e. with an empty color", () => {
    // peerSession.hello(): color is "" for as long as selfId is null.
    const message: ControlMessage = { type: "hello", name: "Ada", color: "" };
    expect(roundTrip(message)).toEqual(message);
  });

  it("hello with an empty name, which the name field allows", () => {
    const message: ControlMessage = { type: "hello", name: "", color: colorForPeer(SELF_ID) };
    expect(roundTrip(message)).toEqual(message);
  });

  it("hello whose name still has the untrimmed form the input allows", () => {
    // The controller only sanitizes in setDisplayName, so a raw localStorage value reaches the
    // wire once. The receiver re-sanitizes, which is a deliberate one-way normalization.
    expect(roundTrip({ type: "hello", name: "  Ada  ", color: "" })).toEqual({
      type: "hello",
      name: "Ada",
      color: "",
    });
  });

  it("chat, as meet/page.tsx handleSend builds it", () => {
    const message: ControlMessage = {
      type: "chat",
      message: { id: `${SELF_ID}-1`, text: "hello there", sentAt: 1_700_000_000_000 },
    };
    expect(roundTrip(message)).toEqual(message);
  });

  it("chat that keeps its leading indentation and interior blank lines", () => {
    const message: ControlMessage = {
      type: "chat",
      message: { id: `${SELF_ID}-2`, text: "  indented\n\n\tafter a tab", sentAt: 1 },
    };
    expect(roundTrip(message)).toEqual(message);
  });

  it("chat at exactly the length cap", () => {
    const message: ControlMessage = {
      type: "chat",
      message: { id: `${SELF_ID}-3`, text: "x".repeat(2000), sentAt: 1 },
    };
    expect(roundTrip(message)).toEqual(message);
  });

  it("media-state, every combination meet/page.tsx can broadcast", () => {
    for (const camera of [true, false]) {
      for (const microphone of [true, false]) {
        for (const screen of [true, false]) {
          const message: ControlMessage = {
            type: "media-state",
            state: { camera, microphone, screen },
          };
          expect(roundTrip(message)).toEqual(message);
        }
      }
    }
  });

  it("presence, as live-notepad sendPresence builds it for an empty document", () => {
    const document = new LogootDocument({ site: SELF_ID });
    const message: ControlMessage = {
      type: "presence",
      cursor: describeSelection(document, 0, 0),
      typing: true,
    };
    expect(roundTrip(message)).toEqual(message);
  });

  it("presence with a real selection inside a document", () => {
    const document = new LogootDocument({ site: SELF_ID });
    document.insertAt(0, "hello world");
    const message: ControlMessage = {
      type: "presence",
      cursor: describeSelection(document, 2, 7),
      typing: false,
    };
    expect(roundTrip(message)).toEqual(message);
  });

  it("presence with a null cursor, which the ControlMessage type allows", () => {
    const message: ControlMessage = { type: "presence", cursor: null, typing: false };
    expect(roundTrip(message)).toEqual(message);
  });

  it("doc-request", () => {
    expect(roundTrip({ type: "doc-request" })).toEqual({ type: "doc-request" });
  });

  it("doc-ops for a single keystroke", () => {
    const document = new LogootDocument({ site: SELF_ID });
    const message: ControlMessage = { type: "doc-ops", ops: document.insertAt(0, "a") };
    expect(roundTrip(message)).toEqual(message);
  });

  it("doc-ops at exactly the send batch size", () => {
    const document = new LogootDocument({ site: SELF_ID });
    const ops = document.insertAt(0, "x".repeat(MAX_OPS_PER_MESSAGE));
    expect(ops).toHaveLength(MAX_OPS_PER_MESSAGE);
    expect(roundTrip({ type: "doc-ops", ops })).toEqual({ type: "doc-ops", ops });
  });

  it("doc-ops for every batch of a big paste, as broadcastOps sends them", () => {
    const document = new LogootDocument({ site: SELF_ID });
    for (const batch of batchOps(document.insertAt(0, "y".repeat(4000)))) {
      expect(roundTrip({ type: "doc-ops", ops: batch })).toEqual({ type: "doc-ops", ops: batch });
    }
  });

  it("doc-ops for a clear() of a large document", () => {
    const document = new LogootDocument({ site: SELF_ID });
    document.insertAt(0, "z".repeat(2000));
    for (const batch of batchOps(document.clear())) {
      expect(roundTrip({ type: "doc-ops", ops: batch })).toEqual({ type: "doc-ops", ops: batch });
    }
  });

  it("doc-ops for a whole-document resync, as onPeerReady sends them", () => {
    const document = new LogootDocument({ site: SELF_ID });
    document.insertAt(0, "The quick brown fox.\nSecond line.\n");
    for (const batch of batchOps(document.toInsertOps())) {
      expect(roundTrip({ type: "doc-ops", ops: batch })).toEqual({ type: "doc-ops", ops: batch });
    }
  });

  it("doc-ops carrying astral-plane characters", () => {
    const document = new LogootDocument({ site: SELF_ID });
    const message: ControlMessage = { type: "doc-ops", ops: document.insertAt(0, "ab") };
    expect(roundTrip(message)).toEqual(message);
  });

  it("file-offer, as fileSession.offerFile builds it", () => {
    const message: ControlMessage = {
      type: "file-offer",
      offer: {
        transferId: 1,
        name: "quarterly-report.pdf",
        size: 1_234_567,
        mime: "application/pdf",
        digest: "a".repeat(64),
      },
    };
    expect(roundTrip(message)).toEqual(message);
  });

  it("file-offer for a zero-byte file with no detectable type", () => {
    const message: ControlMessage = {
      type: "file-offer",
      offer: {
        transferId: 2,
        name: "shared-file",
        size: 0,
        mime: "application/octet-stream",
        digest: "0".repeat(64),
      },
    };
    expect(roundTrip(message)).toEqual(message);
  });

  it("file-offer at exactly the 256 MB cap", () => {
    const message: ControlMessage = {
      type: "file-offer",
      offer: {
        transferId: 3,
        name: "big.bin",
        size: OPTIONS.maxFileBytes,
        mime: "application/octet-stream",
        digest: "f".repeat(64),
      },
    };
    expect(roundTrip(message)).toEqual(message);
  });

  it("the four transfer control messages", () => {
    for (const type of ["file-accept", "file-decline", "file-cancel", "file-complete"] as const) {
      expect(roundTrip({ type, transferId: 42 })).toEqual({ type, transferId: 42 });
    }
  });
});

describe("SignalPayload round trip (peerMesh -> parseSignalPayload)", () => {
  it("an offer, as negotiate() sends it", () => {
    const payload: SignalPayload = {
      kind: "description",
      description: { type: "offer", sdp: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\ns=-\r\n" },
    };
    expect(parseSignalPayload(overTheWire(payload))).toEqual(payload);
  });

  it("a rollback description, whose sdp is undefined", () => {
    const payload: SignalPayload = {
      kind: "description",
      description: { type: "rollback", sdp: undefined },
    };
    expect(parseSignalPayload(overTheWire(payload))).toEqual(payload);
  });

  it("a candidate batch with falsy sdpMid and sdpMLineIndex, plus the end-of-gathering marker", () => {
    const payload: SignalPayload = {
      kind: "candidates",
      candidates: [
        {
          candidate: "candidate:1 1 udp 2113937151 192.0.2.1 54321 typ host",
          sdpMid: "0",
          sdpMLineIndex: 0,
          usernameFragment: "abcd",
        },
        null,
      ],
    };
    expect(parseSignalPayload(overTheWire(payload))).toEqual(payload);
  });

  it("a full batch at exactly the cap the sender splits on", () => {
    const candidates = Array.from({ length: MAX_CANDIDATES_PER_BATCH }, (_, index) => ({
      candidate: `candidate:${index} 1 udp 2113937151 192.0.2.${index} 54321 typ host`,
      sdpMid: "0",
      sdpMLineIndex: 0,
      usernameFragment: "abcd",
    }));
    expect(parseSignalPayload({ kind: "candidates", candidates })).not.toBeNull();
  });

  it("rejects a batch over the cap, which is why the sender splits on it", () => {
    // The validator's bound is deliberate; peerMesh.flushOutgoingCandidates slices outgoing
    // candidates at exactly MAX_CANDIDATES_PER_BATCH so an oversized batch is never produced. If
    // the two ever drift, every candidate in an oversized flush is discarded and ICE runs out of
    // routes to try.
    const candidates = Array.from({ length: MAX_CANDIDATES_PER_BATCH + 1 }, (_, index) => ({
      candidate: `candidate:${index} 1 udp 2113937151 192.0.2.${index} 54321 typ host`,
      sdpMid: "0",
      sdpMLineIndex: 0,
      usernameFragment: "abcd",
    }));
    expect(parseSignalPayload({ kind: "candidates", candidates })).toBeNull();
  });
});

/**
 * peer-server/src/validation.ts normalizeRoomCode, transcribed verbatim so this repo can assert
 * the two sides agree without importing across repositories.
 */
const SERVER_ROOM_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
function serverNormalizeRoomCode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return SERVER_ROOM_CODE_PATTERN.test(normalized) ? normalized : null;
}

describe("room codes the client sends are codes peer-server accepts", () => {
  const inputs = [
    "swift-otter-meadow-481920",
    "SWIFT-OTTER-MEADOW-481920",
    "  swift-otter-meadow  ",
    "swift otter meadow",
    "swift_otter_meadow",
    "swift.otter.meadow",
    "swift--otter",
    "-swift-otter-",
    "abc",
    "a".repeat(64),
    "a".repeat(65),
    "ab",
    "1",
    "--",
  ];

  it("normalizes to a code the server stores under the same name", () => {
    for (const input of inputs) {
      const client = normalizeRoomCode(input);
      if (client === null) {
        continue;
      }
      // The server must accept it, and must not rename it: a rename would put the two peers in
      // different rooms even though they typed the same code.
      expect(serverNormalizeRoomCode(client), `client sent ${JSON.stringify(client)}`).toBe(client);
    }
  });
});
