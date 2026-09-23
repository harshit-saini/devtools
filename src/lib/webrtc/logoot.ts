/**
 * A Logoot sequence CRDT over single characters, used by the live notepad.
 *
 * Why a CRDT rather than "send the whole document on every keystroke": two peers editing at once
 * would clobber each other, and the loser's characters would vanish mid-word. Logoot instead gives
 * every character an immutable, densely orderable position identifier, so an insert or delete can
 * be applied in any order on any peer and every peer converges on the same text.
 *
 * Invariants:
 * - Positions are totally ordered, and a new position can always be generated strictly between two
 *   existing ones (that is what the variable-length identifier buys us).
 * - Operations are commutative and idempotent: applying the same op twice, or applying a delete
 *   before the matching insert has arrived, is safe.
 * - The document is bounded by two undeletable sentinels, so there is always a real position on
 *   either side of an insert and no special-casing of the document edges is needed.
 *
 * Known trade-off: deleted positions are remembered forever (within a session) so that a delete
 * arriving before its insert cannot resurrect the character. That set grows with the number of
 * deletions, which is acceptable for a scratch notepad and is reset when the document is reset.
 */

/** Digits live in [0, BASE). 0 is reserved for the low sentinel and for padding segments. */
const BASE = 1 << 15;
/**
 * Sequential typing appends next to the previous character, so keeping the generated digit close
 * to the left neighbour (rather than uniformly random across the whole range) stops identifiers
 * from growing a new segment on every few keystrokes.
 */
const BOUNDARY = 64;

export type PositionSegment = {
  /** Primary sort key. */
  readonly digit: number;
  /** Tie-breaker: the id of the peer that created the segment. */
  readonly site: string;
  /** Tie-breaker of last resort: that peer's operation counter. */
  readonly clock: number;
};

export type Position = readonly PositionSegment[];

export type InsertOp = {
  readonly type: "insert";
  readonly position: Position;
  readonly char: string;
};

export type DeleteOp = {
  readonly type: "delete";
  readonly key: string;
};

export type TextOp = InsertOp | DeleteOp;

export type Atom = {
  readonly position: Position;
  readonly key: string;
  readonly char: string;
};

/** Sorts below every generated position. */
const LOW_SENTINEL: Position = [{ digit: 0, site: "", clock: 0 }];
/** Sorts above every generated position. */
const HIGH_SENTINEL: Position = [{ digit: BASE, site: "", clock: 0 }];
/** Upper bound used within one insert run's own identifier subtree. */
const RUN_CEILING = BASE;

/** Stable, compact string form of a position - used as a map key and as the delete-op payload. */
export function positionKey(position: Position): string {
  let key = "";
  for (const segment of position) {
    key += `${segment.digit}.${segment.site}.${segment.clock}|`;
  }
  return key;
}

export function comparePositions(left: Position, right: Position): number {
  const shared = Math.min(left.length, right.length);

  for (let index = 0; index < shared; index += 1) {
    const a = left[index];
    const b = right[index];

    if (a.digit !== b.digit) {
      return a.digit - b.digit;
    }
    if (a.site !== b.site) {
      return a.site < b.site ? -1 : 1;
    }
    if (a.clock !== b.clock) {
      return a.clock - b.clock;
    }
  }

  // A position that extends another as a prefix sorts after it.
  return left.length - right.length;
}

function segmentsEqual(a: PositionSegment | undefined, b: PositionSegment | undefined): boolean {
  if (!a || !b) {
    return false;
  }
  return a.digit === b.digit && a.site === b.site && a.clock === b.clock;
}

export type RandomSource = () => number;

/**
 * Returns a position strictly between `lower` and `upper`, which must satisfy `lower < upper`.
 *
 * At each depth there is either room for a new digit between the two bounds - in which case we are
 * done - or there is not, and the algorithm adopts the lower bound's segment verbatim and descends
 * one level. Adopting the lower bound's segment makes the result a strict extension of it (longer
 * positions sort after their prefixes), and `upperBinding` tracks whether the upper bound still
 * shares that prefix and therefore still constrains the digits below.
 */
export function generatePositionBetween(
  lower: Position,
  upper: Position,
  site: string,
  clock: number,
  random: RandomSource = Math.random,
): Position {
  const result: PositionSegment[] = [];
  let depth = 0;
  let upperBinding: boolean = true;

  // Bounded by the combined length of both bounds: every iteration either returns or descends,
  // and once both bounds are exhausted the full digit range is available.
  for (;;) {
    const lowerSegment: PositionSegment | undefined = lower[depth];
    const upperSegment: PositionSegment | undefined = upperBinding ? upper[depth] : undefined;

    // A missing lower segment floors at -1 so that digit 0 (the padding digit) stays available,
    // while a missing upper segment leaves the whole range open.
    const lowerDigit = lowerSegment ? lowerSegment.digit : -1;
    const upperDigit = upperSegment ? upperSegment.digit : BASE;

    if (upperDigit - lowerDigit > 1) {
      result.push({ digit: pickDigit(lowerDigit, upperDigit, random), site, clock });
      return result;
    }

    // No gap at this depth: keep the lower bound's segment (or the minimum padding segment when
    // the lower bound has already run out) and look for room one level deeper.
    const adopted: PositionSegment = lowerSegment ?? { digit: 0, site: "", clock: 0 };
    result.push(adopted);
    upperBinding = upperBinding && segmentsEqual(upperSegment, adopted);
    depth += 1;
  }
}

function pickDigit(lowerDigit: number, upperDigit: number, random: RandomSource): number {
  const span = Math.min(BOUNDARY, upperDigit - lowerDigit - 1);
  const offset = Math.floor(random() * span);
  // Math.random() can return a value whose scaled floor lands on `span` for pathological inputs.
  return lowerDigit + 1 + Math.min(offset, span - 1);
}

export type LogootDocumentOptions = {
  /** This peer's id; becomes the `site` of every position it creates. */
  site: string;
  random?: RandomSource;
};


/**
 * The replicated document. Visible characters are kept in a single position-sorted array, which
 * makes rendering a plain join and makes index/position translation a binary search.
 */
export class LogootDocument {
  private readonly site: string;
  private readonly random: RandomSource;
  private atoms: Atom[] = [];
  /** Positions known to be deleted, so a late-arriving insert cannot resurrect a character. */
  private readonly tombstones = new Set<string>();
  /** Live characters by key, so a delete op (which carries only a key) can still binary search. */
  private readonly present = new Map<string, Position>();
  private clock = 0;
  private cachedText: string | null = "";

  constructor({ site, random = Math.random }: LogootDocumentOptions) {
    this.site = site;
    this.random = random;
  }

  get length(): number {
    return this.atoms.length;
  }

  text(): string {
    if (this.cachedText === null) {
      this.cachedText = this.atoms.map((atom) => atom.char).join("");
    }
    return this.cachedText;
  }

  /** The key of the character at `index`, or null when the index is out of range. */
  keyAt(index: number): string | null {
    return this.atoms[index]?.key ?? null;
  }

  /**
   * The index of the character with `key`, or null if it is gone. Used to keep a caret anchored to
   * the character it sat next to while remote edits shift everything around it.
   */
  indexOfKey(key: string): number | null {
    const position = this.present.get(key);
    if (!position) {
      return null;
    }

    const index = this.lowerBoundIndex(position);
    return this.atoms[index]?.key === key ? index : null;
  }

  /**
   * Produces the ops for replacing `[start, end)` with `insertText`, applies them locally, and
   * returns them for broadcast. Returning rather than emitting keeps this class transport-agnostic
   * and therefore unit-testable.
   */
  replaceRange(start: number, end: number, insertText: string): TextOp[] {
    const ops: TextOp[] = [];

    for (let index = start; index < end; index += 1) {
      const atom = this.atoms[index];
      if (atom) {
        ops.push({ type: "delete", key: atom.key });
      }
    }

    // Deleting first means the inserted characters are positioned against the neighbours that will
    // actually surround them.
    for (const op of ops) {
      this.applyLocalDelete(op as DeleteOp);
    }

    const characters = Array.from(insertText);

    if (characters.length > 0) {
      const firstPosition = this.nextPosition(
        this.positionBefore(start),
        this.positionAfter(start),
      );
      ops.push(this.insertCharacter(firstPosition, characters[0]));

      // Only the first character of a run is positioned against the surrounding text. The rest are
      // positioned *inside* it, as extensions of that first identifier, which is what keeps a
      // pasted or typed run contiguous: every extension of `firstPosition` sorts after it and
      // before anything else that sorted after it, so a concurrent run from another peer lands
      // wholly before or wholly after this one instead of interleaving character by character.
      const runUpperBound: Position = [...firstPosition, { digit: RUN_CEILING, site: "", clock: 0 }];
      let previous = firstPosition;

      for (let index = 1; index < characters.length; index += 1) {
        previous = this.nextPosition(previous, runUpperBound);
        ops.push(this.insertCharacter(previous, characters[index]));
      }
    }

    return ops;
  }

  private nextPosition(lower: Position, upper: Position): Position {
    this.clock += 1;
    return generatePositionBetween(lower, upper, this.site, this.clock, this.random);
  }

  private insertCharacter(position: Position, char: string): InsertOp {
    const insert: InsertOp = { type: "insert", position, char };
    this.apply(insert);
    return insert;
  }

  /** Convenience wrapper for the common single-range edit. */
  insertAt(index: number, text: string): TextOp[] {
    return this.replaceRange(index, index, text);
  }

  deleteRange(start: number, end: number): TextOp[] {
    return this.replaceRange(start, end, "");
  }

  /** Applies a local or remote op. Safe to call with the same op more than once. */
  apply(op: TextOp): boolean {
    if (op.type === "delete") {
      return this.applyLocalDelete(op);
    }

    const key = positionKey(op.position);
    if (this.tombstones.has(key) || this.present.has(key)) {
      return false;
    }

    const atom: Atom = { position: op.position, key, char: op.char };
    this.atoms.splice(this.lowerBoundIndex(op.position), 0, atom);
    this.present.set(key, op.position);
    this.cachedText = null;
    return true;
  }

  applyAll(ops: readonly TextOp[]): boolean {
    let changed = false;
    for (const op of ops) {
      changed = this.apply(op) || changed;
    }
    return changed;
  }

  /**
   * The whole document expressed as insert operations, for bringing a peer that just joined up to
   * date.
   *
   * Deliberately *not* a distinct snapshot message: because inserts are idempotent and
   * order-independent, the current state is just a list of ops, and sending it as ops means the
   * receiver needs no snapshot handshake, no "snapshot in flight" buffering, and no special case
   * for ops that overtake it. It also lets the caller split a large document across several
   * messages, which a single snapshot payload could not do - one JSON message per document would
   * exceed the data channel's maximum message size at a few thousand characters.
   */
  toInsertOps(): InsertOp[] {
    return this.atoms.map((atom) => ({
      type: "insert",
      position: atom.position,
      char: atom.char,
    }));
  }

  /** Clears the document, returning the delete ops that bring peers in line. */
  clear(): TextOp[] {
    return this.deleteRange(0, this.atoms.length);
  }

  private applyLocalDelete(op: DeleteOp): boolean {
    this.tombstones.add(op.key);

    const position = this.present.get(op.key);
    if (!position) {
      return false;
    }

    this.present.delete(op.key);

    const index = this.lowerBoundIndex(position);
    if (this.atoms[index]?.key !== op.key) {
      return false;
    }

    this.atoms.splice(index, 1);
    this.cachedText = null;
    return true;
  }

  /** First index whose position is >= `position`. */
  private lowerBoundIndex(position: Position): number {
    let low = 0;
    let high = this.atoms.length;

    while (low < high) {
      const mid = (low + high) >>> 1;
      if (comparePositions(this.atoms[mid].position, position) < 0) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }

    return low;
  }

  private positionBefore(index: number): Position {
    return index > 0 ? this.atoms[index - 1].position : LOW_SENTINEL;
  }

  private positionAfter(index: number): Position {
    return index < this.atoms.length ? this.atoms[index].position : HIGH_SENTINEL;
  }
}

export const sentinels = { low: LOW_SENTINEL, high: HIGH_SENTINEL };
