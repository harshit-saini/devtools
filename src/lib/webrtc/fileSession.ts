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
import type { ControlMessage, FileOffer } from "./protocol";

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

/**
 * How many undecided offers one peer may have outstanding. Generous enough for someone dropping a
 * folder of files in one go, low enough that a peer cannot make the receive path quadratic.
 */
export const MAX_PENDING_OFFERS_PER_PEER = 64;

/**
 * Everything this session needs from the network. `PeerMesh` satisfies it structurally, so the
 * mesh can be handed over directly once a room is joined - and until then the session simply has
 * no transport and every send reports failure.
 */
export interface TransferTransport {
  sendBulk(peerId: string, frame: ArrayBuffer): boolean;
  bulkBufferedAmount(peerId: string): number;
  isPeerReady(peerId: string): boolean;
  sendControl(peerId: string, message: ControlMessage): boolean;
}

type OutgoingTransfer = {
  file: File;
  peerId: string;
  cancelled: boolean;
  /** Resolves the current wait for the channel to drain. */
  resumeDrain: (() => void) | null;
  /** Rejects the current wait, used when the peer goes away mid-transfer. */
  abortDrain: ((reason: Error) => void) | null;
};

type IncomingTransfer = {
  offer: FileOffer;
  peerId: string;
  chunks: Uint8Array[];
  /**
   * Indexed by chunk number, not appended. Digesting is async and several chunk handlers can be
   * in flight at once, so appending would record them in completion order and produce a digest
   * that does not match the sender's for a perfectly intact file.
   */
  chunkDigests: (ArrayBuffer | undefined)[];
  bytesReceived: number;
  nextChunkIndex: number;
  cancelled: boolean;
  /** Serializes the async digest work, and guarantees completion is handled exactly once. */
  digestQueue: Promise<void>;
  finishing: boolean;
  lastProgressAt: number;
};

export type FileSessionCallbacks = {
  onTransferChanged(transfer: Transfer): void;
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
  private transport: TransferTransport | null = null;

  constructor(
    private readonly callbacks: FileSessionCallbacks,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Points the session at the current mesh, or at nothing once a room is left. */
  setTransport(transport: TransferTransport | null): void {
    this.transport = transport;
  }

  list(): Transfer[] {
    return [...this.transfers.values()];
  }

  /**
   * Re-arms a session that has been closed. React's strict mode mounts every effect twice, so a
   * session created once per component is closed and then reused; without this it would come back
   * permanently inert.
   */
  open(): void {
    this.closed = false;
  }

  /**
   * Hashes `file`, then offers it to `peerId`. Hashing happens before the offer so the digest can
   * travel with it and the receiver can verify what it got against what was promised.
   */
  async offerFile(peerId: string, file: File): Promise<void> {
    if (this.closed || file.size > MAX_TRANSFER_BYTES) {
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

    this.outgoing.set(key, { file, peerId, cancelled: false, resumeDrain: null, abortDrain: null });

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

    this.sendControl(peerId, {
      type: "file-offer",
      offer: {
        transferId,
        name: transfer.name,
        size: transfer.size,
        mime: transfer.mime,
        digest,
      },
    });
  }

  /** Records an offer from a peer. Nothing is transferred until the user accepts. */
  receiveOffer(peerId: string, offer: FileOffer): void {
    if (offer.size > MAX_TRANSFER_BYTES) {
      this.sendControl(peerId, { type: "file-decline", transferId: offer.transferId });
      return;
    }

    const key = transferKey("incoming", peerId, offer.transferId);
    if (this.transfers.has(key)) {
      return;
    }

    // Declined without being recorded once a peer has this many offers outstanding.
    //
    // An offer holds no payload, so the cost is not memory - it is that every retained offer makes
    // the *next* one more expensive to record, because the consuming component rebuilds its
    // transfer map per message. That is quadratic, and a peer sending a few MB of offers can pin
    // the main thread for minutes, which also stops the Leave button from ever being processed.
    // Bounding what is retained keeps the per-message cost flat.
    if (this.pendingOffersFrom(peerId) >= MAX_PENDING_OFFERS_PER_PEER) {
      this.sendControl(peerId, { type: "file-decline", transferId: offer.transferId });
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
      peerId,
      chunks: [],
      chunkDigests: [],
      bytesReceived: 0,
      nextChunkIndex: 0,
      cancelled: false,
      digestQueue: Promise.resolve(),
      finishing: false,
      lastProgressAt: 0,
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
    this.sendControl(peerId, { type: "file-accept", transferId });
  }

  declineOffer(peerId: string, transferId: number): void {
    const key = transferKey("incoming", peerId, transferId);
    const transfer = this.transfers.get(key);
    if (!transfer || transfer.status !== "offered") {
      return;
    }

    this.dropIncoming(key);
    transfer.status = "declined";
    this.emit(transfer);
    this.sendControl(peerId, { type: "file-decline", transferId });
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
      this.dropIncoming(key);
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
    this.dropIncoming(key);
    transfer.status = "cancelled";
    this.emit(transfer);
    this.sendControl(peerId, { type: "file-cancel", transferId });
  }

  /**
   * Stores one received chunk.
   *
   * Chunks for a transfer that was never accepted are dropped: that is what stops a peer from
   * pushing bytes at us unasked. An out-of-order index or an overlong payload means the stream is
   * not what was offered, so the transfer is failed rather than patched up.
   */
  handleChunk(peerId: string, frame: ChunkFrame): void {
    const key = transferKey("incoming", peerId, frame.transferId);
    const transfer = this.transfers.get(key);
    const state = this.incoming.get(key);

    if (!transfer || !state || state.cancelled || transfer.status !== "transferring") {
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

    // All bookkeeping is synchronous, so two chunk handlers can never interleave over it. Only
    // the digesting below is deferred, and it is serialized.
    // The frame's payload is a view onto the received message buffer; copying it here keeps each
    // stored chunk independent of that buffer and of anything else the channel delivered.
    const chunk = new Uint8Array(frame.payload);
    const index = frame.chunkIndex;
    state.chunks.push(chunk);
    state.bytesReceived += chunk.byteLength;
    state.nextChunkIndex += 1;

    const isLast = state.bytesReceived >= transfer.size;
    const now = this.now();
    if (isLast || now - state.lastProgressAt >= PROGRESS_INTERVAL_MS) {
      // Throttled: a 256 MB transfer is 16,000 chunks, and one render each would lock the tab up.
      state.lastProgressAt = now;
      transfer.progress = computeProgress(state.bytesReceived, transfer.size, 0);
      this.emit(transfer);
    }

    state.digestQueue = state.digestQueue
      .then(async () => {
        if (state.cancelled || this.closed) {
          return;
        }

        state.chunkDigests[index] = await crypto.subtle.digest("SHA-256", chunk);

        // Only the handler that queued the final chunk finishes the transfer, and it runs after
        // every earlier digest has been recorded.
        if (isLast && !state.finishing) {
          state.finishing = true;
          await this.finishIncoming(transfer, state, peerId);
        }
      })
      .catch(() => {
        if (!state.cancelled) {
          this.fail(transfer, "Could not verify the transfer");
        }
        this.incoming.delete(key);
      });
  }

  /** Called when a peer disappears, so its in-flight transfers do not sit pending forever. */
  abortPeer(peerId: string): void {
    for (const transfer of this.transfers.values()) {
      if (transfer.peerId !== peerId || isFinished(transfer.status)) {
        continue;
      }

      this.stopOutgoing(transfer.key);
      this.dropIncoming(transfer.key);
      transfer.status = "failed";
      transfer.error = "The peer disconnected";
      this.emit(transfer);
    }
  }

  /** The channel drained; wake any sender parked on backpressure. */
  handleDrain(peerId: string): void {
    for (const state of this.outgoing.values()) {
      // Compared against the stored peer id rather than matched inside the composite key: a peer
      // id may itself contain a colon, which would make a substring match resume the wrong
      // transfers.
      if (state.peerId === peerId && state.resumeDrain) {
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
    for (const key of [...this.incoming.keys()]) {
      this.dropIncoming(key);
    }

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
        // A cancellation unparks the wait by rejecting it, and the cancel path has already set
        // the status; reporting a failure over the top of it would be wrong.
        if (!state.cancelled && !this.closed) {
          this.fail(transfer, error instanceof Error ? error.message : "Transfer stalled");
        }
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
      if (!this.transport?.sendBulk(transfer.peerId, frame)) {
        this.fail(transfer, "The connection closed mid-transfer");
        return;
      }

      bytesQueued = end;

      const elapsed = this.now() - startedAt;
      if (elapsed - lastEmit >= PROGRESS_INTERVAL_MS || index === total - 1) {
        lastEmit = elapsed;
        // Progress is what has actually left the buffer, not what has been queued into it.
        const buffered = this.transport?.bulkBufferedAmount(transfer.peerId) ?? 0;
        const sent = Math.max(0, bytesQueued - buffered);
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
    if (!this.transport?.isPeerReady(peerId)) {
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
      const digests = state.chunkDigests;
      if (digests.some((entry) => entry === undefined)) {
        throw new Error("A chunk digest is missing");
      }
      digest = await digestChunkDigests(digests as ArrayBuffer[]);
    } catch {
      this.fail(transfer, "Could not verify the transfer");
      this.incoming.delete(transfer.key);
      return;
    }

    this.incoming.delete(transfer.key);

    // A session closed while the last chunks were being digested has already cleared its
    // transfers, so an object URL created now would leak for the life of the document.
    if (this.closed || state.cancelled) {
      return;
    }

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

    this.sendControl(peerId, { type: "file-complete", transferId: transfer.transferId });
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

  /** Offers from `peerId` the user has not yet accepted or declined. */
  private pendingOffersFrom(peerId: string): number {
    let count = 0;
    for (const transfer of this.transfers.values()) {
      if (transfer.direction === "incoming" && transfer.peerId === peerId && transfer.status === "offered") {
        count += 1;
      }
    }
    return count;
  }

  /**
   * Forgets an incoming transfer. The flag matters as much as the removal: a digest task queued
   * earlier still holds a reference to this state, and must not go on to finish or fail a
   * transfer the user has already dealt with.
   */
  private dropIncoming(key: string): void {
    const state = this.incoming.get(key);
    if (state) {
      state.cancelled = true;
    }
    this.incoming.delete(key);
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

  private sendControl(peerId: string, message: ControlMessage): boolean {
    return this.transport?.sendControl(peerId, message) ?? false;
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
