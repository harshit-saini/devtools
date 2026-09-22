"use client";

/**
 * Binds the signaling client and the peer mesh into one session, and exposes it to React.
 *
 * The controller below is a plain class with a `subscribe`/`getSnapshot` pair, and the hook reads
 * it through `useSyncExternalStore`. That split matters for two reasons: the WebRTC objects must
 * live outside render state (they are mutable and must never be recreated by a re-render), and the
 * whole thing has to survive React's strict mode mounting every effect twice - so the session is
 * created inside an effect and genuinely destroyed by its cleanup, with no "did I already
 * initialise?" guard, which would leak the first instance instead of tearing it down.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { iceServers, signalingUrl } from "./config";
import { PeerMesh, type MeshPeerView } from "./peerMesh";
import { MAX_NAME_LENGTH, sanitizeLine, type ControlMessage } from "./protocol";
import { colorForPeer } from "./roomCode";
import {
  SignalingClient,
  type JoinedPayload,
  type SignalPayload,
  type SignalingStatus,
} from "./signaling";
import type { ChunkFrame } from "./fileTransfer";

export type SessionError = {
  readonly code: string;
  readonly message: string;
  readonly fatal: boolean;
};

export type SessionSnapshot = {
  readonly status: SignalingStatus;
  readonly room: string | null;
  readonly selfId: string | null;
  readonly selfName: string;
  readonly peers: readonly MeshPeerView[];
  readonly error: SessionError | null;
};

/** Errors that describe a peer that is already gone, rather than anything the user can act on. */
const TRANSIENT_ERROR_CODES = new Set(["target-not-found", "target-not-in-room"]);

const EMPTY_SNAPSHOT: SessionSnapshot = {
  status: "idle",
  room: null,
  selfId: null,
  selfName: "",
  peers: [],
  error: null,
};

export type SessionHandlers = {
  onControlMessage?(peerId: string, message: ControlMessage): void;
  onBulkChunk?(peerId: string, frame: ChunkFrame): void;
  /** Fires once a peer's control channel is open and its `hello` has been sent. */
  onPeerReady?(peerId: string): void;
  onPeerRemoved?(peerId: string): void;
  onBulkDrain?(peerId: string): void;
};

export type PeerSessionControllerOptions = {
  displayName: string;
  withMedia: boolean;
  /** Read through a getter so the controller always calls the latest render's handlers. */
  handlers(): SessionHandlers;
};

export class PeerSessionController {
  private readonly signaling: SignalingClient;
  private mesh: PeerMesh | null = null;
  private unsubscribeMesh: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();

  private status: SignalingStatus = "idle";
  private room: string | null = null;
  private selfId: string | null = null;
  private displayName: string;
  private error: SessionError | null = null;
  private snapshot: SessionSnapshot = EMPTY_SNAPSHOT;
  private closed = false;

  constructor(private readonly options: PeerSessionControllerOptions) {
    this.displayName = options.displayName;

    this.signaling = new SignalingClient(signalingUrl(), {
      onJoined: (payload) => this.handleJoined(payload),
      onPeerJoined: (peer) => this.mesh?.addPeer(peer, false),
      onPeerLeft: (peerId) => {
        this.mesh?.removePeer(peerId);
      },
      onSignal: (from, payload) => {
        void this.mesh?.handleSignal(from, payload);
      },
      onStatus: (status) => {
        this.status = status;
        this.publish();
      },
      onError: (error) => {
        // A relay rejection for a peer that has just left is routine churn, not something to put
        // in front of the user - and it names a raw peer id, which means nothing to them.
        if (TRANSIENT_ERROR_CODES.has(error.code)) {
          return;
        }
        this.error = error;
        this.publish();
      },
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): SessionSnapshot => this.snapshot;

  /** The mesh, once a room has been joined. Tools use it for media and bulk sends. */
  get peerMesh(): PeerMesh | null {
    return this.mesh;
  }

  setDisplayName(name: string): void {
    const sanitized = sanitizeLine(name, MAX_NAME_LENGTH);
    if (sanitized === this.displayName) {
      return;
    }

    this.displayName = sanitized;
    this.publish();

    // Already in a room: tell peers directly rather than re-joining, so nobody's connection is
    // disturbed by a rename.
    if (this.room) {
      this.mesh?.broadcastControl(this.hello());
    }
  }

  join(room: string): void {
    if (this.closed) {
      return;
    }
    this.error = null;
    this.signaling.join(room, this.displayName);
  }

  leave(): void {
    this.tearDownMesh();
    this.signaling.leave();
    this.room = null;
    this.selfId = null;
    this.error = null;
    this.publish();
  }

  broadcast(message: ControlMessage): void {
    this.mesh?.broadcastControl(message);
  }

  send(peerId: string, message: ControlMessage): boolean {
    return this.mesh?.sendControl(peerId, message) ?? false;
  }

  close(): void {
    this.closed = true;
    this.tearDownMesh();
    this.signaling.close();
    this.listeners.clear();
  }

  private handleJoined({ id, room, name, peers, reconnected }: JoinedPayload): void {
    if (this.closed) {
      return;
    }

    // Whether the existing connections can be kept.
    //
    // A re-join on the same socket - a rename - is invisible to the other peers, so tearing the
    // mesh down would drop working connections for nothing. A join on a *new* socket is the
    // opposite: the server announced us to the room as an arrival, so every other peer has
    // already destroyed its connection to us and is sitting waiting for a fresh offer. Keeping
    // our side in that case leaves both ends stuck - they wait for an offer we think we have
    // already made - and the link stays dead until someone leaves and rejoins by hand.
    const isSameSession = !reconnected && this.selfId === id && this.room === room;

    this.selfId = id;
    this.room = room;
    // Getting in clears whatever went wrong on the way.
    this.error = null;
    if (name) {
      this.displayName = name;
    }

    if (!isSameSession || !this.mesh) {
      this.tearDownMesh();
      this.mesh = this.createMesh(id);
      this.unsubscribeMesh = this.mesh.subscribe(() => this.publish());
    }

    const mesh = this.mesh;
    const known = new Set(mesh.peerIds);

    // The roster holds exactly the peers that were already here, so this peer owns the first offer
    // to each of them; peers that arrive later offer to us instead.
    for (const peer of peers) {
      if (known.has(peer.id)) {
        mesh.renamePeer(peer.id, peer.name);
        continue;
      }
      mesh.addPeer(peer, true);
    }

    // Anyone in the mesh who is no longer in the roster left while we were away.
    for (const peerId of known) {
      if (!peers.some((peer) => peer.id === peerId)) {
        mesh.removePeer(peerId);
      }
    }

    this.publish();
  }

  private createMesh(selfId: string): PeerMesh {
    return new PeerMesh({
      selfId,
      iceServers: iceServers(),
      withMedia: this.options.withMedia,
      callbacks: {
        sendSignal: (target: string, payload: SignalPayload) => {
          this.signaling.signal(target, payload);
        },
        onControlMessage: (peerId, message) => {
          // A peer's own name is authoritative for display once it introduces itself; the server
          // name is only the initial value, which is what makes mid-session renames work.
          if (message.type === "hello" && message.name) {
            this.mesh?.renamePeer(peerId, message.name);
          }
          this.options.handlers().onControlMessage?.(peerId, message);
        },
        onBulkChunk: (peerId, frame) => {
          this.options.handlers().onBulkChunk?.(peerId, frame);
        },
        onPeerReady: (peerId) => {
          this.mesh?.sendControl(peerId, this.hello());
          this.options.handlers().onPeerReady?.(peerId);
        },
        onPeerRemoved: (peerId) => {
          this.options.handlers().onPeerRemoved?.(peerId);
        },
        onBulkDrain: (peerId) => {
          this.options.handlers().onBulkDrain?.(peerId);
        },
      },
    });
  }

  private hello(): ControlMessage {
    return {
      type: "hello",
      name: this.displayName,
      color: this.selfId ? colorForPeer(this.selfId) : "",
    };
  }

  private tearDownMesh(): void {
    this.unsubscribeMesh?.();
    this.unsubscribeMesh = null;
    this.mesh?.close();
    this.mesh = null;
  }

  private publish(): void {
    this.snapshot = {
      status: this.status,
      room: this.room,
      selfId: this.selfId,
      selfName: this.displayName,
      peers: this.mesh?.getSnapshot().peers ?? [],
      error: this.error,
    };

    for (const listener of this.listeners) {
      listener();
    }
  }
}

const noopSubscribe = () => () => {};
const emptySnapshot = () => EMPTY_SNAPSHOT;

export type PeerSession = SessionSnapshot & {
  /** Null until the session's effect has run, i.e. until after the first render. */
  readonly controller: PeerSessionController | null;
  readonly mesh: PeerMesh | null;
  join(room: string): void;
  leave(): void;
  setDisplayName(name: string): void;
  broadcast(message: ControlMessage): void;
  send(peerId: string, message: ControlMessage): boolean;
};

export type UsePeerSessionOptions = SessionHandlers & {
  displayName: string;
  withMedia?: boolean;
};

export function usePeerSession(options: UsePeerSessionOptions): PeerSession {
  const { displayName, withMedia = false } = options;

  // Handlers change identity on most renders. Keeping them in a ref that the controller reads
  // through a getter avoids both stale closures and recreating the session on every render. The
  // ref is synced in an effect rather than during render, which React requires.
  const handlersRef = useRef<SessionHandlers>(options);
  useEffect(() => {
    handlersRef.current = options;
  });

  // Only read inside the mount effect below, so useRef's initial value is exactly what is wanted:
  // the name as of the first render. Later edits go through setDisplayName instead of rebuilding
  // the session.
  const displayNameRef = useRef(displayName);

  const [controller, setController] = useState<PeerSessionController | null>(null);

  useEffect(() => {
    const instance = new PeerSessionController({
      displayName: displayNameRef.current,
      withMedia,
      handlers: () => handlersRef.current,
    });

    setController(instance);

    // Leaving the page should release the room slot promptly rather than waiting for the server's
    // heartbeat to notice. `persisted` distinguishes the two cases pagehide covers: a real
    // navigation or tab close, where the session is finished, from the page being frozen into the
    // back/forward cache, where closing it would leave an inert tool behind on restore. A frozen
    // page's socket is dropped by the browser anyway, and the reconnect backoff picks it up.
    const handlePageHide = (event: PageTransitionEvent) => {
      if (!event.persisted) {
        instance.close();
      }
    };
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      instance.close();
      setController((current) => (current === instance ? null : current));
    };
    // withMedia is fixed per tool, so this runs once per mount. displayName is applied through
    // the effect below instead, so a keystroke in the name field never rebuilds the session.
  }, [withMedia]);

  useEffect(() => {
    controller?.setDisplayName(displayName);
  }, [controller, displayName]);

  const snapshot = useSyncExternalStore(
    controller?.subscribe ?? noopSubscribe,
    controller?.getSnapshot ?? emptySnapshot,
    emptySnapshot,
  );

  const join = useCallback(
    (room: string) => {
      controller?.join(room);
    },
    [controller],
  );

  const leave = useCallback(() => {
    controller?.leave();
  }, [controller]);

  const setDisplayNameCallback = useCallback(
    (name: string) => {
      controller?.setDisplayName(name);
    },
    [controller],
  );

  const broadcast = useCallback(
    (message: ControlMessage) => {
      controller?.broadcast(message);
    },
    [controller],
  );

  const send = useCallback(
    (peerId: string, message: ControlMessage) => controller?.send(peerId, message) ?? false,
    [controller],
  );

  return useMemo(
    () => ({
      ...snapshot,
      controller,
      mesh: controller?.peerMesh ?? null,
      join,
      leave,
      setDisplayName: setDisplayNameCallback,
      broadcast,
      send,
    }),
    [snapshot, controller, join, leave, setDisplayNameCallback, broadcast, send],
  );
}
