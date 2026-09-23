/**
 * A full mesh of RTCPeerConnections: one connection per remote peer, each carrying two data
 * channels and (optionally) media tracks.
 *
 * Negotiation uses the "perfect negotiation" pattern rather than hand-rolled turn-taking. Both
 * peers may need to renegotiate at any time - someone turns their camera on, someone starts
 * sharing a screen - so an offer can always collide with an incoming one. Perfect negotiation
 * resolves that deterministically: one side is designated polite (decided by comparing peer ids,
 * so the two sides always disagree) and rolls back its own offer when a collision happens, while
 * the impolite side ignores the incoming offer and presses on.
 *
 * Both data channels are pre-negotiated with fixed ids, so each side creates them locally instead
 * of waiting for an `ondatachannel` event. That removes the race where a channel is created before
 * the transport is up, and guarantees both sides agree on which channel is which.
 *
 * This class is deliberately framework-free. It exposes a `subscribe`/`getSnapshot` pair so React
 * can read it through useSyncExternalStore, and takes callbacks for the streaming events (data
 * channel traffic) that should not go through render state.
 */

import {
  BULK_CHANNEL_ID,
  BULK_CHANNEL_LABEL,
  CONTROL_CHANNEL_ID,
  CONTROL_CHANNEL_LABEL,
  encodeControlMessage,
  parseControlMessage,
  type ControlMessage,
} from "./protocol";
import { decodeChunk, MAX_TRANSFER_BYTES, SEND_LOW_WATER_MARK, type ChunkFrame } from "./fileTransfer";
import { colorForPeer } from "./roomCode";
import { MAX_CANDIDATES_PER_BATCH } from "./signaling";
import type { RoomPeer, SignalPayload } from "./signaling";

export type PeerLinkState = "connecting" | "connected" | "reconnecting" | "failed" | "closed";

export type MeshPeerView = {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly state: PeerLinkState;
  /** True once the control channel is open, i.e. chat and notepad ops can flow. */
  readonly ready: boolean;
  readonly bulkReady: boolean;
  readonly stream: MediaStream | null;
  /** Populated once ICE has picked a route; "relay" means traffic goes through a TURN server. */
  readonly candidateType: string | null;
  /**
   * Increments whenever this peer's track set changes. The stream object is kept stable so the
   * bound <video> keeps playing, which means React cannot see a track swap; this gives it
   * something that does change.
   */
  readonly trackEpoch: number;
};

export type MeshSnapshot = {
  readonly peers: readonly MeshPeerView[];
};

export type PeerMeshCallbacks = {
  sendSignal(target: string, payload: SignalPayload): void;
  onControlMessage(peerId: string, message: ControlMessage): void;
  onBulkChunk(peerId: string, frame: ChunkFrame): void;
  /** Fires when a peer's control channel opens, which is the cue to send it a hello/snapshot. */
  onPeerReady(peerId: string): void;
  onPeerRemoved(peerId: string): void;
  onBulkDrain(peerId: string): void;
};

type PeerEntry = {
  id: string;
  name: string;
  connection: RTCPeerConnection;
  control: RTCDataChannel;
  bulk: RTCDataChannel;
  polite: boolean;
  /** True on the side that owns the first offer, i.e. the peer that joined the room later. */
  initiator: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  /** Candidates that arrived before a remote description existed to attach them to. */
  pendingCandidates: (RTCIceCandidateInit | null)[];
  /** Serializes relayed payloads for this peer; see handleSignal. */
  signalQueue: Promise<void>;
  /** Locally gathered candidates waiting to be relayed as one batch. */
  outgoingCandidates: (RTCIceCandidateInit | null)[];
  candidateFlushTimer: number | null;
  stream: MediaStream | null;
  trackEpoch: number;
  state: PeerLinkState;
  candidateType: string | null;
  videoSender: RTCRtpSender | null;
  audioSender: RTCRtpSender | null;
};

/**
 * How long locally gathered ICE candidates are held before being relayed together. Long enough to
 * collect a host/srflx burst into one message (keeping a 8-peer mesh well inside the signaling
 * server's rate limit), short enough not to delay connection setup perceptibly.
 */
const CANDIDATE_BATCH_MS = 60;

export type PeerMeshOptions = {
  selfId: string;
  iceServers: RTCIceServer[];
  callbacks: PeerMeshCallbacks;
  /** Video/file tools pass true; the notepad needs data channels only. */
  withMedia?: boolean;
};

export class PeerMesh {
  private readonly peers = new Map<string, PeerEntry>();
  private readonly listeners = new Set<() => void>();
  private snapshot: MeshSnapshot = { peers: [] };
  private localStream: MediaStream | null = null;
  private closed = false;

  constructor(private readonly options: PeerMeshOptions) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): MeshSnapshot => this.snapshot;

  get peerIds(): string[] {
    return [...this.peers.keys()];
  }

  /**
   * Adds a peer and, when `initiate` is true, starts negotiation. The caller decides: the peer that
   * just joined a room initiates towards everyone already there, and existing members wait. That
   * keeps the common case collision-free, while perfect negotiation still covers every later
   * renegotiation.
   */
  addPeer(peer: RoomPeer, initiate: boolean): void {
    if (this.closed || this.peers.has(peer.id)) {
      return;
    }

    const connection = new RTCPeerConnection({ iceServers: this.options.iceServers });

    const entry: PeerEntry = {
      id: peer.id,
      name: peer.name,
      connection,
      // Pre-negotiated channels: both sides create them with matching ids, so no ondatachannel
      // handshake and no chance of one side missing the other's channel.
      control: connection.createDataChannel(CONTROL_CHANNEL_LABEL, {
        negotiated: true,
        id: CONTROL_CHANNEL_ID,
        ordered: true,
      }),
      bulk: connection.createDataChannel(BULK_CHANNEL_LABEL, {
        negotiated: true,
        id: BULK_CHANNEL_ID,
        ordered: true,
      }),
      // The two sides compare ids and therefore always reach opposite conclusions.
      polite: this.options.selfId < peer.id,
      initiator: initiate,
      makingOffer: false,
      ignoreOffer: false,
      isSettingRemoteAnswerPending: false,
      pendingCandidates: [],
      signalQueue: Promise.resolve(),
      outgoingCandidates: [],
      candidateFlushTimer: null,
      stream: null,
      trackEpoch: 0,
      state: "connecting",
      candidateType: null,
      videoSender: null,
      audioSender: null,
    };

    this.peers.set(peer.id, entry);
    this.wireConnection(entry);
    this.wireChannels(entry);

    if (this.localStream) {
      this.attachLocalTracks(entry);
    }

    this.publish();

    if (initiate) {
      void this.negotiate(entry);
    }
  }

  removePeer(peerId: string): void {
    const entry = this.peers.get(peerId);
    if (!entry) {
      return;
    }

    this.peers.delete(peerId);
    this.teardown(entry);
    this.publish();
    this.options.callbacks.onPeerRemoved(peerId);
  }

  renamePeer(peerId: string, name: string): void {
    const entry = this.peers.get(peerId);
    if (!entry || entry.name === name) {
      return;
    }
    entry.name = name;
    this.publish();
  }

  /**
   * Routes a relayed payload to the right connection, one payload at a time per peer.
   *
   * The serialization matters: perfect negotiation reasons about `signalingState` and its own
   * flags across await points, so it is only correct if messages are handled sequentially. Two
   * descriptions processed concurrently - which a renegotiation collision produces - would call
   * `setRemoteDescription` twice from the same state, and the loser would be rejected and its
   * negotiation round silently lost.
   */
  handleSignal(from: string, payload: SignalPayload): Promise<void> {
    const entry = this.peers.get(from);
    if (!entry || this.closed) {
      return Promise.resolve();
    }

    entry.signalQueue = entry.signalQueue.then(() => this.processSignal(entry, payload));
    return entry.signalQueue;
  }

  private async processSignal(entry: PeerEntry, payload: SignalPayload): Promise<void> {
    // The peer may have left, or the mesh been torn down, while this payload waited its turn.
    if (this.closed || this.peers.get(entry.id) !== entry) {
      return;
    }

    try {
      if (payload.kind === "description") {
        await this.handleDescription(entry, payload.description);
        return;
      }

      for (const candidate of payload.candidates) {
        // Isolated per candidate: a stale one from a superseded negotiation round rejects, and
        // aborting the loop there would throw away the candidates behind it.
        try {
          await this.handleCandidate(entry, candidate);
        } catch {
          // Already handled inside handleCandidate for the cases worth knowing about.
        }
      }
    } catch {
      // A rejected description or candidate means this negotiation round failed; ICE restart or
      // the connection-state watcher below will recover it. Nothing useful to surface here, and
      // swallowing it here is what keeps the queue alive for the next payload.
    }
  }

  /**
   * Publishes `stream` (or stops publishing when null) to every peer.
   *
   * This is the single path for every media change - starting a camera, muting it, swapping in a
   * screen share. Once a sender exists for a kind, its track is swapped with `replaceTrack`, which
   * needs no new offer/answer round, so a screen share takes over mid-call without interrupting
   * anything. Routing every change through one method also keeps all outgoing tracks announced
   * under the same stream, which is what lets the far side keep them together in one tile.
   */
  async setLocalStream(stream: MediaStream | null): Promise<void> {
    this.localStream = stream;

    await Promise.all(
      [...this.peers.values()].map(async (entry) => {
        const videoTrack = stream?.getVideoTracks()[0] ?? null;
        const audioTrack = stream?.getAudioTracks()[0] ?? null;

        await this.setSenderTrack(entry, "video", videoTrack);
        await this.setSenderTrack(entry, "audio", audioTrack);
      }),
    );
  }

  broadcastControl(message: ControlMessage): void {
    const payload = encodeControlMessage(message);
    for (const entry of this.peers.values()) {
      if (entry.control.readyState === "open") {
        this.safeSend(entry.control, payload);
      }
    }
  }

  sendControl(peerId: string, message: ControlMessage): boolean {
    const entry = this.peers.get(peerId);
    if (!entry || entry.control.readyState !== "open") {
      return false;
    }
    return this.safeSend(entry.control, encodeControlMessage(message));
  }

  sendBulk(peerId: string, frame: ArrayBuffer): boolean {
    const entry = this.peers.get(peerId);
    if (!entry || entry.bulk.readyState !== "open") {
      return false;
    }

    try {
      entry.bulk.send(frame);
      return true;
    } catch {
      return false;
    }
  }

  bulkBufferedAmount(peerId: string): number {
    return this.peers.get(peerId)?.bulk.bufferedAmount ?? 0;
  }

  isPeerReady(peerId: string): boolean {
    return this.peers.get(peerId)?.control.readyState === "open";
  }

  /** Forces a fresh ICE gathering round on a connection that has failed. */
  restartIce(peerId: string): void {
    const entry = this.peers.get(peerId);
    if (!entry) {
      return;
    }

    entry.connection.restartIce();
    void this.negotiate(entry);
  }

  close(): void {
    this.closed = true;

    const removed = [...this.peers.keys()];
    for (const entry of this.peers.values()) {
      this.teardown(entry);
    }
    this.peers.clear();
    this.localStream = null;
    this.publish();

    // Reported before the listeners go: a file transfer parked on backpressure is only unparked
    // by this callback, so skipping it leaves the transfer showing progress forever.
    for (const peerId of removed) {
      this.options.callbacks.onPeerRemoved(peerId);
    }

    this.listeners.clear();
  }

  private async setSenderTrack(
    entry: PeerEntry,
    kind: "video" | "audio",
    track: MediaStreamTrack | null,
  ): Promise<void> {
    const senderKey = kind === "video" ? "videoSender" : "audioSender";
    const existing = entry[senderKey];

    if (existing) {
      try {
        await existing.replaceTrack(track);
      } catch {
        // A sender whose connection is closing rejects; the connection is going away anyway.
      }
      return;
    }

    if (!track) {
      return;
    }

    try {
      // addTrack triggers negotiationneeded, which the perfect-negotiation handler picks up.
      entry[senderKey] = entry.connection.addTrack(track, this.localStream ?? new MediaStream([track]));
    } catch {
      // Adding a track to a closed connection throws; nothing to do.
    }
  }

  private attachLocalTracks(entry: PeerEntry): void {
    const stream = this.localStream;
    if (!stream) {
      return;
    }

    for (const track of stream.getTracks()) {
      try {
        const sender = entry.connection.addTrack(track, stream);
        if (track.kind === "video") {
          entry.videoSender = sender;
        } else if (track.kind === "audio") {
          entry.audioSender = sender;
        }
      } catch {
        // Already added, or the connection is closed.
      }
    }
  }

  private wireConnection(entry: PeerEntry): void {
    const { connection } = entry;

    connection.onnegotiationneeded = () => {
      // Creating the two data channels needs an SCTP transport, so this fires once on each side
      // as soon as the connection is built. Only the designated initiator may act on that: if
      // both sides offered here, every connection would open with an avoidable collision.
      if (!entry.initiator && !connection.remoteDescription) {
        return;
      }
      void this.negotiate(entry);
    };

    connection.onicecandidate = ({ candidate }) => {
      // The final null candidate is queued too: it tells the far side gathering is done.
      entry.outgoingCandidates.push(candidate ? candidate.toJSON() : null);

      if (candidate === null) {
        // End of gathering - send immediately rather than waiting out the batch window.
        this.flushOutgoingCandidates(entry);
        return;
      }

      if (entry.candidateFlushTimer === null) {
        entry.candidateFlushTimer = window.setTimeout(() => {
          entry.candidateFlushTimer = null;
          this.flushOutgoingCandidates(entry);
        }, CANDIDATE_BATCH_MS);
      }
    };

    connection.ontrack = (event) => {
      // One stable MediaStream per peer, accumulated rather than replaced.
      //
      // A peer's camera and microphone are added at different moments, so they can be announced
      // as two different streams; taking `event.streams[0]` each time would leave the tile holding
      // whichever track arrived last - audio only, with a blank video. Mutating one stream we own
      // also means the bound <video> element picks up a later track without React re-rendering,
      // which is why the identity must stay the same.
      if (!entry.stream) {
        entry.stream = new MediaStream();
      }
      const stream = entry.stream;

      // A new track of a kind we already have replaces it: that is a screen share taking over
      // from a camera.
      for (const existing of stream.getTracks()) {
        if (existing.kind === event.track.kind && existing.id !== event.track.id) {
          stream.removeTrack(existing);
        }
      }

      if (!stream.getTrackById(event.track.id)) {
        stream.addTrack(event.track);
      }

      event.track.onended = () => {
        stream.removeTrack(event.track);
        entry.trackEpoch += 1;
        this.publish();
      };

      entry.trackEpoch += 1;
      this.publish();
    };

    connection.onconnectionstatechange = () => {
      const next = mapConnectionState(connection.connectionState);
      if (entry.state !== next) {
        entry.state = next;
        this.publish();
      }

      if (connection.connectionState === "connected") {
        void this.readCandidateType(entry);
      }
    };

    connection.oniceconnectionstatechange = () => {
      if (connection.iceConnectionState === "failed") {
        // An ICE restart is the documented recovery, and is cheap compared to rebuilding the peer.
        connection.restartIce();
      }
    };
  }

  private wireChannels(entry: PeerEntry): void {
    entry.control.onopen = () => {
      this.publish();
      this.options.callbacks.onPeerReady(entry.id);
    };
    entry.control.onclose = () => this.publish();
    entry.control.onmessage = (event) => {
      const message = parseControlMessage(event.data, { maxFileBytes: MAX_TRANSFER_BYTES });
      if (message) {
        this.options.callbacks.onControlMessage(entry.id, message);
      }
    };

    entry.bulk.binaryType = "arraybuffer";
    entry.bulk.bufferedAmountLowThreshold = SEND_LOW_WATER_MARK;
    entry.bulk.onopen = () => this.publish();
    entry.bulk.onclose = () => this.publish();
    entry.bulk.onbufferedamountlow = () => this.options.callbacks.onBulkDrain(entry.id);
    entry.bulk.onmessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) {
        return;
      }
      const frame = decodeChunk(event.data);
      if (frame) {
        this.options.callbacks.onBulkChunk(entry.id, frame);
      }
    };
  }

  /** The offer half of perfect negotiation. */
  private async negotiate(entry: PeerEntry): Promise<void> {
    if (this.closed || entry.connection.signalingState === "closed") {
      return;
    }

    // A negotiation already in flight will carry whatever changed, so starting a second one only
    // produces a redundant offer and an extra ICE gathering round. This is what collapses the
    // explicit first offer and the `negotiationneeded` that data channel creation triggers into
    // one. Anything still pending re-fires `negotiationneeded` once the state returns to stable.
    if (entry.makingOffer || entry.connection.signalingState !== "stable") {
      return;
    }

    try {
      entry.makingOffer = true;
      // The parameterless form lets the browser pick offer vs. answer and handles rollback state.
      await entry.connection.setLocalDescription();
      const description = entry.connection.localDescription;
      if (description) {
        this.options.callbacks.sendSignal(entry.id, {
          kind: "description",
          description: { type: description.type, sdp: description.sdp },
        });
      }
    } catch {
      // Losing a negotiation round is expected under collision; the next one succeeds.
    } finally {
      entry.makingOffer = false;
    }
  }

  /** The answer half of perfect negotiation. */
  private async handleDescription(
    entry: PeerEntry,
    description: RTCSessionDescriptionInit,
  ): Promise<void> {
    const { connection } = entry;

    const readyForOffer =
      !entry.makingOffer &&
      (connection.signalingState === "stable" || entry.isSettingRemoteAnswerPending);
    const offerCollision = description.type === "offer" && !readyForOffer;

    entry.ignoreOffer = !entry.polite && offerCollision;
    if (entry.ignoreOffer) {
      // The impolite peer keeps its own offer; the polite peer will roll back and answer.
      return;
    }

    entry.isSettingRemoteAnswerPending = description.type === "answer";
    try {
      // On a collision the polite peer's implicit rollback happens inside this call.
      await connection.setRemoteDescription(description);
    } finally {
      entry.isSettingRemoteAnswerPending = false;
    }

    await this.flushCandidates(entry);

    if (description.type === "offer") {
      await connection.setLocalDescription();
      const local = connection.localDescription;
      if (local) {
        this.options.callbacks.sendSignal(entry.id, {
          kind: "description",
          description: { type: local.type, sdp: local.sdp },
        });
      }
    }
  }

  private async handleCandidate(
    entry: PeerEntry,
    candidate: RTCIceCandidateInit | null,
  ): Promise<void> {
    // Candidates routinely arrive before the description that gives them a media section to attach
    // to, so they are queued rather than dropped. The null end-of-candidates marker is queued
    // too: dropping it leaves the connection waiting for candidates that will never come, which
    // delays the "no route exists" conclusion on a connection that is going to fail anyway.
    if (!entry.connection.remoteDescription) {
      entry.pendingCandidates.push(candidate);
      return;
    }

    try {
      await entry.connection.addIceCandidate(candidate ?? undefined);
    } catch (error) {
      // A candidate belonging to an offer we deliberately ignored is expected to fail.
      if (!entry.ignoreOffer) {
        throw error;
      }
    }
  }

  private flushOutgoingCandidates(entry: PeerEntry): void {
    if (entry.candidateFlushTimer !== null) {
      window.clearTimeout(entry.candidateFlushTimer);
      entry.candidateFlushTimer = null;
    }

    const candidates = entry.outgoingCandidates;
    entry.outgoingCandidates = [];

    // Split at the limit the receiving validator enforces. A single oversized batch would be
    // rejected in full, losing every candidate in it.
    for (let index = 0; index < candidates.length; index += MAX_CANDIDATES_PER_BATCH) {
      this.options.callbacks.sendSignal(entry.id, {
        kind: "candidates",
        candidates: candidates.slice(index, index + MAX_CANDIDATES_PER_BATCH),
      });
    }
  }

  private async flushCandidates(entry: PeerEntry): Promise<void> {
    const queued = entry.pendingCandidates;
    entry.pendingCandidates = [];

    for (const candidate of queued) {
      try {
        await entry.connection.addIceCandidate(candidate ?? undefined);
      } catch {
        // Stale candidate from a superseded negotiation round.
      }
    }
  }

  /**
   * Reads which kind of ICE candidate actually won, so the UI can say whether a call is direct or
   * going through a relay - the single most useful piece of diagnostics when a call is poor.
   */
  private async readCandidateType(entry: PeerEntry): Promise<void> {
    try {
      const stats = await entry.connection.getStats();
      let selectedPairId: string | null = null;
      const pairs = new Map<string, RTCIceCandidatePairStats>();
      const candidates = new Map<string, { candidateType?: string }>();

      stats.forEach((report) => {
        if (report.type === "transport") {
          const transport = report as RTCTransportStats;
          selectedPairId = transport.selectedCandidatePairId ?? selectedPairId;
        } else if (report.type === "candidate-pair") {
          const pair = report as RTCIceCandidatePairStats;
          pairs.set(pair.id, pair);
          if (pair.state === "succeeded" && pair.nominated) {
            selectedPairId = selectedPairId ?? pair.id;
          }
        } else if (report.type === "local-candidate" || report.type === "remote-candidate") {
          candidates.set(report.id, report as { candidateType?: string });
        }
      });

      const pair = selectedPairId ? pairs.get(selectedPairId) : undefined;
      const local = pair?.localCandidateId ? candidates.get(pair.localCandidateId) : undefined;
      const type = local?.candidateType ?? null;

      if (type && entry.candidateType !== type) {
        entry.candidateType = type;
        this.publish();
      }
    } catch {
      // getStats is best-effort diagnostics.
    }
  }

  private safeSend(channel: RTCDataChannel, payload: string): boolean {
    try {
      channel.send(payload);
      return true;
    } catch {
      return false;
    }
  }

  private teardown(entry: PeerEntry): void {
    if (entry.candidateFlushTimer !== null) {
      window.clearTimeout(entry.candidateFlushTimer);
      entry.candidateFlushTimer = null;
    }
    entry.outgoingCandidates = [];

    for (const channel of [entry.control, entry.bulk]) {
      channel.onopen = null;
      channel.onclose = null;
      channel.onmessage = null;
      channel.onbufferedamountlow = null;
      try {
        channel.close();
      } catch {
        // Already closed.
      }
    }

    const { connection } = entry;
    connection.onnegotiationneeded = null;
    connection.onicecandidate = null;
    connection.ontrack = null;
    connection.onconnectionstatechange = null;
    connection.oniceconnectionstatechange = null;

    try {
      connection.close();
    } catch {
      // Already closed.
    }

    entry.stream = null;
    entry.state = "closed";
  }

  private publish(): void {
    this.snapshot = {
      peers: [...this.peers.values()].map((entry) => ({
        id: entry.id,
        name: entry.name,
        color: colorForPeer(entry.id),
        state: entry.state,
        ready: entry.control.readyState === "open",
        bulkReady: entry.bulk.readyState === "open",
        stream: entry.stream,
        candidateType: entry.candidateType,
        trackEpoch: entry.trackEpoch,
      })),
    };

    for (const listener of this.listeners) {
      listener();
    }
  }
}

function mapConnectionState(state: RTCPeerConnectionState): PeerLinkState {
  switch (state) {
    case "connected":
      return "connected";
    case "connecting":
    case "new":
      return "connecting";
    case "disconnected":
      return "reconnecting";
    case "failed":
      return "failed";
    case "closed":
      return "closed";
    default:
      return "connecting";
  }
}
