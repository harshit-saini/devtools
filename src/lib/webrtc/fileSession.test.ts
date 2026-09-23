import { describe, expect, it, vi } from "vitest";
import { FileSession, MAX_PENDING_OFFERS_PER_PEER, type Transfer } from "./fileSession";
import {
  CHUNK_PAYLOAD_BYTES,
  chunkCount,
  chunkRange,
  computeFileDigest,
  decodeChunk,
  encodeChunk,
} from "./fileTransfer";
import type { ControlMessage } from "./protocol";

const PEER = "peer-b";

function bytes(length: number, seed = 0): Uint8Array {
  const data = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    data[index] = (index * 37 + seed) % 256;
  }
  return data;
}

/**
 * A transport that records control messages and hands bulk frames straight to a receiving
 * session, which is what lets a whole transfer be driven without a browser.
 */
function harness() {
  const control: ControlMessage[] = [];
  const bulk: ArrayBuffer[] = [];
  const transfers = new Map<string, Transfer>();

  const session = new FileSession({
    onTransferChanged: (transfer) => {
      transfers.set(transfer.key, transfer);
    },
  });

  session.setTransport({
    sendBulk: (_peerId, frame) => {
      bulk.push(frame);
      return true;
    },
    bulkBufferedAmount: () => 0,
    isPeerReady: () => true,
    sendControl: (_peerId, message) => {
      control.push(message);
      return true;
    },
  });
  session.open();

  return { session, control, bulk, transfers };
}

function offerFor(control: ControlMessage[]) {
  const message = control.find((entry) => entry.type === "file-offer");
  if (message?.type !== "file-offer") {
    throw new Error("no offer was sent");
  }
  return message.offer;
}

/** Builds the frames a sender would produce for `payload`, without running the send loop. */
function framesFor(transferId: number, payload: Uint8Array): ArrayBuffer[] {
  const blob = new Blob([payload as BlobPart]);
  const frames: ArrayBuffer[] = [];
  for (let index = 0; index < chunkCount(blob.size); index += 1) {
    const { start, end } = chunkRange(index, blob.size);
    frames.push(encodeChunk(transferId, index, payload.subarray(start, end)));
  }
  return frames;
}

describe("FileSession receive path", () => {
  it("verifies a multi-chunk transfer whose chunk handlers overlap", async () => {
    // The bug this pins: digesting is async, so several chunk handlers are in flight at once. If
    // their digests are recorded in completion order rather than by chunk index, the computed
    // digest does not match the sender's and a perfectly intact file is reported corrupt.
    const payload = bytes(CHUNK_PAYLOAD_BYTES * 5 + 321, 3);
    const digest = await computeFileDigest(new Blob([payload as BlobPart]));

    const { session, control, transfers } = harness();
    const transferId = 7;

    session.receiveOffer(PEER, {
      transferId,
      name: "payload.bin",
      size: payload.byteLength,
      mime: "application/octet-stream",
      digest,
    });
    session.acceptOffer(PEER, transferId);

    // Delivered synchronously back to back, exactly as the data channel does it.
    for (const frame of framesFor(transferId, payload)) {
      const decoded = decodeChunk(frame);
      expect(decoded).not.toBeNull();
      session.handleChunk(PEER, decoded!);
    }

    await vi.waitFor(() => {
      const transfer = transfers.get(`incoming:${PEER}:${transferId}`);
      expect(transfer?.status === "complete" || transfer?.status === "corrupt").toBe(true);
    });

    const transfer = transfers.get(`incoming:${PEER}:${transferId}`);
    expect(transfer?.status).toBe("complete");
    expect(transfer?.error).toBeNull();
    expect(control.some((entry) => entry.type === "file-complete")).toBe(true);

    session.close();
  });

  it("verifies correctly even when digests resolve in reverse order", async () => {
    // The previous implementation appended each digest as it resolved, so the order depended on
    // how the platform happened to schedule them. Forcing the worst case here means this cannot
    // pass by luck: later chunks are digested first, and the transfer must still verify.
    const payload = bytes(CHUNK_PAYLOAD_BYTES * 4, 11);
    const digest = await computeFileDigest(new Blob([payload as BlobPart]));

    const realDigest = crypto.subtle.digest.bind(crypto.subtle);
    let call = 0;
    const spy = vi
      .spyOn(crypto.subtle, "digest")
      .mockImplementation(async (algorithm, data) => {
        // Earlier chunks wait longest, inverting the resolution order.
        const delay = Math.max(0, 40 - call * 10);
        call += 1;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return realDigest(algorithm, data as BufferSource);
      });

    try {
      const { session, transfers } = harness();
      const transferId = 21;

      session.receiveOffer(PEER, {
        transferId,
        name: "reordered.bin",
        size: payload.byteLength,
        mime: "application/octet-stream",
        digest,
      });
      session.acceptOffer(PEER, transferId);

      for (const frame of framesFor(transferId, payload)) {
        session.handleChunk(PEER, decodeChunk(frame)!);
      }

      await vi.waitFor(
        () => {
          const transfer = transfers.get(`incoming:${PEER}:${transferId}`);
          expect(transfer?.status === "complete" || transfer?.status === "corrupt").toBe(true);
        },
        { timeout: 5000 },
      );

      expect(transfers.get(`incoming:${PEER}:${transferId}`)?.status).toBe("complete");
      session.close();
    } finally {
      spy.mockRestore();
    }
  });

  it("reports a genuinely corrupted transfer as a checksum mismatch", async () => {
    const payload = bytes(CHUNK_PAYLOAD_BYTES * 2, 4);
    const digest = await computeFileDigest(new Blob([payload as BlobPart]));

    const { session, transfers } = harness();
    const transferId = 11;

    session.receiveOffer(PEER, {
      transferId,
      name: "payload.bin",
      size: payload.byteLength,
      mime: "application/octet-stream",
      digest,
    });
    session.acceptOffer(PEER, transferId);

    const tampered = Uint8Array.from(payload);
    tampered[CHUNK_PAYLOAD_BYTES + 5] ^= 0xff;

    for (const frame of framesFor(transferId, tampered)) {
      session.handleChunk(PEER, decodeChunk(frame)!);
    }

    await vi.waitFor(() => {
      expect(transfers.get(`incoming:${PEER}:${transferId}`)?.status).toBe("corrupt");
    });

    session.close();
  });

  it("drops chunks for a transfer that was never accepted", () => {
    const { session, transfers } = harness();
    const payload = bytes(1024, 5);
    const transferId = 3;

    session.receiveOffer(PEER, {
      transferId,
      name: "unasked.bin",
      size: payload.byteLength,
      mime: "application/octet-stream",
      digest: "a".repeat(64),
    });

    // No acceptOffer: a peer pushing bytes anyway must get nowhere.
    for (const frame of framesFor(transferId, payload)) {
      session.handleChunk(PEER, decodeChunk(frame)!);
    }

    const transfer = transfers.get(`incoming:${PEER}:${transferId}`);
    expect(transfer?.status).toBe("offered");
    expect(transfer?.progress.bytesTransferred).toBe(0);

    session.close();
  });

  it("fails a transfer that sends more data than it offered", () => {
    const { session, transfers } = harness();
    const transferId = 4;

    session.receiveOffer(PEER, {
      transferId,
      name: "liar.bin",
      size: 100,
      mime: "application/octet-stream",
      digest: "b".repeat(64),
    });
    session.acceptOffer(PEER, transferId);

    session.handleChunk(PEER, decodeChunk(encodeChunk(transferId, 0, bytes(500, 6)))!);

    const transfer = transfers.get(`incoming:${PEER}:${transferId}`);
    expect(transfer?.status).toBe("failed");
    expect(transfer?.error).toMatch(/more data/i);

    session.close();
  });

  it("fails a transfer whose chunks arrive out of order", () => {
    const { session, transfers } = harness();
    const transferId = 5;
    const payload = bytes(CHUNK_PAYLOAD_BYTES * 2, 7);

    session.receiveOffer(PEER, {
      transferId,
      name: "jumbled.bin",
      size: payload.byteLength,
      mime: "application/octet-stream",
      digest: "c".repeat(64),
    });
    session.acceptOffer(PEER, transferId);

    const frames = framesFor(transferId, payload);
    session.handleChunk(PEER, decodeChunk(frames[1])!);

    expect(transfers.get(`incoming:${PEER}:${transferId}`)?.status).toBe("failed");

    session.close();
  });

  it("declining tells the peer and stops accepting chunks", () => {
    const { session, control, transfers } = harness();
    const transferId = 6;
    const payload = bytes(2048, 8);

    session.receiveOffer(PEER, {
      transferId,
      name: "nope.bin",
      size: payload.byteLength,
      mime: "application/octet-stream",
      digest: "d".repeat(64),
    });
    session.declineOffer(PEER, transferId);

    expect(transfers.get(`incoming:${PEER}:${transferId}`)?.status).toBe("declined");
    expect(control.some((entry) => entry.type === "file-decline")).toBe(true);

    for (const frame of framesFor(transferId, payload)) {
      session.handleChunk(PEER, decodeChunk(frame)!);
    }
    expect(transfers.get(`incoming:${PEER}:${transferId}`)?.status).toBe("declined");

    session.close();
  });

  it("cancelling mid-transfer is not undone by chunks still in flight", async () => {
    const { session, transfers } = harness();
    const transferId = 9;
    const payload = bytes(CHUNK_PAYLOAD_BYTES * 3, 9);
    const digest = await computeFileDigest(new Blob([payload as BlobPart]));

    session.receiveOffer(PEER, {
      transferId,
      name: "cancelled.bin",
      size: payload.byteLength,
      mime: "application/octet-stream",
      digest,
    });
    session.acceptOffer(PEER, transferId);

    const frames = framesFor(transferId, payload);
    session.handleChunk(PEER, decodeChunk(frames[0])!);
    // Cancelled while the first chunk's digest is still being computed.
    session.cancel(PEER, transferId, "incoming");
    for (const frame of frames.slice(1)) {
      session.handleChunk(PEER, decodeChunk(frame)!);
    }

    // Give any queued digest work a chance to (wrongly) complete the transfer.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const transfer = transfers.get(`incoming:${PEER}:${transferId}`);
    expect(transfer?.status).toBe("cancelled");
    expect(transfer?.blobUrl).toBeNull();

    session.close();
  });

  it("aborts a peer's in-flight transfers when it disconnects", () => {
    const { session, transfers } = harness();
    const transferId = 12;

    session.receiveOffer(PEER, {
      transferId,
      name: "dropped.bin",
      size: CHUNK_PAYLOAD_BYTES,
      mime: "application/octet-stream",
      digest: "e".repeat(64),
    });
    session.acceptOffer(PEER, transferId);
    session.abortPeer(PEER);

    const transfer = transfers.get(`incoming:${PEER}:${transferId}`);
    expect(transfer?.status).toBe("failed");
    expect(transfer?.error).toMatch(/disconnected/i);

    session.close();
  });

  it("stops retaining offers from a peer that floods them, and keeps declining", () => {
    // An offer holds no payload, so this is not about memory: every retained offer makes the next
    // one more expensive to record, because the page rebuilds its transfer map per message. Left
    // unbounded that is quadratic, and a few MB of offers pins the main thread for minutes - long
    // enough that the Leave button never gets processed either.
    const { session, control, transfers } = harness();

    for (let index = 0; index < MAX_PENDING_OFFERS_PER_PEER + 200; index += 1) {
      session.receiveOffer(PEER, {
        transferId: 1000 + index,
        name: `flood-${index}.bin`,
        size: 1024,
        mime: "application/octet-stream",
        digest: "a".repeat(64),
      });
    }

    const retained = [...transfers.values()].filter(
      (transfer) => transfer.direction === "incoming" && transfer.status === "offered",
    );
    expect(retained).toHaveLength(MAX_PENDING_OFFERS_PER_PEER);

    // Everything past the cap is refused, so the sender is told rather than left waiting.
    const declines = control.filter((entry) => entry.type === "file-decline");
    expect(declines).toHaveLength(200);

    session.close();
  });

  it("frees room for new offers as the user works through the queue", () => {
    const { session, transfers } = harness();

    for (let index = 0; index < MAX_PENDING_OFFERS_PER_PEER; index += 1) {
      session.receiveOffer(PEER, {
        transferId: 2000 + index,
        name: `queued-${index}.bin`,
        size: 1024,
        mime: "application/octet-stream",
        digest: "b".repeat(64),
      });
    }

    // At the cap, the next offer is refused.
    session.receiveOffer(PEER, {
      transferId: 9998,
      name: "refused.bin",
      size: 1024,
      mime: "application/octet-stream",
      digest: "c".repeat(64),
    });
    expect(transfers.has(`incoming:${PEER}:9998`)).toBe(false);

    // Deciding on one makes room again: the cap counts undecided offers, not history.
    session.declineOffer(PEER, 2000);
    session.receiveOffer(PEER, {
      transferId: 9999,
      name: "accepted-later.bin",
      size: 1024,
      mime: "application/octet-stream",
      digest: "d".repeat(64),
    });
    expect(transfers.get(`incoming:${PEER}:9999`)?.status).toBe("offered");

    session.close();
  });

  it("counts the cap per peer, so one flooder cannot crowd out another peer", () => {
    const { session, transfers } = harness();

    for (let index = 0; index < MAX_PENDING_OFFERS_PER_PEER + 50; index += 1) {
      session.receiveOffer("flooder", {
        transferId: 3000 + index,
        name: `flood-${index}.bin`,
        size: 1024,
        mime: "application/octet-stream",
        digest: "e".repeat(64),
      });
    }

    session.receiveOffer("colleague", {
      transferId: 4000,
      name: "wanted.bin",
      size: 1024,
      mime: "application/octet-stream",
      digest: "f".repeat(64),
    });

    expect(transfers.get("incoming:colleague:4000")?.status).toBe("offered");

    session.close();
  });

  it("declines an offer larger than it will hold in memory", () => {
    const { session, control } = harness();

    session.receiveOffer(PEER, {
      transferId: 13,
      name: "huge.bin",
      size: 1024 * 1024 * 1024,
      mime: "application/octet-stream",
      digest: "f".repeat(64),
    });

    expect(control.some((entry) => entry.type === "file-decline")).toBe(true);

    session.close();
  });
});

describe("FileSession send path", () => {
  it("hashes a file, offers it, and sends its chunks once accepted", async () => {
    const { session, control, bulk, transfers } = harness();
    const payload = bytes(CHUNK_PAYLOAD_BYTES * 2 + 10, 2);
    const file = new File([payload as BlobPart], "out.bin", { type: "application/octet-stream" });

    await session.offerFile(PEER, file);

    const offer = offerFor(control);
    expect(offer.name).toBe("out.bin");
    expect(offer.size).toBe(payload.byteLength);
    expect(offer.digest).toBe(await computeFileDigest(new Blob([payload as BlobPart])));

    session.handleAccept(PEER, offer.transferId);

    await vi.waitFor(() => {
      expect(bulk.length).toBe(chunkCount(payload.byteLength));
    });

    // The frames must reassemble into exactly the bytes that went in.
    const reassembled = new Uint8Array(payload.byteLength);
    let offset = 0;
    for (const [index, frame] of bulk.entries()) {
      const decoded = decodeChunk(frame);
      expect(decoded?.chunkIndex).toBe(index);
      reassembled.set(decoded!.payload, offset);
      offset += decoded!.payload.byteLength;
    }
    expect(reassembled).toEqual(payload);

    session.handleComplete(PEER, offer.transferId);
    expect(transfers.get(`outgoing:${PEER}:${offer.transferId}`)?.status).toBe("complete");

    session.close();
  });

  it("a declined offer sends nothing", async () => {
    const { session, control, bulk, transfers } = harness();
    const file = new File([bytes(4096, 1) as BlobPart], "out.bin");

    await session.offerFile(PEER, file);
    const offer = offerFor(control);
    session.handleDecline(PEER, offer.transferId);

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(bulk).toHaveLength(0);
    expect(transfers.get(`outgoing:${PEER}:${offer.transferId}`)?.status).toBe("declined");

    session.close();
  });

  it("cancelling an outgoing transfer is not overwritten as a failure", async () => {
    const { session, control, transfers } = harness();
    const file = new File([bytes(CHUNK_PAYLOAD_BYTES * 4, 5) as BlobPart], "out.bin");

    await session.offerFile(PEER, file);
    const offer = offerFor(control);
    session.handleAccept(PEER, offer.transferId);
    session.cancel(PEER, offer.transferId, "outgoing");

    // The send loop unparks by rejection; reporting a failure over the cancellation would be wrong.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(transfers.get(`outgoing:${PEER}:${offer.transferId}`)?.status).toBe("cancelled");
    expect(control.some((entry) => entry.type === "file-cancel")).toBe(true);

    session.close();
  });

  it("refuses a file larger than the in-memory cap", async () => {
    const { session, control } = harness();
    const huge = { size: 1024 * 1024 * 1024, name: "huge.bin", type: "" } as File;

    await session.offerFile(PEER, huge);

    expect(control).toHaveLength(0);

    session.close();
  });
});
