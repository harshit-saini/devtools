/**
 * Turns "the textarea now says X instead of Y" into the smallest edit that explains the change,
 * and keeps carets anchored while remote edits shift the text around them.
 *
 * A <textarea> only reports its new full value, so the shape of the edit has to be recovered. The
 * common prefix/suffix reduction below handles the three things people actually do - type a
 * character, delete a selection, paste over a selection - as a single replaced range, which is
 * exactly what the CRDT wants. It is deliberately not a real diff: a minimal-edit-script diff can
 * "explain" an unrelated change as many scattered edits, which would scatter other peers' text.
 */

export type TextChange = {
  /** Index in the previous text where the replaced range starts. */
  readonly start: number;
  /** Index in the previous text where the replaced range ends (exclusive). */
  readonly end: number;
  /** Text that replaced it. */
  readonly inserted: string;
};

/**
 * Reduces `previous` -> `next` to one replaced range, or null when the texts are identical.
 *
 * `caret` is the caret offset in `next` after the edit. It disambiguates the otherwise ambiguous
 * case where the same character sits on both sides of the edit point: typing "a" in "aa" to get
 * "aaa" could be explained as an insert at index 0, 1, or 2, and only the caret says which. Using
 * it keeps a peer's own insertions adjacent to where they were typed.
 */
export function diffTextChange(previous: string, next: string, caret?: number): TextChange | null {
  if (previous === next) {
    return null;
  }

  const maxPrefix = Math.min(previous.length, next.length);
  let prefix = 0;
  while (prefix < maxPrefix && previous[prefix] === next[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < maxPrefix - prefix &&
    previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const insertedLength = next.length - prefix - suffix;
  const base: TextChange = {
    start: prefix,
    end: previous.length - suffix,
    inserted: next.slice(prefix, prefix + insertedLength),
  };

  // The prefix scan always reports the *rightmost* explanation of the change. When the inserted
  // text repeats characters that already sat to its right, that is the wrong one: typing "a" at
  // the front of "aa" reads as an append. Shifting the range left to where the caret ended up
  // recovers the edit the user actually made.
  if (caret === undefined || insertedLength < 0) {
    return base;
  }

  const shiftedStart = caret - insertedLength;
  const shift = base.start - shiftedStart;
  if (shift <= 0 || shiftedStart < 0 || base.end - shift < shiftedStart) {
    return base;
  }

  const shifted: TextChange = {
    start: shiftedStart,
    end: base.end - shift,
    inserted: next.slice(shiftedStart, shiftedStart + insertedLength),
  };

  // Only take the shifted range if it genuinely reproduces the new text. Checking by
  // reconstruction rather than by a clever character comparison keeps this obviously correct.
  const rebuilt =
    previous.slice(0, shifted.start) + shifted.inserted + previous.slice(shifted.end);

  return rebuilt === next ? shifted : base;
}

export type CaretAnchor = {
  /** Key of the character immediately left of the caret, or null when the caret is at the start. */
  readonly leftKey: string | null;
  /** Fallback offset, used when the anchor character has been deleted by another peer. */
  readonly offset: number;
};

export interface AnchorableDocument {
  readonly length: number;
  keyAt(index: number): string | null;
  indexOfKey(key: string): number | null;
}

/**
 * Records where a caret is in terms of the character it follows, rather than a raw offset. Offsets
 * are meaningless across a remote edit - someone typing above you shifts every offset below.
 */
export function anchorCaret(document: AnchorableDocument, offset: number): CaretAnchor {
  const clamped = Math.max(0, Math.min(offset, document.length));
  return {
    leftKey: clamped > 0 ? document.keyAt(clamped - 1) : null,
    offset: clamped,
  };
}

/** Resolves an anchor back to an offset in the document's current text. */
export function resolveCaret(document: AnchorableDocument, anchor: CaretAnchor): number {
  if (anchor.leftKey === null) {
    return 0;
  }

  const index = document.indexOfKey(anchor.leftKey);
  if (index !== null) {
    return index + 1;
  }

  // The character the caret was anchored to was deleted remotely; fall back to the old offset,
  // clamped into the document that exists now.
  return Math.max(0, Math.min(anchor.offset, document.length));
}

/**
 * Where a peer's caret sits, shared over the data channel. Positions travel as character keys so
 * they survive concurrent edits, exactly like the caret anchor above.
 */
export type PresenceCursor = {
  readonly anchorKey: string | null;
  readonly headKey: string | null;
  /** Offsets are carried too, as the fallback when a key has been deleted. */
  readonly anchorOffset: number;
  readonly headOffset: number;
};

export function describeSelection(
  document: AnchorableDocument,
  anchorOffset: number,
  headOffset: number,
): PresenceCursor {
  const anchor = anchorCaret(document, anchorOffset);
  const head = anchorCaret(document, headOffset);

  return {
    anchorKey: anchor.leftKey,
    headKey: head.leftKey,
    anchorOffset: anchor.offset,
    headOffset: head.offset,
  };
}

export function resolveSelection(
  document: AnchorableDocument,
  cursor: PresenceCursor,
): { start: number; end: number } {
  const anchor = resolveCaret(document, { leftKey: cursor.anchorKey, offset: cursor.anchorOffset });
  const head = resolveCaret(document, { leftKey: cursor.headKey, offset: cursor.headOffset });

  return { start: Math.min(anchor, head), end: Math.max(anchor, head) };
}

/** Line/column of `offset` in `text`, 1-based, for showing where a peer is working. */
export function lineAndColumn(text: string, offset: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const before = text.slice(0, clamped);
  const lastBreak = before.lastIndexOf("\n");

  return {
    line: before.split("\n").length,
    column: clamped - lastBreak,
  };
}
