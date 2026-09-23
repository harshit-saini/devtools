"use client";

import { AlertTriangle, Loader2, ShieldCheck, Wifi } from "lucide-react";
import styles from "./PeerList.module.css";
import { hasTurnServer } from "@/lib/webrtc/config";
import { colorForPeer, initialsOf } from "@/lib/webrtc/roomCode";
import type { MeshPeerView, PeerLinkState } from "@/lib/webrtc/peerMesh";

type PeerListProps = {
  selfId: string | null;
  selfName: string;
  peers: readonly MeshPeerView[];
  /** Extra detail per peer, e.g. "typing" or "camera off". */
  detailFor?(peer: MeshPeerView): string | null;
  selfDetail?: string | null;
};

const STATE_LABELS: Record<PeerLinkState, string> = {
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  failed: "Could not connect",
  closed: "Left",
};

export default function PeerList({
  selfId,
  selfName,
  peers,
  detailFor,
  selfDetail,
}: PeerListProps) {
  const failed = peers.filter((peer) => peer.state === "failed");
  const relayed = peers.filter((peer) => peer.candidateType === "relay");

  return (
    <section className={`${styles.panel} panel`}>
      <header className={styles.header}>
        <h3 className={styles.title}>In this room</h3>
        <span className="statusChip">{peers.length + (selfId ? 1 : 0)}</span>
      </header>

      <ul className={styles.list}>
        {selfId && (
          <li className={styles.row}>
            <span className={styles.avatar} style={{ background: colorForPeer(selfId) }}>
              {initialsOf(selfName)}
            </span>
            <span className={styles.details}>
              <span className={styles.name}>{selfName || "You"}</span>
              <span className={styles.meta}>You{selfDetail ? ` - ${selfDetail}` : ""}</span>
            </span>
          </li>
        )}

        {peers.map((peer) => {
          const detail = detailFor?.(peer);

          return (
            <li key={peer.id} className={styles.row}>
              <span className={styles.avatar} style={{ background: peer.color }}>
                {initialsOf(peer.name || peer.id)}
              </span>
              <span className={styles.details}>
                <span className={styles.name}>{peer.name || "Joining..."}</span>
                <span className={styles.meta}>
                  {peer.state === "connecting" && <Loader2 size={12} className={styles.spin} />}
                  {peer.state === "connected" && peer.candidateType !== "relay" && (
                    <ShieldCheck size={12} />
                  )}
                  {peer.state === "connected" && peer.candidateType === "relay" && (
                    <Wifi size={12} />
                  )}
                  {(peer.state === "failed" || peer.state === "reconnecting") && (
                    <AlertTriangle size={12} />
                  )}
                  {STATE_LABELS[peer.state]}
                  {peer.state === "connected" && peer.candidateType === "relay" && " via relay"}
                  {peer.state === "connected" && !peer.ready && " - opening channel"}
                  {detail ? ` - ${detail}` : ""}
                </span>
              </span>
            </li>
          );
        })}

        {peers.length === 0 && (
          <li className={styles.empty}>
            No one else yet. Share the room code or the invite link.
          </li>
        )}
      </ul>

      {failed.length > 0 && (
        <p className={styles.warning}>
          {failed.length === 1 ? "A peer" : `${failed.length} peers`} could not be reached
          directly. That usually means one side is behind a strict NAT or a corporate firewall,
          which a direct connection cannot cross.
          {hasTurnServer()
            ? " The configured TURN relay did not help either."
            : " Configuring a TURN relay (NEXT_PUBLIC_TURN_URLS) is what fixes this."}
        </p>
      )}

      {relayed.length > 0 && (
        <p className="helperText">
          {relayed.length === 1 ? "One connection is" : `${relayed.length} connections are`} going
          through a TURN relay rather than directly, which adds latency.
        </p>
      )}
    </section>
  );
}
