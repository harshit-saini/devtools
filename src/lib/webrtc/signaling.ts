/**
 * WebSocket client for the `peer-server` signaling protocol.
 *
 * The server only relays SDP and ICE between peers in a room; once a connection is up it is not
 * involved at all. This client therefore has two jobs: keep a socket alive (with backoff, since a
 * dropped socket is recoverable and shouldn't end the session), and turn the protocol's JSON into
 * validated, typed events.
 */

import { MAX_NAME_LENGTH, sanitizeLine } from "./protocol";

export type RoomPeer = {
  readonly id: string;
  readonly name: string;
};

export type SignalingStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "joined"
  | "reconnecting"
  | "closed"
  | "failed";

/**
 * What peers send each other through the relay.
 *
 * Candidates are sent in batches: a full mesh of 8 peers gathers well over a hundred candidates,
 * and one relay message each would run into the server's per-connection message rate limit.
 */
export type SignalPayload =
  | { kind: "description"; description: RTCSessionDescriptionInit }
  | { kind: "candidates"; candidates: (RTCIceCandidateInit | null)[] };

/**
 * Upper bound on candidates in one relayed batch. Exported so the sender splits on exactly the
 * limit the receiver enforces: a batch over the limit is rejected whole, which would silently
 * drop the candidates a connection needs.
 */
export const MAX_CANDIDATES_PER_BATCH = 64;

export type JoinedPayload = {
  id: string;
  room: string;
  name: string;
  peers: RoomPeer[];
  /**
   * True when this join arrived on a socket that replaced the one the previous join used.
   *
   * The two cases look identical in the payload but mean opposite things to the mesh. A re-join
   * on the same socket (a rename) is invisible to the other peers, so their connections are
   * intact. A join on a new socket is announced to the room as an arrival, so every other peer
   * has already torn its connection down and is waiting for a fresh offer from us.
   */
  reconnected: boolean;
};

export type SignalingHandlers = {
  onJoined(payload: JoinedPayload): void;
  onPeerJoined(peer: RoomPeer): void;
  onPeerLeft(peerId: string): void;
  onSignal(from: string, payload: SignalPayload): void;
  onStatus(status: SignalingStatus): void;
  /** `fatal` marks errors that will not resolve by retrying, such as a full room. */
  onError(error: { code: string; message: string; fatal: boolean }): void;
};

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 10_000];
/** Errors that mean "this join will never succeed", so the client stops instead of looping. */
const FATAL_ERROR_CODES = new Set(["invalid-room", "room-full"]);
const MAX_SDP_LENGTH = 200_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates a relayed payload. It reaches us from another browser by way of the server, so a
 * malformed or hostile description must be rejected before it is handed to RTCPeerConnection.
 */
export function parseSignalPayload(value: unknown): SignalPayload | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.kind === "description") {
    const description = value.description;
    if (!isRecord(description)) {
      return null;
    }

    const { type, sdp } = description;
    if (type !== "offer" && type !== "answer" && type !== "pranswer" && type !== "rollback") {
      return null;
    }
    if (type !== "rollback" && (typeof sdp !== "string" || sdp.length === 0 || sdp.length > MAX_SDP_LENGTH)) {
      return null;
    }

    return {
      kind: "description",
      description: { type, sdp: typeof sdp === "string" ? sdp : undefined },
    };
  }

  if (value.kind === "candidates") {
    if (!Array.isArray(value.candidates) || value.candidates.length > MAX_CANDIDATES_PER_BATCH) {
      return null;
    }

    const candidates: (RTCIceCandidateInit | null)[] = [];
    for (const entry of value.candidates) {
      // A null entry is the standard end-of-candidates marker and is forwarded as-is.
      if (entry === null) {
        candidates.push(null);
        continue;
      }
      if (!isRecord(entry)) {
        return null;
      }

      const { candidate, sdpMid, sdpMLineIndex, usernameFragment } = entry;
      if (typeof candidate !== "string" || candidate.length > 1000) {
        return null;
      }

      candidates.push({
        candidate,
        sdpMid: typeof sdpMid === "string" ? sdpMid : undefined,
        sdpMLineIndex: typeof sdpMLineIndex === "number" ? sdpMLineIndex : undefined,
        usernameFragment: typeof usernameFragment === "string" ? usernameFragment : undefined,
      });
    }

    return { kind: "candidates", candidates };
  }

  return null;
}

function parseRoomPeer(value: unknown): RoomPeer | null {
  if (!isRecord(value)) {
    return null;
  }
  const { id, name } = value;
  if (typeof id !== "string" || id.length === 0 || id.length > 128) {
    return null;
  }
  // The server scrubs names too, but this value is rendered in our UI and reaches us by relay
  // from another peer, so it goes through the same sanitizer as every other peer-supplied string.
  return { id, name: sanitizeLine(name, MAX_NAME_LENGTH) };
}

export class SignalingClient {
  private socket: WebSocket | null = null;
  private status: SignalingStatus = "idle";
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private closedByCaller = false;
  /** The room to (re)join as soon as a socket is open. */
  private pendingRoom: { room: string; name: string } | null = null;
  private assignedId: string | null = null;
  /** Incremented per socket, so a join can be attributed to the connection that carried it. */
  private socketGeneration = 0;
  private joinedGeneration: number | null = null;

  constructor(
    private readonly url: string,
    private readonly handlers: SignalingHandlers,
  ) {}

  get peerId(): string | null {
    return this.assignedId;
  }

  /** Opens the socket (if needed) and joins `room`. Safe to call again to change rooms. */
  join(room: string, name: string): void {
    this.closedByCaller = false;
    this.pendingRoom = { room, name };

    if (this.socket?.readyState === WebSocket.OPEN) {
      this.sendJoin();
      return;
    }

    this.connect();
  }

  signal(target: string, payload: SignalPayload): void {
    this.send({ type: "signal", target, data: payload });
  }

  /** Leaves the room but keeps the socket, so the user can join another room. */
  leave(): void {
    this.pendingRoom = null;
    this.assignedId = null;
    this.joinedGeneration = null;
    // Otherwise a leave during a reconnect backoff leaves the timer armed, and the client
    // reconnects to a room the user has already left.
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    this.send({ type: "leave" });
    this.setStatus(this.socket?.readyState === WebSocket.OPEN ? "connected" : "idle");
  }

  /** Tears everything down. The client is not reusable afterwards. */
  close(): void {
    this.closedByCaller = true;
    this.pendingRoom = null;
    this.assignedId = null;
    this.clearReconnectTimer();

    const socket = this.socket;
    this.socket = null;

    if (socket) {
      // Drop the handlers first so the close event cannot schedule a reconnect.
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;

      if (socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify({ type: "leave" }));
        } catch {
          // The socket is going away regardless.
        }
      }
      socket.close();
    }

    this.setStatus("closed");
  }

  private connect(): void {
    this.clearReconnectTimer();
    this.setStatus(this.reconnectAttempt === 0 ? "connecting" : "reconnecting");

    this.socketGeneration += 1;

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch {
      this.handlers.onError({
        code: "bad-url",
        message: `Could not open a connection to ${this.url}`,
        fatal: true,
      });
      this.setStatus("failed");
      return;
    }

    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) {
        return;
      }
      this.reconnectAttempt = 0;
      this.setStatus("connected");
      if (this.pendingRoom) {
        this.sendJoin();
      }
    };

    socket.onmessage = (event) => {
      if (this.socket === socket) {
        this.handleMessage(event.data);
      }
    };

    socket.onerror = () => {
      // 'close' always follows, and carries the information worth acting on.
    };

    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;

      if (this.closedByCaller) {
        return;
      }

      // The assigned id is deliberately kept: re-joining with it is what lets the server hand
      // this peer its own identity back, so the other peers recognise it instead of tearing the
      // whole mesh down and rebuilding it. It is only forgotten on an explicit leave or close.
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempt += 1;
    this.setStatus("reconnecting");

    // Jitter keeps a roomful of clients from all retrying on the same tick.
    const jittered = delay + Math.floor(Math.random() * 250);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, jittered);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private sendJoin(): void {
    if (!this.pendingRoom) {
      return;
    }
    // Reusing the previously assigned id keeps this peer recognisable across a reconnect when the
    // server has already released it.
    this.send({
      type: "join",
      room: this.pendingRoom.room,
      name: this.pendingRoom.name,
      ...(this.assignedId ? { id: this.assignedId } : {}),
    });
  }

  private send(message: Record<string, unknown>): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    try {
      this.socket.send(JSON.stringify(message));
    } catch {
      // A failed send means the socket is already gone; the close handler will reconnect.
    }
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== "string") {
      return;
    }

    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      return;
    }

    if (!isRecord(value) || typeof value.type !== "string") {
      return;
    }

    switch (value.type) {
      case "joined": {
        const { id, room, name, peers } = value;
        if (typeof id !== "string" || typeof room !== "string") {
          return;
        }
        this.assignedId = id;
        const roster = Array.isArray(peers)
          ? peers.map(parseRoomPeer).filter((peer): peer is RoomPeer => peer !== null)
          : [];

        const reconnected =
          this.joinedGeneration !== null && this.joinedGeneration !== this.socketGeneration;
        this.joinedGeneration = this.socketGeneration;

        this.setStatus("joined");
        this.handlers.onJoined({
          id,
          room,
          name: sanitizeLine(name, MAX_NAME_LENGTH),
          peers: roster,
          reconnected,
        });
        break;
      }

      case "registered": {
        if (typeof value.id === "string") {
          this.assignedId = value.id;
        }
        break;
      }

      case "peer-joined": {
        const peer = parseRoomPeer(value);
        if (peer) {
          this.handlers.onPeerJoined(peer);
        }
        break;
      }

      case "peer-left":
      case "peer-disconnected": {
        if (typeof value.id === "string") {
          this.handlers.onPeerLeft(value.id);
        }
        break;
      }

      case "signal": {
        const payload = parseSignalPayload(value.data);
        if (payload && typeof value.from === "string") {
          this.handlers.onSignal(value.from, payload);
        }
        break;
      }

      case "error": {
        const code = typeof value.code === "string" ? value.code : "unknown";
        const message = typeof value.message === "string" ? value.message : "Signaling error";
        const fatal = FATAL_ERROR_CODES.has(code);

        if (fatal) {
          // Stop trying to re-join a room we can never get into.
          this.pendingRoom = null;
          this.setStatus("failed");
        }

        this.handlers.onError({ code, message, fatal });
        break;
      }

      default:
        break;
    }
  }

  private setStatus(status: SignalingStatus): void {
    if (this.status === status) {
      return;
    }
    this.status = status;
    this.handlers.onStatus(status);
  }
}
