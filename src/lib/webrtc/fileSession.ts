/**
 * The send and receive loops for peer-to-peer file transfer, driven by a PeerMesh.
 *
 * The two hard parts are backpressure and consent. A data channel will happily accept sends far
 * faster than the network drains them, so an unthrottled loop buffers the entire file in memory
 * and can kill the channel; the sender therefore watches `bufferedAmount` and parks until the
 * channel reports it has drained. And because a peer can push bytes at any time, the receiver
 * only ever accepts chunks for a transfer the user explicitly agreed to.
 */

import {
  CHUNK_PAYLOAD_BYTES,
  MAX_TRANSFER_BYTES,
  SEND_HIGH_WATER_MARK,
  chunkCount,
  chunkRange,
  computeFileDigest,
  computeProgress,
  digestChunkDigests,
  encodeChunk,
  type ChunkFrame,
  type TransferProgress,
} from "./fileTransfer";
import { sanitizeFileName } from "./protocol";
import type { FileOffer } from "./protocol";

export type TransferDirection = "outgoing" | "incoming";

export type TransferStatus =
  | "hashing"
  | "offered"
  | "declined"
  | "transferring"
  | "verifying"
  | "complete"
  | "corrupt"
  | "cancelled"
  | "failed";

export type Transfer = {
  readonly key: string;
  readonly transferId: number;
  readonly peerId: string;
  readonly direction: TransferDirection;
  readonly name: string;
  readonly size: number;
  readonly mime: string;
  status: TransferStatus;
  progress: TransferProgress;
  /** Set once an incoming transfer has completed and been verified. */
  blobUrl: string | null;
  error: string | null;
};

/** How often progress is pushed to the UI; 10 Hz is smooth without causing a render storm. */
const PROGRESS_INTERVAL_MS = 100;

export interface TransferTransport {
  sendBulk(peerId: string, frame: ArrayBuffer): boolean;
  bulkBufferedAmount(peerId: string): number;
  isPeerReady(peerId: string): boolean;
}

type OutgoingTransfer = {
  file: File;
  cancelled: boolean;
  /** Resolves the current wait for the channel to drain. */
  resumeDrain: (() => void) | null;
  /** Rejects the current wait, used when the peer goes away mid-transfer. */
  abortDrain: ((reason: Error) => void) | null;
};

type IncomingTransfer = {
  offer: FileOffer;
  chunks: Uint8Array[];
  chunkDigests: ArrayBuffer[];
  bytesReceived: number;
  nextChunkIndex: number;
  cancelled: boolean;
};

export type FileSessionCallbacks = {
  onTransferChanged(transfer: Transfer): void;
  sendOffer(peerId: string, offer: FileOffer): void;
  sendAccept(peerId: string, transferId: number): void;
  sendDecline(peerId: string, transferId: number): void;
  sendCancel(peerId: string, transferId: number): void;
  sendComplete(peerId: string, transferId: number): void;
};

export function transferKey(direction: TransferDirection, peerId: string, transferId: number): string {
  return `${direction}:${peerId}:${transferId}`;
}

export class FileSession {
  private readonly transfers = new Map<string, Transfer>();
  private readonly outgoing = new Map<string, OutgoingTransfer>();
  private readonly incoming = new Map<string, IncomingTransfer>();
  private nextTransferId = 1;
  private closed = false;

  constructor(
    private readonly transport: TransferTransport,
    private readonly callbacks: FileSessionCallbacks,
    private readonly now: () => number = () => Date.now(),
  ) {}

  list(): Transfer[] {
    return [...this.transfers.values()];
  }

  /**
   * Hashes `file`, then offers it to `peerId`. Hashing happens before the offer so the digest can
   * travel with it and the receiver can verify what it got against what was promised.
   */
  async offerFile(peerId: string, file: File): Promise<void> {
    if (file.size > MAX_TRANSFER_BYTES) {
      return;
    }

    const transferId = this.nextTransferId;
    this.nextTransferId += 1;

    const key = transferKey("outgoing", peerId, transferId);
    const transfer = this.createTransfer({
      key,
      transferId,
      peerId,
      direction: "outgoing",
      name: sanitizeFileName(file.name),
      size: file.size,
      mime: file.type || "application/octet-stream",
      status: "hashing",
    });

    this.outgoing.set(key, { file, cancelled: false, resumeDrain: null, abortDrain: null });

    let digest: string;
    try {
      digest = await computeFileDigest(file);
    } catch {
      this.fail(transfer, "Could not read that file");
      return;
    }

    if (this.closed || this.outgoing.get(key)?.cancelled) {
      return;
    }

    transfer.status = "offered";
    this.emit(transfer);

    this.callbacks.sendOffer(peerId, {
      transferId,
      name: transfer.name,
      size: transfer.size,
      mime: transfer.mime,
      digest,
    });
  }

  /** Records an offer from a peer. Nothing is transferred until the user accepts. */
  receiveOffer(peerId: string, offer: FileOffer): void {
    if (offer.size > MAX_TRANSFER_BYTES) {
      this.callbacks.sendDecline(peerId, offer.transferId);
      return;
    }

    const key = transferKey("incoming", peerId, offer.transferId);
    if (this.transfers.has(key)) {
      return;
    }

    this.createTransfer({
      key,
      transferId: offer.transferId,
      peerId,
      direction: "incoming",
      name: offer.name,
      size: offer.size,
      mime: offer.mime,
      status: "offered",
    });

    this.incoming.set(key, {
      offer,
      chunks: [],
      chunkDigests: [],
      bytesReceived: 0,
      nextChunkIndex: 0,
      cancelled: false,
    });
  }

  /** Accepts an incoming offer, which is the only thing that lets its chunks be stored. */
  acceptOffer(peerId: string, transferId: number): void {
    const key = transferKey("incoming", peerId, transferId);
    const transfer = this.transfers.get(key);
    const state = this.incoming.get(key);
    if (!transfer || !state || transfer.status !== "offered") {
      return;
    }

    transfer.status = "transferring";
    transfer.progress = computeProgress(0, transfer.size, 0);
    this.emit(transfer);
    this.callbacks.sendAccept(peerId, transferId);
  }

  declineOffer(peerId: string, transferId: number): void {
    const key = transferKey("incoming", peerId, transferId);
    const transfer = this.transfers.get(key);
    if (!transfer || transfer.status !== "offered") {
      return;
    }

    this.incoming.delete(key);
    transfer.status = "declined";
    this.emit(transfer);
    this.callbacks.sendDecline(peerId, transferId);
  }

  /** The remote side accepted our offer; start pushing chunks. */
  handleAccept(peerId: string, transferId: number): void {
    const key = transferKey("outgoing", peerId, transferId);
    const transfer = this.transfers.get(key);
    const state = this.outgoing.get(key);
    if (!transfer || !state || transfer.status !== "offered") {
      return;
    }

    transfer.status = "transferring";
    this.emit(transfer);
    void this.sendLoop(transfer, state);
  }

  handleDecline(peerId: string, transferId: number): void {
    const key = transferKey("outgoing", peerId, transferId);
    const transfer = this.transfers.get(key);
    if (!transfer) {
      return;
    }

    this.stopOutgoing(key);
    transfer.status = "declined";
    this.emit(transfer);
  }

  /** The remote side verified what it received, so an outgoing transfer is done. */
  handleComplete(peerId: string, transferId: number): void {
    const key = transferKey("outgoing", peerId, transferId);
    const transfer = this.transfers.get(key);
    if (!transfer) {
      return;
    }

    this.stopOutgoing(key);
    transfer.status = "complete";
    transfer.progress = computeProgress(transfer.size, transfer.size, 0);
    this.emit(transfer);
  }

  handleRemoteCancel(peerId: string, transferId: number): void {
    for (const direction of ["outgoing", "incoming"] as const) {
      const key = transferKey(direction, peerId, transferId);
      const transfer = this.transfers.get(key);
      if (!transfer || isFinished(transfer.status)) {
        continue;
      }

      this.stopOutgoing(key);
      this.incoming.delete(key);
      transfer.status = "cancelled";
      this.emit(transfer);
    }
  }

  /** Cancels a transfer from this side and tells the peer. */
  cancel(peerId: string, transferId: number, direction: TransferDirection): void {
    const key = transferKey(direction, peerId, transferId);
    const transfer = this.transfers.get(key);
    if (!transfer || isFinished(transfer.status)) {
      return;
    }

    this.stopOutgoing(key);
    this.incoming.delete(key);
    transfer.status = "cancelled";
    this.emit(transfer);
    this.callbacks.sendCancel(peerId, transferId);
  }

  /**
   * Stores one received chunk.
   *
   * Chunks for a transfer that was never accepted are dropped: that is what stops a peer from
   * pushing bytes at us unasked. An out-of-order index or an overlong payload means the stream is
   * not what was offered, so the transfer is failed rather than patched up.
   */
  async handleChunk(peerId: string, frame: ChunkFrame): Promise<void> {
    const key = transferKey("incoming", peerId, frame.transferId);
    const transfer = this.transfers.get(key);
    const state = this.incoming.get(key);

    if (!transfer || !state || transfer.status !== "transferring") {
      return;
    }

    if (frame.chunkIndex !== state.nextChunkIndex) {
      this.fail(transfer, "Chunks arrived out of order");
      this.incoming.delete(key);
      return;
    }

    if (state.bytesReceived + frame.payload.byteLength > transfer.size) {
      this.fail(transfer, "Peer sent more data than it offered");
      this.incoming.delete(key);
      return;
    }

    // The frame's payload is a view onto the received message buffer; copying it here keeps each
    // stored chunk independent of that buffer and of anything else the channel delivered.
    const chunk = new Uint8Array(frame.payload);
    state.chunks.push(chunk);
    state.bytesReceived += chunk.byteLength;
    state.nextChunkIndex += 1;

    try {
      state.chunkDigests.push(await crypto.subtle.digest("SHA-256", chunk));
    } catch {
      this.fail(transfer, "This browser cannot verify the transfer");
      this.incoming.delete(key);
      return;
    }

    if (state.cancelled) {
      return;
    }

    transfer.progress = computeProgress(state.bytesReceived, transfer.size, 0);
    this.emit(transfer);

    if (state.bytesReceived >= transfer.size) {
      await this.finishIncoming(transfer, state, peerId);
    }
  }

  /** Called when a peer disappears, so its in-flight transfers do not sit pending forever. */
  abortPeer(peerId: string): void {
    for (const transfer of this.transfers.values()) {
      if (transfer.peerId !== peerId || isFinished(transfer.status)) {
        continue;
      }

      this.stopOutgoing(transfer.key);
      this.incoming.delete(transfer.key);
      transfer.status = "failed";
      transfer.error = "The peer disconnected";
      this.emit(transfer);
    }
  }

  /** The channel drained; wake any sender parked on backpressure. */
  handleDrain(peerId: string): void {
    for (const [key, state] of this.outgoing) {
      if (key.includes(`:${peerId}:`) && state.resumeDrain) {
        const resume = state.resumeDrain;
        state.resumeDrain = null;
        state.abortDrain = null;
        resume();
      }
    }
  }

  close(): void {
    this.closed = true;

    for (const key of [...this.outgoing.keys()]) {
      this.stopOutgoing(key);
    }
    this.incoming.clear();

    for (const transfer of this.transfers.values()) {
      if (transfer.blobUrl) {
        URL.revokeObjectURL(transfer.blobUrl);
        transfer.blobUrl = null;
      }
    }

    this.transfers.clear();
  }

  /** Releases a completed download's object URL once the user has saved it. */
  releaseBlob(key: string): void {
    const transfer = this.transfers.get(key);
    if (transfer?.blobUrl) {
      URL.revokeObjectURL(transfer.blobUrl);
      transfer.blobUrl = null;
      this.emit(transfer);
    }
  }

  private async sendLoop(transfer: Transfer, state: OutgoingTransfer): Promise<void> {
    const total = chunkCount(transfer.size);
    const startedAt = this.now();
    let lastEmit = 0;
    let bytesQueued = 0;

    for (let index = 0; index < total; index += 1) {
      if (state.cancelled || this.closed) {
        return;
      }

      // Parking here rather than sending blindly is what keeps the whole file out of the send
      // buffer. A rejection means the peer went away while we were waiting.
      try {
        await this.waitForDrain(transfer.peerId, state);
      } catch (error) {
        this.fail(transfer, error instanceof Error ? error.message : "Transfer stalled");
        return;
      }

      if (state.cancelled || this.closed) {
        return;
      }

      const { start, end } = chunkRange(index, transfer.size);
      let payload: ArrayBuffer;
      try {
        // Slicing keeps memory at one chunk. Reading the whole file up front would defeat the
        // point of chunking for anything large.
        payload = await state.file.slice(start, end).arrayBuffer();
      } catch {
        this.fail(transfer, "Could not read that file");
        return;
      }

      if (state.cancelled || this.closed) {
        return;
      }

      const frame = encodeChunk(transfer.transferId, index, new Uint8Array(payload));
      if (!this.transport.sendBulk(transfer.peerId, frame)) {
        this.fail(transfer, "The connection closed mid-transfer");
        return;
      }

      bytesQueued = end;

      const elapsed = this.now() - startedAt;
      if (elapsed - lastEmit >= PROGRESS_INTERVAL_MS || index === total - 1) {
        lastEmit = elapsed;
        // Progress is what has actually left the buffer, not what has been queued into it.
        const sent = Math.max(0, bytesQueued - this.transport.bulkBufferedAmount(transfer.peerId));
        transfer.progress = computeProgress(sent, transfer.size, elapsed);
        this.emit(transfer);
      }
    }

    transfer.progress = computeProgress(transfer.size, transfer.size, this.now() - startedAt);
    transfer.status = "verifying";
    this.emit(transfer);
  }

  /**
   * Resolves once the channel has room again. Rejecting when the peer goes away matters: without
   * it a transfer whose peer vanished while parked would wait for a drain event that can never
   * arrive, and the UI would show it as in-progress forever.
   */
  private waitForDrain(peerId: string, state: OutgoingTransfer): Promise<void> {
    if (!this.transport.isPeerReady(peerId)) {
      return Promise.reject(new Error("The connection closed mid-transfer"));
    }

    if (this.transport.bulkBufferedAmount(peerId) < SEND_HIGH_WATER_MARK) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      state.resumeDrain = resolve;
      state.abortDrain = reject;
    });
  }

  private async finishIncoming(
    transfer: Transfer,
    state: IncomingTransfer,
    peerId: string,
  ): Promise<void> {
    transfer.status = "verifying";
    this.emit(transfer);

    let digest: string;
    try {
      digest = await digestChunkDigests(state.chunkDigests);
    } catch {
      this.fail(transfer, "Could not verify the transfer");
      this.incoming.delete(transfer.key);
      return;
    }

    this.incoming.delete(transfer.key);

    if (digest !== state.offer.digest) {
      transfer.status = "corrupt";
      transfer.error = "The received file does not match the sender's checksum";
      this.emit(transfer);
      return;
    }

    // Forcing a generic type stops the browser from rendering peer-supplied content inline if the
    // object URL is ever opened directly.
    const blob = new Blob(state.chunks as BlobPart[], { type: "application/octet-stream" });
    transfer.blobUrl = URL.createObjectURL(blob);
    transfer.status = "complete";
    transfer.progress = computeProgress(transfer.size, transfer.size, 0);
    this.emit(transfer);

    this.callbacks.sendComplete(peerId, transfer.transferId);
  }

  private createTransfer(init: Omit<Transfer, "progress" | "blobUrl" | "error">): Transfer {
    const transfer: Transfer = {
      ...init,
      progress: computeProgress(0, init.size, 0),
      blobUrl: null,
      error: null,
    };
    this.transfers.set(init.key, transfer);
    this.emit(transfer);
    return transfer;
  }

  private stopOutgoing(key: string): void {
    const state = this.outgoing.get(key);
    if (!state) {
      return;
    }

    state.cancelled = true;
    // Unpark a sender waiting on backpressure so its loop can observe the cancellation.
    const abort = state.abortDrain;
    state.resumeDrain = null;
    state.abortDrain = null;
    abort?.(new Error("Transfer cancelled"));

    this.outgoing.delete(key);
  }

  private fail(transfer: Transfer, message: string): void {
    this.stopOutgoing(transfer.key);
    transfer.status = "failed";
    transfer.error = message;
    this.emit(transfer);
  }

  private emit(transfer: Transfer): void {
    // A fresh object each time, so React sees a new reference and re-renders the row.
    this.callbacks.onTransferChanged({ ...transfer });
  }
}

function isFinished(status: TransferStatus): boolean {
  return (
    status === "complete" ||
    status === "declined" ||
    status === "cancelled" ||
    status === "failed" ||
    status === "corrupt"
  );
}

export { CHUNK_PAYLOAD_BYTES };
