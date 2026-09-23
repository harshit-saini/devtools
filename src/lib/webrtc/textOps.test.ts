import { describe, expect, it } from "vitest";
import { LogootDocument } from "./logoot";
import {
  anchorCaret,
  describeSelection,
  diffTextChange,
  lineAndColumn,
  resolveCaret,
  resolveSelection,
} from "./textOps";

function docWith(text: string, site = "site-a"): LogootDocument {
  const document = new LogootDocument({ site });
  document.insertAt(0, text);
  return document;
}

/** Applies a diffed change to a plain string, the way the CRDT applies it to the document. */
function applyChange(previous: string, change: ReturnType<typeof diffTextChange>): string {
  if (!change) {
    return previous;
  }
  return previous.slice(0, change.start) + change.inserted + previous.slice(change.end);
}

describe("diffTextChange", () => {
  it("reports no change for identical text", () => {
    expect(diffTextChange("hello", "hello")).toBeNull();
    expect(diffTextChange("", "")).toBeNull();
  });

  it("detects a single typed character", () => {
    expect(diffTextChange("helo", "hello", 4)).toEqual({ start: 3, end: 3, inserted: "l" });
  });

  it("detects a single deleted character", () => {
    expect(diffTextChange("hello", "helo", 3)).toEqual({ start: 3, end: 4, inserted: "" });
  });

  it("detects a paste over a selection as one replaced range", () => {
    expect(diffTextChange("hello world", "hello there", 11)).toEqual({
      start: 6,
      end: 11,
      inserted: "there",
    });
  });

  it("detects insertion at the start and at the end", () => {
    expect(diffTextChange("world", "hello world", 6)).toEqual({
      start: 0,
      end: 0,
      inserted: "hello ",
    });
    expect(diffTextChange("hello", "hello world", 11)).toEqual({
      start: 5,
      end: 5,
      inserted: " world",
    });
  });

  it("detects clearing the whole field", () => {
    expect(diffTextChange("hello", "", 0)).toEqual({ start: 0, end: 5, inserted: "" });
  });

  it("detects typing into an empty field", () => {
    expect(diffTextChange("", "a", 1)).toEqual({ start: 0, end: 0, inserted: "a" });
  });

  it("uses the caret to place a character among repeats", () => {
    // "aa" -> "aaa" is ambiguous from the text alone; the caret says where it was typed.
    expect(diffTextChange("aa", "aaa", 1)).toEqual({ start: 0, end: 0, inserted: "a" });
    expect(diffTextChange("aa", "aaa", 3)).toEqual({ start: 2, end: 2, inserted: "a" });
  });

  it("still produces a correct edit with no caret hint", () => {
    const change = diffTextChange("aa", "aaa");
    expect(applyChange("aa", change)).toBe("aaa");
  });

  it("produces a change that reconstructs the new text, across many edits", () => {
    const cases: [string, string][] = [
      ["", "hello"],
      ["hello", ""],
      ["hello", "hello world"],
      ["hello world", "hello"],
      ["abc", "axc"],
      ["The quick brown fox", "The slow brown fox"],
      ["aaa", "aa"],
      ["line1\nline2", "line1\nline2\nline3"],
      ["tabs\there", "tabs here"],
      ["emoji \u{1F600}", "emoji \u{1F600}\u{1F600}"],
      ["prefix-middle-suffix", "prefix-suffix"],
      ["same", "SAME"],
    ];

    for (const [previous, next] of cases) {
      expect(applyChange(previous, diffTextChange(previous, next, next.length))).toBe(next);
    }
  });

  it("feeds the CRDT an edit that reproduces the textarea's value", () => {
    const document = docWith("The quick brown fox");
    const next = "The quick red fox jumps";
    const change = diffTextChange(document.text(), next, next.length);

    expect(change).not.toBeNull();
    document.replaceRange(change!.start, change!.end, change!.inserted);

    expect(document.text()).toBe(next);
  });
});

describe("caret anchoring", () => {
  it("anchors to the character left of the caret and resolves back to it", () => {
    const document = docWith("hello");
    const anchor = anchorCaret(document, 3);

    expect(resolveCaret(document, anchor)).toBe(3);
  });

  it("anchors the start of the document to nothing", () => {
    const document = docWith("hello");
    expect(anchorCaret(document, 0).leftKey).toBeNull();
    expect(resolveCaret(document, anchorCaret(document, 0))).toBe(0);
  });

  it("clamps an out-of-range offset", () => {
    const document = docWith("hello");
    expect(anchorCaret(document, 99).offset).toBe(5);
    expect(anchorCaret(document, -4).offset).toBe(0);
  });

  it("keeps the caret next to its character when a remote peer edits above it", () => {
    const local = docWith("hello world", "local");
    const remote = new LogootDocument({ site: "remote" });
    remote.applyAll(local.toInsertOps());

    // Caret sits after "hello" in the local document.
    const anchor = anchorCaret(local, 5);

    // The remote peer inserts text before it - every raw offset below shifts by 8.
    local.applyAll(remote.insertAt(0, "PREFIX: "));

    expect(local.text()).toBe("PREFIX: hello world");
    expect(resolveCaret(local, anchor)).toBe(13);
  });

  it("falls back to the offset when the anchor character was deleted remotely", () => {
    const local = docWith("hello world", "local");
    const remote = new LogootDocument({ site: "remote" });
    remote.applyAll(local.toInsertOps());

    const anchor = anchorCaret(local, 5);
    local.applyAll(remote.deleteRange(0, 6));

    expect(local.text()).toBe("world");
    // The character it was anchored to is gone, so the clamped offset is the best available guess.
    expect(resolveCaret(local, anchor)).toBe(5);
  });

  it("clamps the fallback into a document that shrank below the old offset", () => {
    const local = docWith("hello world", "local");
    const remote = new LogootDocument({ site: "remote" });
    remote.applyAll(local.toInsertOps());

    const anchor = anchorCaret(local, 11);
    local.applyAll(remote.deleteRange(0, 9));

    expect(local.text()).toBe("ld");
    expect(resolveCaret(local, anchor)).toBe(2);
  });
});

describe("selection sharing", () => {
  it("round-trips a selection through keys", () => {
    const document = docWith("hello world");
    const cursor = describeSelection(document, 2, 7);

    expect(resolveSelection(document, cursor)).toEqual({ start: 2, end: 7 });
  });

  it("normalizes a backwards selection", () => {
    const document = docWith("hello world");
    const cursor = describeSelection(document, 7, 2);

    expect(resolveSelection(document, cursor)).toEqual({ start: 2, end: 7 });
  });

  it("survives a remote insertion above the selection", () => {
    const local = docWith("hello world", "local");
    const remote = new LogootDocument({ site: "remote" });
    remote.applyAll(local.toInsertOps());

    const cursor = describeSelection(local, 6, 11);
    local.applyAll(remote.insertAt(0, ">> "));

    expect(local.text()).toBe(">> hello world");
    expect(resolveSelection(local, cursor)).toEqual({ start: 9, end: 14 });
  });

  it("represents a collapsed caret as an empty range", () => {
    const document = docWith("hello");
    expect(resolveSelection(document, describeSelection(document, 3, 3))).toEqual({
      start: 3,
      end: 3,
    });
  });
});

describe("lineAndColumn", () => {
  it("reports 1-based line and column", () => {
    expect(lineAndColumn("hello", 0)).toEqual({ line: 1, column: 1 });
    expect(lineAndColumn("hello", 3)).toEqual({ line: 1, column: 4 });
    expect(lineAndColumn("one\ntwo", 4)).toEqual({ line: 2, column: 1 });
    expect(lineAndColumn("one\ntwo", 7)).toEqual({ line: 2, column: 4 });
    expect(lineAndColumn("one\ntwo\nthree", 8)).toEqual({ line: 3, column: 1 });
  });

  it("handles the empty document and out-of-range offsets", () => {
    expect(lineAndColumn("", 0)).toEqual({ line: 1, column: 1 });
    expect(lineAndColumn("abc", 99)).toEqual({ line: 1, column: 4 });
    expect(lineAndColumn("abc", -5)).toEqual({ line: 1, column: 1 });
  });

  it("puts the caret on the new line immediately after a line break", () => {
    expect(lineAndColumn("a\n", 2)).toEqual({ line: 2, column: 1 });
  });
});
