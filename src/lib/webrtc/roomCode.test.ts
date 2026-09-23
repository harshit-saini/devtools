import { describe, expect, it } from "vitest";
import {
  PRESENCE_COLORS,
  buildShareLink,
  colorForPeer,
  extractRoomCode,
  generateRoomCode,
  initialsOf,
  normalizeRoomCode,
  readRoomHash,
  suggestDisplayName,
} from "./roomCode";

/** The same pattern the signaling server enforces; a generated code must always satisfy it. */
const SERVER_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

describe("generateRoomCode", () => {
  it("produces codes the server will accept", () => {
    for (let index = 0; index < 200; index += 1) {
      const code = generateRoomCode();
      expect(code).toMatch(SERVER_PATTERN);
      expect(normalizeRoomCode(code)).toBe(code);
    }
  });

  it("produces readable word-and-digit codes", () => {
    expect(generateRoomCode()).toMatch(/^[a-z]+-[a-z]+-[a-z]+-\d{6}$/);
  });

  it("does not repeat itself in a small sample", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateRoomCode()));
    expect(codes.size).toBeGreaterThan(190);
  });
});

describe("normalizeRoomCode", () => {
  it("canonicalizes what a person might type or paste", () => {
    expect(normalizeRoomCode("  Swift-Otter-Meadow-481920 ")).toBe("swift-otter-meadow-481920");
    expect(normalizeRoomCode("swift otter meadow 481920")).toBe("swift-otter-meadow-481920");
    expect(normalizeRoomCode("swift_otter.meadow")).toBe("swift-otter-meadow");
    expect(normalizeRoomCode("swift--otter")).toBe("swift-otter");
    expect(normalizeRoomCode("-swift-otter-")).toBe("swift-otter");
    expect(normalizeRoomCode("SWIFT/OTTER")).toBe("swiftotter");
  });

  it("rejects anything the server would reject", () => {
    expect(normalizeRoomCode("ab")).toBeNull();
    expect(normalizeRoomCode("")).toBeNull();
    expect(normalizeRoomCode("   ")).toBeNull();
    expect(normalizeRoomCode("!!!")).toBeNull();
    expect(normalizeRoomCode("a".repeat(65))).toBeNull();
  });

  it("agrees with the server's pattern on everything it accepts", () => {
    const inputs = ["Room One", "abc", "a-b-c", "ROOM-42", "x".repeat(64), "  padded  "];
    for (const input of inputs) {
      const normalized = normalizeRoomCode(input);
      if (normalized !== null) {
        expect(normalized).toMatch(SERVER_PATTERN);
      }
    }
  });
});

describe("share links", () => {
  it("puts the code in the fragment, so it never reaches a server", () => {
    const link = buildShareLink("https://tools.example.com", "/meet", "swift-otter-481920");

    expect(link).toBe("https://tools.example.com/meet#room=swift-otter-481920");
    expect(new URL(link).search).toBe("");
  });

  it("handles an origin with a trailing slash", () => {
    expect(buildShareLink("https://tools.example.com/", "/files", "abc-123")).toBe(
      "https://tools.example.com/files#room=abc-123",
    );
  });

  it("round-trips through readRoomHash", () => {
    const code = "swift-otter-meadow-481920";
    const link = buildShareLink("https://tools.example.com", "/meet", code);

    expect(readRoomHash(new URL(link).hash)).toBe(code);
    expect(extractRoomCode(link)).toBe(code);
  });
});

describe("readRoomHash", () => {
  it("reads a room fragment with or without the leading hash", () => {
    expect(readRoomHash("#room=swift-otter")).toBe("swift-otter");
    expect(readRoomHash("room=swift-otter")).toBe("swift-otter");
    expect(readRoomHash("#ROOM=Swift-Otter")).toBe("swift-otter");
  });

  it("ignores unrelated or empty fragments", () => {
    expect(readRoomHash("")).toBeNull();
    expect(readRoomHash("#")).toBeNull();
    expect(readRoomHash("#section-two")).toBeNull();
    expect(readRoomHash("#room=")).toBeNull();
    expect(readRoomHash("#room=ab")).toBeNull();
  });
});

describe("extractRoomCode", () => {
  it("accepts a bare code", () => {
    expect(extractRoomCode("swift-otter-481920")).toBe("swift-otter-481920");
    expect(extractRoomCode("  Swift Otter 481920 ")).toBe("swift-otter-481920");
  });

  it("tolerates a hand-written ?room= link", () => {
    expect(extractRoomCode("https://tools.example.com/meet?room=swift-otter")).toBe("swift-otter");
  });

  it("prefers the fragment when a link has both", () => {
    expect(extractRoomCode("https://x.example/meet?room=from-query#room=from-fragment")).toBe(
      "from-fragment",
    );
  });

  it("returns null for a link with no room in it", () => {
    expect(extractRoomCode("https://tools.example.com/meet")).toBeNull();
    expect(extractRoomCode("https://tools.example.com/meet#other=1")).toBeNull();
  });
});

describe("peer identity helpers", () => {
  it("assigns every peer the same color on every machine", () => {
    const peerId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

    expect(colorForPeer(peerId)).toBe(colorForPeer(peerId));
    expect(PRESENCE_COLORS).toContain(colorForPeer(peerId));
  });

  it("spreads colors across the palette", () => {
    const used = new Set(
      Array.from({ length: 200 }, (_, index) => colorForPeer(`peer-${index}-abcdef`)),
    );
    expect(used.size).toBeGreaterThan(1);
  });

  it("never returns an empty color, even for an empty id", () => {
    expect(PRESENCE_COLORS).toContain(colorForPeer(""));
  });

  it("derives up to two initials", () => {
    expect(initialsOf("Ada Lovelace")).toBe("AL");
    expect(initialsOf("Ada")).toBe("AD");
    expect(initialsOf("a")).toBe("A");
    expect(initialsOf("Ada Byron King Lovelace")).toBe("AL");
    expect(initialsOf("   ")).toBe("?");
    expect(initialsOf("")).toBe("?");
  });

  it("suggests a usable display name", () => {
    const name = suggestDisplayName();
    expect(name.length).toBeGreaterThan(0);
    expect(name.length).toBeLessThanOrEqual(48);
  });
});

describe("readRoomHash resilience", () => {
  it("does not throw on a malformed percent escape", () => {
    // The fragment comes straight from the address bar and is read during render, so a URIError
    // here would take down the whole tool rather than just the room code.
    expect(() => readRoomHash("#room=%zz")).not.toThrow();
    expect(readRoomHash("#room=%zz")).toBeNull();
    expect(() => readRoomHash("#room=%")).not.toThrow();
    expect(() => readRoomHash("#room=%E0%A4%A")).not.toThrow();
    expect(() => extractRoomCode("https://x.example/meet#room=%zz")).not.toThrow();
  });

  it("still reads a usable code that happens to contain an escape", () => {
    expect(readRoomHash("#room=swift%2Dotter%2D481920")).toBe("swift-otter-481920");
  });

  it("rejects a code it cannot decode rather than salvaging a different one", () => {
    // Stripping the stray "%" would yield a valid-looking code that is not the one the link
    // named, so the reader would silently join the wrong room.
    expect(readRoomHash("#room=abc%")).toBeNull();
    expect(readRoomHash("#room=swift-otter-481920%zz")).toBeNull();
    expect(extractRoomCode("https://x.example/meet#room=abc%")).toBeNull();
  });
});
