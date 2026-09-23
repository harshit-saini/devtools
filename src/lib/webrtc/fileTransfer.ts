/**
 * Chunking, framing, and integrity for peer-to-peer file transfer.
 *
 * The pure parts live here (framing, chunk maths, digest, throughput) so they can be unit tested;
 * the send/receive loops that need a live RTCDataChannel live in fileSession.ts.
 */

/**
 * 16 KB is the message size every browser's SCTP implementation handles without fragmentation
 * problems; Chrome and Firefox tolerate more, Safari historically did not.
 */
export const CHUNK_SIZE = 16 * 1024;
/** Each frame carries an 8-byte header, so the payload is the remainder. */
export const CHUNK_HEADER_BYTES = 8;
export const CHUNK_PAYLOAD_BYTES = CHUNK_SIZE - CHUNK_HEADER_BYTES;

/** Stop feeding the data channel above this much buffered data... */
export const SEND_HIGH_WATER_MARK = 1024 * 1024;
/** ...and resume once `bufferedamountlow` fires at this level. */
export const SEND_LOW_WATER_MARK = 256 * 1024;

/**
 * Received bytes are held in memory until the transfer completes and becomes a Blob, so the
 * accepted size is capped rather than letting a peer exhaust the tab's memory.
 */
export const MAX_TRANSFER_BYTES = 256 * 1024 * 1024;

export type ChunkFrame = {
  readonly transferId: number;
  readonly chunkIndex: number;
  readonly payload: Uint8Array;
};

/**
 * Frames a chunk as `[uint32 transferId][uint32 chunkIndex][payload]`, so that chunks belonging to
 * different concurrent transfers can share one channel and be reassembled unambiguously.
 */
export function encodeChunk(transferId: number, chunkIndex: number, payload: Uint8Array): ArrayBuffer {
  const frame = new ArrayBuffer(CHUNK_HEADER_BYTES + payload.byteLength);
  const view = new DataView(frame);
  view.setUint32(0, transferId, false);
  view.setUint32(4, chunkIndex, false);
  new Uint8Array(frame, CHUNK_HEADER_BYTES).set(payload);
  return frame;
}

/** Returns null for anything too short to be a frame, rather than reading past the buffer. */
export function decodeChunk(buffer: ArrayBuffer): ChunkFrame | null {
  if (buffer.byteLength < CHUNK_HEADER_BYTES) {
    return null;
  }

  const view = new DataView(buffer);
  return {
    transferId: view.getUint32(0, false),
    chunkIndex: view.getUint32(4, false),
    payload: new Uint8Array(buffer, CHUNK_HEADER_BYTES),
  };
}

export function chunkCount(size: number): number {
  return size === 0 ? 0 : Math.ceil(size / CHUNK_PAYLOAD_BYTES);
}

/** Byte range of chunk `index` within a file of `size` bytes. */
export function chunkRange(index: number, size: number): { start: number; end: number } {
  const start = Math.min(index * CHUNK_PAYLOAD_BYTES, size);
  return { start, end: Math.min(start + CHUNK_PAYLOAD_BYTES, size) };
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Digest of a file, computed as SHA-256 over the concatenated SHA-256 digests of its chunks.
 *
 * WebCrypto has no incremental hashing, so digesting a whole multi-gigabyte file would mean
 * holding it in memory. Hashing chunk-by-chunk and then hashing those digests keeps memory at one
 * chunk while still detecting any corrupted, missing, or reordered chunk. Sender and receiver
 * chunk the same way, so the two digests are directly comparable.
 */
export async function digestChunkDigests(chunkDigests: readonly ArrayBuffer[]): Promise<string> {
  const combined = new Uint8Array(chunkDigests.reduce((total, digest) => total + digest.byteLength, 0));
  let offset = 0;
  for (const digest of chunkDigests) {
    combined.set(new Uint8Array(digest), offset);
    offset += digest.byteLength;
  }

  return toHex(await crypto.subtle.digest("SHA-256", combined));
}

/** Streams `file` through the chunk digester without ever holding more than one chunk. */
export async function computeFileDigest(
  file: Blob,
  onProgress?: (bytesHashed: number) => void,
): Promise<string> {
  const digests: ArrayBuffer[] = [];
  const total = chunkCount(file.size);

  for (let index = 0; index < total; index += 1) {
    const { start, end } = chunkRange(index, file.size);
    const slice = await file.slice(start, end).arrayBuffer();
    digests.push(await crypto.subtle.digest("SHA-256", slice));
    onProgress?.(end);
  }

  return digestChunkDigests(digests);
}

export type TransferProgress = {
  readonly bytesTransferred: number;
  readonly totalBytes: number;
  /** 0-1, or 1 for a zero-byte file. */
  readonly ratio: number;
  /** Bytes per second over the whole transfer so far, or null before enough has happened. */
  readonly bytesPerSecond: number | null;
  /** Seconds remaining at the current rate, or null when it cannot be estimated. */
  readonly secondsRemaining: number | null;
};

export function computeProgress(
  bytesTransferred: number,
  totalBytes: number,
  elapsedMs: number,
): TransferProgress {
  const ratio = totalBytes === 0 ? 1 : Math.min(1, bytesTransferred / totalBytes);
  const bytesPerSecond =
    elapsedMs > 250 && bytesTransferred > 0 ? (bytesTransferred / elapsedMs) * 1000 : null;
  const remainingBytes = Math.max(0, totalBytes - bytesTransferred);
  const secondsRemaining =
    bytesPerSecond !== null && bytesPerSecond > 0 ? remainingBytes / bytesPerSecond : null;

  return { bytesTransferred, totalBytes, ratio, bytesPerSecond, secondsRemaining };
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "-";
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 100 || unitIndex === 0 ? 0 : 1)} ${BYTE_UNITS[unitIndex]}`;
}

export function formatRate(bytesPerSecond: number | null): string {
  return bytesPerSecond === null ? "-" : `${formatBytes(bytesPerSecond)}/s`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) {
    return "-";
  }
  if (seconds < 1) {
    return "under a second";
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  if (minutes < 60) {
    return `${minutes}m ${remainder}s`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
