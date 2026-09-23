import { describe, expect, it } from "vitest";
import {
  CHUNK_PAYLOAD_BYTES,
  CHUNK_SIZE,
  chunkCount,
  chunkRange,
  computeFileDigest,
  computeProgress,
  decodeChunk,
  encodeChunk,
  formatBytes,
  formatDuration,
  formatRate,
} from "./fileTransfer";

function bytes(length: number, seed = 0): Uint8Array {
  const data = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    data[index] = (index * 31 + seed) % 256;
  }
  return data;
}

/** Blob's parameter type does not accept a Uint8Array whose buffer is only ArrayBufferLike. */
function blobOf(...parts: Uint8Array[]): Blob {
  return new Blob(parts as BlobPart[]);
}

describe("chunk framing", () => {
  it("round-trips a transfer id, chunk index, and payload", () => {
    const payload = bytes(1000, 7);
    const frame = decodeChunk(encodeChunk(42, 17, payload));

    expect(frame).not.toBeNull();
    expect(frame?.transferId).toBe(42);
    expect(frame?.chunkIndex).toBe(17);
    expect(frame?.payload).toEqual(payload);
  });

  it("keeps a full chunk inside the size every browser accepts", () => {
    const frame = encodeChunk(1, 0, bytes(CHUNK_PAYLOAD_BYTES));
    expect(frame.byteLength).toBe(CHUNK_SIZE);
  });

  it("round-trips the extreme ids a uint32 header allows", () => {
    const frame = decodeChunk(encodeChunk(0xffffffff, 0xffffffff, bytes(4)));
    expect(frame?.transferId).toBe(0xffffffff);
    expect(frame?.chunkIndex).toBe(0xffffffff);
  });

  it("handles an empty payload", () => {
    const frame = decodeChunk(encodeChunk(3, 0, new Uint8Array(0)));
    expect(frame?.payload.byteLength).toBe(0);
  });

  it("returns null rather than reading past a truncated frame", () => {
    expect(decodeChunk(new ArrayBuffer(0))).toBeNull();
    expect(decodeChunk(new ArrayBuffer(7))).toBeNull();
    expect(decodeChunk(new ArrayBuffer(8))).not.toBeNull();
  });

  it("distinguishes interleaved transfers sharing one channel", () => {
    const first = decodeChunk(encodeChunk(1, 0, bytes(10, 1)));
    const second = decodeChunk(encodeChunk(2, 0, bytes(10, 2)));

    expect(first?.transferId).not.toBe(second?.transferId);
    expect(first?.payload).not.toEqual(second?.payload);
  });
});

describe("chunk maths", () => {
  it("counts chunks, including a short final one", () => {
    expect(chunkCount(0)).toBe(0);
    expect(chunkCount(1)).toBe(1);
    expect(chunkCount(CHUNK_PAYLOAD_BYTES)).toBe(1);
    expect(chunkCount(CHUNK_PAYLOAD_BYTES + 1)).toBe(2);
    expect(chunkCount(CHUNK_PAYLOAD_BYTES * 3)).toBe(3);
  });

  it("produces contiguous ranges that exactly cover the file", () => {
    const size = CHUNK_PAYLOAD_BYTES * 2 + 123;
    const total = chunkCount(size);
    let covered = 0;
    let previousEnd = 0;

    for (let index = 0; index < total; index += 1) {
      const { start, end } = chunkRange(index, size);
      expect(start).toBe(previousEnd);
      expect(end).toBeGreaterThan(start);
      covered += end - start;
      previousEnd = end;
    }

    expect(covered).toBe(size);
    expect(previousEnd).toBe(size);
  });

  it("clamps a range past the end of the file", () => {
    expect(chunkRange(99, 10)).toEqual({ start: 10, end: 10 });
  });
});

describe("integrity digest", () => {
  it("matches when sender and receiver chunk the same bytes", async () => {
    const payload = bytes(CHUNK_PAYLOAD_BYTES * 2 + 500, 3);
    const sent = await computeFileDigest(blobOf(payload));
    const received = await computeFileDigest(blobOf(payload));

    expect(sent).toMatch(/^[0-9a-f]{64}$/);
    expect(received).toBe(sent);
  });

  it("detects a single flipped byte", async () => {
    const original = bytes(CHUNK_PAYLOAD_BYTES + 10, 5);
    const tampered = Uint8Array.from(original);
    tampered[CHUNK_PAYLOAD_BYTES + 3] ^= 0x01;

    const before = await computeFileDigest(blobOf(original));
    const after = await computeFileDigest(blobOf(tampered));

    expect(after).not.toBe(before);
  });

  it("detects reordered chunks, which a per-chunk digest alone would not", async () => {
    const first = bytes(CHUNK_PAYLOAD_BYTES, 1);
    const second = bytes(CHUNK_PAYLOAD_BYTES, 2);

    const inOrder = await computeFileDigest(blobOf(first, second));
    const swapped = await computeFileDigest(blobOf(second, first));

    expect(swapped).not.toBe(inOrder);
  });

  it("detects a truncated transfer", async () => {
    const full = bytes(CHUNK_PAYLOAD_BYTES * 2, 9);
    const short = full.slice(0, CHUNK_PAYLOAD_BYTES);

    expect(await computeFileDigest(blobOf(short))).not.toBe(
      await computeFileDigest(blobOf(full)),
    );
  });

  it("handles an empty file", async () => {
    expect(await computeFileDigest(new Blob([]))).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports hashing progress up to the file size", async () => {
    const payload = bytes(CHUNK_PAYLOAD_BYTES * 2 + 1, 4);
    const seen: number[] = [];
    await computeFileDigest(blobOf(payload), (hashed) => seen.push(hashed));

    expect(seen).toHaveLength(3);
    expect(seen[seen.length - 1]).toBe(payload.byteLength);
  });
});

describe("progress reporting", () => {
  it("reports a ratio, and treats a zero-byte file as complete", () => {
    expect(computeProgress(50, 200, 0).ratio).toBe(0.25);
    expect(computeProgress(0, 0, 0).ratio).toBe(1);
  });

  it("clamps a ratio that would exceed one", () => {
    expect(computeProgress(300, 200, 0).ratio).toBe(1);
  });

  it("withholds a rate until enough time has passed to mean anything", () => {
    expect(computeProgress(1000, 5000, 100).bytesPerSecond).toBeNull();
    expect(computeProgress(0, 5000, 5000).bytesPerSecond).toBeNull();
  });

  it("estimates rate and remaining time", () => {
    const progress = computeProgress(1_000_000, 3_000_000, 1000);

    expect(progress.bytesPerSecond).toBe(1_000_000);
    expect(progress.secondsRemaining).toBe(2);
  });
});

describe("formatting", () => {
  it("formats byte sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1024 * 1024 * 2.5)).toBe("2.5 MB");
    expect(formatBytes(1024 * 1024 * 150)).toBe("150 MB");
    expect(formatBytes(-1)).toBe("-");
    expect(formatBytes(Number.NaN)).toBe("-");
  });

  it("formats rates and durations", () => {
    expect(formatRate(null)).toBe("-");
    expect(formatRate(2048)).toBe("2.0 KB/s");

    expect(formatDuration(null)).toBe("-");
    expect(formatDuration(0.4)).toBe("under a second");
    expect(formatDuration(42)).toBe("42s");
    expect(formatDuration(125)).toBe("2m 5s");
    expect(formatDuration(3700)).toBe("1h 1m");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("-");
  });
});
