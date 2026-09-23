import { describe, expect, it } from "vitest";
import {
  LogootDocument,
  comparePositions,
  generatePositionBetween,
  positionKey,
  sentinels,
  type Position,
  type TextOp,
} from "./logoot";

/** Deterministic stand-in for Math.random so generated positions are reproducible in tests. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function doc(site: string, seed = 1): LogootDocument {
  return new LogootDocument({ site, random: seededRandom(seed) });
}

describe("comparePositions", () => {
  it("orders by digit first", () => {
    const a: Position = [{ digit: 1, site: "z", clock: 9 }];
    const b: Position = [{ digit: 2, site: "a", clock: 0 }];
    expect(comparePositions(a, b)).toBeLessThan(0);
  });

  it("breaks digit ties by site then clock", () => {
    const a: Position = [{ digit: 5, site: "a", clock: 2 }];
    const b: Position = [{ digit: 5, site: "b", clock: 1 }];
    const c: Position = [{ digit: 5, site: "a", clock: 3 }];

    expect(comparePositions(a, b)).toBeLessThan(0);
    expect(comparePositions(a, c)).toBeLessThan(0);
    expect(comparePositions(a, a)).toBe(0);
  });

  it("sorts a prefix before the positions that extend it", () => {
    const prefix: Position = [{ digit: 5, site: "a", clock: 1 }];
    const extension: Position = [
      { digit: 5, site: "a", clock: 1 },
      { digit: 1, site: "b", clock: 1 },
    ];
    expect(comparePositions(prefix, extension)).toBeLessThan(0);
  });

  it("puts the sentinels on the outside", () => {
    const middle = generatePositionBetween(sentinels.low, sentinels.high, "a", 1, seededRandom(3));
    expect(comparePositions(sentinels.low, middle)).toBeLessThan(0);
    expect(comparePositions(middle, sentinels.high)).toBeLessThan(0);
  });
});

describe("generatePositionBetween", () => {
  it("always lands strictly between the bounds, including when it must grow a segment", () => {
    const random = seededRandom(7);
    let lower = sentinels.low;
    const upper = sentinels.high;

    // Repeatedly inserting immediately after the previous position is the sequential-typing case.
    for (let index = 0; index < 500; index += 1) {
      const next = generatePositionBetween(lower, upper, "site", index, random);
      expect(comparePositions(lower, next)).toBeLessThan(0);
      expect(comparePositions(next, upper)).toBeLessThan(0);
      lower = next;
    }
  });

  it("finds room between two adjacent positions by descending a level", () => {
    const random = seededRandom(11);
    let lower: Position = [{ digit: 10, site: "a", clock: 1 }];
    const upper: Position = [{ digit: 11, site: "a", clock: 2 }];

    // No digit exists between 10 and 11, so every one of these must extend the identifier.
    for (let index = 0; index < 200; index += 1) {
      const next = generatePositionBetween(lower, upper, "b", index, random);
      expect(comparePositions(lower, next)).toBeLessThan(0);
      expect(comparePositions(next, upper)).toBeLessThan(0);
      lower = next;
    }
  });

  it("finds room between a position and its own extension", () => {
    const lower: Position = [{ digit: 5, site: "a", clock: 1 }];
    const upper: Position = [
      { digit: 5, site: "a", clock: 1 },
      { digit: 1, site: "a", clock: 2 },
    ];

    const next = generatePositionBetween(lower, upper, "b", 1, seededRandom(5));
    expect(comparePositions(lower, next)).toBeLessThan(0);
    expect(comparePositions(next, upper)).toBeLessThan(0);
  });

  it("keeps identifiers short for sequential typing", () => {
    const random = seededRandom(13);
    const document = new LogootDocument({ site: "a", random });
    for (let index = 0; index < 400; index += 1) {
      document.insertAt(document.length, "x");
    }

    expect(document.text()).toBe("x".repeat(400));
  });
});

describe("positionKey", () => {
  it("is stable and distinguishes positions that differ only in a tie-breaker", () => {
    const a: Position = [{ digit: 5, site: "a", clock: 1 }];
    const b: Position = [{ digit: 5, site: "a", clock: 2 }];

    expect(positionKey(a)).toBe(positionKey([{ digit: 5, site: "a", clock: 1 }]));
    expect(positionKey(a)).not.toBe(positionKey(b));
  });
});

describe("LogootDocument local editing", () => {
  it("inserts, appends, and reads back text", () => {
    const document = doc("a");
    document.insertAt(0, "world");
    document.insertAt(0, "hello ");

    expect(document.text()).toBe("hello world");
    expect(document.length).toBe(11);
  });

  it("deletes a range", () => {
    const document = doc("a");
    document.insertAt(0, "hello world");
    document.deleteRange(5, 11);

    expect(document.text()).toBe("hello");
  });

  it("replaces a range in one edit", () => {
    const document = doc("a");
    document.insertAt(0, "hello world");
    document.replaceRange(6, 11, "there");

    expect(document.text()).toBe("hello there");
  });

  it("clears to empty and reports the deletes", () => {
    const document = doc("a");
    document.insertAt(0, "abc");
    const ops = document.clear();

    expect(document.text()).toBe("");
    expect(ops).toHaveLength(3);
    expect(ops.every((op) => op.type === "delete")).toBe(true);
  });

  it("handles multi-byte characters as whole code points", () => {
    const document = doc("a");
    document.insertAt(0, "a\u{1F600}b");

    // The emoji is one code point but two UTF-16 units, so the document holds 3 entries and the
    // reassembled text round-trips.
    expect(document.length).toBe(3);
    expect(document.text()).toBe("a\u{1F600}b");
  });
});

/** Applies each document's ops to the other, as the data channel would. */
function exchange(left: LogootDocument, leftOps: TextOp[], right: LogootDocument, rightOps: TextOp[]): void {
  right.applyAll(leftOps);
  left.applyAll(rightOps);
}

describe("LogootDocument convergence", () => {
  it("converges when two peers type single characters at the same position", () => {
    const a = doc("aaa", 1);
    const b = doc("bbb", 2);

    const seed = a.insertAt(0, "hello");
    b.applyAll(seed);
    expect(b.text()).toBe("hello");

    const aOps = a.insertAt(5, "A");
    const bOps = b.insertAt(5, "B");
    exchange(a, aOps, b, bOps);

    expect(a.text()).toBe(b.text());
    // Neither peer's character was lost.
    expect(a.text()).toMatch(/^hello(?:AB|BA)$/);
  });

  it("keeps concurrent multi-character runs contiguous instead of interleaving them", () => {
    // Two peers pasting at the same offset is the case naive Logoot mangles into
    // "frforomm  BA": each character is placed independently against the same neighbours, so the
    // two runs shuffle together. Runs must land whole, in one order or the other.
    for (const [seedA, seedB] of [
      [1, 2],
      [21, 22],
      [31, 32],
      [41, 42],
    ]) {
      const a = doc("aaa", seedA);
      const b = doc("bbb", seedB);
      b.applyAll(a.insertAt(0, "hello"));

      const aOps = a.insertAt(5, " from A");
      const bOps = b.insertAt(5, " from B");
      exchange(a, aOps, b, bOps);

      expect(a.text()).toBe(b.text());
      expect(a.text()).toMatch(/^hello(?: from A from B| from B from A)$/);
    }
  });

  it("keeps a run contiguous even when it is longer than one identifier level", () => {
    const a = doc("aaa", 51);
    const b = doc("bbb", 52);
    b.applyAll(a.insertAt(0, "|"));

    const paste = "x".repeat(300);
    const aOps = a.insertAt(1, paste);
    const bOps = b.insertAt(1, "B");
    exchange(a, aOps, b, bOps);

    expect(a.text()).toBe(b.text());
    expect(a.text()).toMatch(new RegExp(`^\\|(?:${paste}B|B${paste})$`));
  });

  it("converges when one peer deletes what another is editing", () => {
    const a = doc("aaa", 3);
    const b = doc("bbb", 4);

    b.applyAll(a.insertAt(0, "shared text"));

    const aOps = a.deleteRange(0, 6);
    const bOps = b.insertAt(3, "XYZ");
    exchange(a, aOps, b, bOps);

    expect(a.text()).toBe(b.text());
    expect(a.text()).toContain("XYZ");
  });

  it("converges when both peers delete overlapping ranges", () => {
    const a = doc("aaa", 5);
    const b = doc("bbb", 6);

    b.applyAll(a.insertAt(0, "abcdefghij"));

    const aOps = a.deleteRange(2, 6);
    const bOps = b.deleteRange(4, 8);
    exchange(a, aOps, b, bOps);

    expect(a.text()).toBe(b.text());
    expect(a.text()).toBe("abij");
  });

  it("converges across three peers regardless of delivery order", () => {
    const a = doc("aaa", 7);
    const b = doc("bbb", 8);
    const c = doc("ccc", 9);

    const seed = a.insertAt(0, "base");
    b.applyAll(seed);
    c.applyAll(seed);

    const aOps = a.insertAt(4, "-A");
    const bOps = b.insertAt(0, "B-");
    const cOps = c.replaceRange(1, 3, "**");

    // Every peer receives the other two peers' ops in a different order.
    a.applyAll(bOps);
    a.applyAll(cOps);
    b.applyAll(cOps);
    b.applyAll(aOps);
    c.applyAll(aOps);
    c.applyAll(bOps);

    expect(a.text()).toBe(b.text());
    expect(b.text()).toBe(c.text());
  });

  it("is idempotent when an op is delivered twice", () => {
    const a = doc("aaa", 10);
    const b = doc("bbb", 11);

    const ops = a.insertAt(0, "abc");
    b.applyAll(ops);
    b.applyAll(ops);

    expect(b.text()).toBe("abc");

    const deletes = a.deleteRange(1, 2);
    b.applyAll(deletes);
    b.applyAll(deletes);

    expect(b.text()).toBe("ac");
    expect(b.text()).toBe(a.text());
  });

  it("does not resurrect a character when a delete arrives before its insert", () => {
    const a = doc("aaa", 12);
    const b = doc("bbb", 13);

    const inserts = a.insertAt(0, "xyz");
    const deletes = a.deleteRange(1, 2);

    // Out-of-order delivery: the delete lands first.
    b.applyAll(deletes);
    b.applyAll(inserts);

    expect(b.text()).toBe("xz");
    expect(b.text()).toBe(a.text());
  });
});

describe("LogootDocument catch-up for late joiners", () => {
  it("brings a late joiner up to date", () => {
    const host = doc("host", 14);
    host.insertAt(0, "existing document");

    const joiner = doc("join", 15);
    joiner.applyAll(host.toInsertOps());

    expect(joiner.text()).toBe("existing document");

    // Editing after adopting the snapshot still converges.
    const joinerOps = joiner.insertAt(9, "shared ");
    host.applyAll(joinerOps);
    expect(host.text()).toBe(joiner.text());
    expect(host.text()).toBe("existing shared document");
  });

  it("converges when live edits overtake the catch-up ops", () => {
    const host = doc("host", 16);
    host.insertAt(0, "abc");

    const catchUp = host.toInsertOps();
    // The host keeps editing while the catch-up is still in flight, and that edit arrives first.
    const inFlight = host.insertAt(3, "def");

    const joiner = doc("join", 17);
    joiner.applyAll(inFlight);
    joiner.applyAll(catchUp);

    expect(joiner.text()).toBe("abcdef");
    expect(joiner.text()).toBe(host.text());
  });

  it("keeps a locally known deletion deleted when stale catch-up ops arrive", () => {
    const host = doc("host", 18);
    host.insertAt(0, "abc");
    const staleCatchUp = host.toInsertOps();
    const deletes = host.deleteRange(1, 2);

    const joiner = doc("join", 19);
    joiner.applyAll(deletes);
    joiner.applyAll(staleCatchUp);

    expect(joiner.text()).toBe("ac");
    expect(joiner.text()).toBe(host.text());
  });

  it("can be delivered in arbitrarily split batches, in any order", () => {
    // Catch-up is sent as several messages because one message per document would exceed the data
    // channel's maximum message size. Splitting must be safe in any order.
    const host = doc("host", 21);
    host.insertAt(0, "the quick brown fox jumps over the lazy dog");

    const ops = host.toInsertOps();
    const batches = [ops.slice(30), ops.slice(0, 10), ops.slice(20, 30), ops.slice(10, 20)];

    const joiner = doc("join", 22);
    for (const batch of batches) {
      joiner.applyAll(batch);
    }

    expect(joiner.text()).toBe(host.text());
  });

  it("reports positions for caret anchoring", () => {
    const document = doc("a", 20);
    document.insertAt(0, "abc");

    const key = document.keyAt(1);
    expect(key).not.toBeNull();
    expect(document.indexOfKey(key as string)).toBe(1);

    document.deleteRange(1, 2);
    expect(document.indexOfKey(key as string)).toBeNull();
    expect(document.indexOfKey("not-a-key")).toBeNull();
    expect(document.keyAt(99)).toBeNull();
  });
});
