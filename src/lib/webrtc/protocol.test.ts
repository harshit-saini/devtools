import { describe, expect, it } from "vitest";
import {
  MAX_CHAT_LENGTH,
  MAX_OPS_PER_MESSAGE,
  MAX_OPS_PER_MESSAGE_LIMIT,
  batchOps,
  encodeControlMessage,
  parseControlMessage,
  parsePosition,
  sanitizeChatText,
  sanitizeFileName,
  sanitizeLine,
} from "./protocol";
import { LogootDocument } from "./logoot";

const OPTIONS = { maxFileBytes: 1024 * 1024 } as const;

/** Built from char codes so the invisible characters never appear literally in this source. */
function chars(...codes: number[]): string {
  return String.fromCharCode(...codes);
}

const NUL = 0x00;
const ZERO_WIDTH_SPACE = 0x200b;
const RIGHT_TO_LEFT_OVERRIDE = 0x202e;

function parse(value: unknown) {
  return parseControlMessage(typeof value === "string" ? value : JSON.stringify(value), OPTIONS);
}

describe("sanitizeLine", () => {
  it("collapses whitespace and trims", () => {
    expect(sanitizeLine("  Ada   Lovelace ", 48)).toBe("Ada Lovelace");
  });

  it("removes characters that can hide or reorder surrounding text", () => {
    expect(sanitizeLine(`Ada${chars(NUL)}Lovelace`, 48)).toBe("Ada Lovelace");
    expect(sanitizeLine(`Ada${chars(RIGHT_TO_LEFT_OVERRIDE)}Lovelace`, 48)).toBe("Ada Lovelace");
    expect(sanitizeLine(`Ada${chars(ZERO_WIDTH_SPACE)}Lovelace`, 48)).toBe("Ada Lovelace");
  });

  it("caps the length and rejects non-strings", () => {
    expect(sanitizeLine("x".repeat(100), 10)).toHaveLength(10);
    expect(sanitizeLine(undefined, 10)).toBe("");
    expect(sanitizeLine(42, 10)).toBe("");
  });
});

describe("sanitizeChatText", () => {
  it("keeps newlines and tabs, which carry meaning in a chat message", () => {
    expect(sanitizeChatText("line one\nline two\tindented")).toBe("line one\nline two\tindented");
    expect(sanitizeChatText("crlf\r\nnormalized")).toBe("crlf\nnormalized");
  });

  it("strips other invisible characters", () => {
    expect(sanitizeChatText(`hi${chars(RIGHT_TO_LEFT_OVERRIDE)}there`)).toBe("hi there");
  });

  it("caps the length", () => {
    expect(sanitizeChatText("x".repeat(MAX_CHAT_LENGTH + 500)).length).toBe(MAX_CHAT_LENGTH);
  });

  it("leaves markup as inert text rather than trying to strip it", () => {
    // React escapes on render, so the safe thing is to preserve the characters verbatim.
    expect(sanitizeChatText("<script>alert(1)</script>")).toBe("<script>alert(1)</script>");
  });
});

describe("sanitizeFileName", () => {
  it("reduces a path to its last segment, defeating traversal", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Windows\\System32\\drivers\\etc\\hosts")).toBe("hosts");
    expect(sanitizeFileName("/absolute/path/report.pdf")).toBe("report.pdf");
  });

  it("replaces characters that are illegal in filenames", () => {
    expect(sanitizeFileName('we"ird:name?.txt')).toBe("we_ird_name_.txt");
  });

  it("strips leading dots so a peer cannot deliver a hidden file", () => {
    expect(sanitizeFileName("...bashrc")).toBe("bashrc");
  });

  it("defuses Windows device names", () => {
    expect(sanitizeFileName("CON")).toBe("file-CON");
    expect(sanitizeFileName("nul.txt")).toBe("file-nul.txt");
    expect(sanitizeFileName("COM1")).toBe("file-COM1");
    expect(sanitizeFileName("console.log")).toBe("console.log");
  });

  it("falls back to a placeholder for empty or non-string names", () => {
    expect(sanitizeFileName("")).toBe("shared-file");
    expect(sanitizeFileName("/")).toBe("shared-file");
    expect(sanitizeFileName(undefined)).toBe("shared-file");
  });
});

describe("batchOps", () => {
  it("splits into batches that fit one data channel message", () => {
    const ops = Array.from({ length: 401 }, (_, index) => index);
    const batches = batchOps(ops);

    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(MAX_OPS_PER_MESSAGE);
    expect(batches[2]).toHaveLength(401 - 2 * MAX_OPS_PER_MESSAGE);
    expect(batches.flat()).toEqual(ops);
  });

  it("returns nothing for an empty list", () => {
    expect(batchOps([])).toEqual([]);
  });

  it("keeps a real document's batches inside the data channel message limit", () => {
    // The reason batching exists: one JSON message per document exceeds Chrome's 262,144-byte
    // maxMessageSize at a few thousand characters.
    const document = new LogootDocument({ site: "a-site-id-of-realistic-length-0001" });
    document.insertAt(0, "x".repeat(5000));

    for (const batch of batchOps(document.toInsertOps())) {
      const encoded = encodeControlMessage({ type: "doc-ops", ops: batch });
      expect(encoded.length).toBeLessThan(262_144);
    }
  });
});

describe("parseControlMessage", () => {
  it("rejects anything that is not a control message", () => {
    expect(parse("not json")).toBeNull();
    expect(parse("[1,2,3]")).toBeNull();
    expect(parse('"a string"')).toBeNull();
    expect(parseControlMessage("", OPTIONS)).toBeNull();
    expect(parseControlMessage(42, OPTIONS)).toBeNull();
    expect(parse({ type: "nonsense" })).toBeNull();
    expect(parse({ noType: true })).toBeNull();
  });

  it("round-trips a hello and sanitizes its fields", () => {
    expect(parse({ type: "hello", name: "  Ada  ", color: "#0F766E" })).toEqual({
      type: "hello",
      name: "Ada",
      color: "#0f766e",
    });
  });

  it("drops a color that is not a plain hex value", () => {
    expect(parse({ type: "hello", name: "Ada", color: "url(evil)" })).toEqual({
      type: "hello",
      name: "Ada",
      color: "",
    });
  });

  it("accepts a chat message and rejects a malformed one", () => {
    expect(parse({ type: "chat", message: { id: "m1", text: "hello", sentAt: 1000 } })).toEqual({
      type: "chat",
      message: { id: "m1", text: "hello", sentAt: 1000 },
    });

    expect(parse({ type: "chat", message: { id: "", text: "hi", sentAt: 1 } })).toBeNull();
    expect(parse({ type: "chat", message: { id: "m1", text: "hi", sentAt: "soon" } })).toBeNull();
    expect(parse({ type: "chat", message: { id: "m1", text: "   ", sentAt: 1 } })).toBeNull();
    expect(parse({ type: "chat", message: "hello" })).toBeNull();
  });

  it("requires every media-state flag to be a boolean", () => {
    expect(parse({ type: "media-state", state: { camera: true, microphone: false, screen: false } })).toEqual({
      type: "media-state",
      state: { camera: true, microphone: false, screen: false },
    });

    expect(parse({ type: "media-state", state: { camera: "yes", microphone: false, screen: false } })).toBeNull();
    expect(parse({ type: "media-state", state: { camera: true } })).toBeNull();
  });

  it("accepts presence with and without a cursor", () => {
    expect(parse({ type: "presence", cursor: null, typing: true })).toEqual({
      type: "presence",
      cursor: null,
      typing: true,
    });

    const cursor = { anchorKey: "k1", headKey: "k2", anchorOffset: 3, headOffset: 7 };
    expect(parse({ type: "presence", cursor, typing: false })).toEqual({
      type: "presence",
      cursor,
      typing: false,
    });

    expect(parse({ type: "presence", cursor, typing: "maybe" })).toBeNull();
    expect(parse({ type: "presence", cursor: { ...cursor, anchorOffset: -1 }, typing: false })).toEqual({
      type: "presence",
      cursor: null,
      typing: false,
    });
  });

  it("accepts a batch of document ops and rejects a malformed one", () => {
    const document = new LogootDocument({ site: "site-a" });
    const ops = document.insertAt(0, "abc");

    const parsed = parse({ type: "doc-ops", ops });
    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe("doc-ops");

    // A replica must reach the same text from the parsed ops.
    const replica = new LogootDocument({ site: "site-b" });
    replica.applyAll(parsed?.type === "doc-ops" ? parsed.ops : []);
    expect(replica.text()).toBe("abc");
  });

  it("rejects document ops that would corrupt the sequence", () => {
    expect(parse({ type: "doc-ops", ops: [{ type: "insert", position: [], char: "a" }] })).toBeNull();
    expect(parse({ type: "doc-ops", ops: [{ type: "insert", position: "nope", char: "a" }] })).toBeNull();
    expect(
      parse({
        type: "doc-ops",
        ops: [{ type: "insert", position: [{ digit: -1, site: "a", clock: 0 }], char: "a" }],
      }),
    ).toBeNull();
    expect(
      parse({
        type: "doc-ops",
        // More than one code point per atom is not something this document can produce.
        ops: [{ type: "insert", position: [{ digit: 1, site: "a", clock: 0 }], char: "abc" }],
      }),
    ).toBeNull();
    expect(parse({ type: "doc-ops", ops: [{ type: "delete", key: "" }] })).toBeNull();
    expect(parse({ type: "doc-ops", ops: [] })).toBeNull();
    expect(parse({ type: "doc-ops", ops: "all of them" })).toBeNull();
  });

  it("rejects an op batch large enough to be an attack rather than a paste", () => {
    const op = { type: "delete", key: "k" };
    const ops = Array.from({ length: MAX_OPS_PER_MESSAGE_LIMIT + 1 }, () => op);
    expect(parse({ type: "doc-ops", ops })).toBeNull();
  });

  it("rejects a position deeper than any real document produces", () => {
    const deep = Array.from({ length: 100 }, () => ({ digit: 1, site: "a", clock: 1 }));
    expect(parsePosition(deep)).toBeNull();
    expect(parsePosition([])).toBeNull();
    expect(parsePosition("nope")).toBeNull();
  });

  it("accepts a well-formed file offer and normalizes its name", () => {
    const offer = {
      transferId: 7,
      name: "../../secret.pdf",
      size: 2048,
      mime: "application/pdf",
      digest: "a".repeat(64),
    };

    expect(parse({ type: "file-offer", offer })).toEqual({
      type: "file-offer",
      offer: {
        transferId: 7,
        name: "secret.pdf",
        size: 2048,
        mime: "application/pdf",
        digest: "a".repeat(64),
      },
    });
  });

  it("rejects a file offer that is oversized or missing a usable digest", () => {
    const base = { transferId: 1, name: "f.bin", size: 10, mime: "", digest: "a".repeat(64) };

    expect(parse({ type: "file-offer", offer: { ...base, size: OPTIONS.maxFileBytes + 1 } })).toBeNull();
    expect(parse({ type: "file-offer", offer: { ...base, size: -1 } })).toBeNull();
    expect(parse({ type: "file-offer", offer: { ...base, digest: "short" } })).toBeNull();
    expect(parse({ type: "file-offer", offer: { ...base, digest: "z".repeat(64) } })).toBeNull();
    expect(parse({ type: "file-offer", offer: { ...base, transferId: "one" } })).toBeNull();
  });

  it("accepts the transfer control messages and requires a numeric id", () => {
    for (const type of ["file-accept", "file-decline", "file-cancel", "file-complete"] as const) {
      expect(parse({ type, transferId: 3 })).toEqual({ type, transferId: 3 });
      expect(parse({ type, transferId: "3" })).toBeNull();
      expect(parse({ type, transferId: 1.5 })).toBeNull();
    }
  });

  it("accepts a doc-request", () => {
    expect(parse({ type: "doc-request" })).toEqual({ type: "doc-request" });
  });
});
