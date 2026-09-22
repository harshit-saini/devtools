"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Copy, Dices, Link2, LogOut, Users } from "lucide-react";
import styles from "./PeerRoomBar.module.css";
import { useIsMountedOnClient } from "@/lib/useLocalStorageState";
import { isSecureContextAvailable, isWebRtcSupported, signalingUrl } from "@/lib/webrtc/config";
import {
  buildShareLink,
  extractRoomCode,
  generateRoomCode,
  normalizeRoomCode,
  readRoomHash,
  suggestDisplayName,
} from "@/lib/webrtc/roomCode";
import { MAX_NAME_LENGTH } from "@/lib/webrtc/protocol";
import type { SessionError } from "@/lib/webrtc/peerSession";
import type { SignalingStatus } from "@/lib/webrtc/signaling";

const NAME_KEY = "devtools.peer.displayName";

type PeerRoomBarProps = {
  /** Route this tool lives at, used to build the share link. */
  toolPath: string;
  status: SignalingStatus;
  room: string | null;
  peerCount: number;
  error: SessionError | null;
  displayName: string;
  onDisplayNameChange(name: string): void;
  onJoin(room: string): void;
  onLeave(): void;
  /** Tool-specific controls, shown once a room is joined. */
  children?: ReactNode;
};

const STATUS_LABELS: Record<SignalingStatus, string> = {
  idle: "Not connected",
  connecting: "Connecting to signaling server...",
  connected: "Signaling server connected",
  joined: "In room",
  reconnecting: "Reconnecting...",
  closed: "Disconnected",
  failed: "Connection failed",
};

/**
 * Restores a display name from localStorage once, then keeps it as ordinary state.
 *
 * Deliberately not `useLocalStorageState`: that hook re-seeds from localStorage whenever the
 * stored value differs from its seed, and the store is only written in an effect. For a text
 * field that lag is destructive - a render triggered by keystroke N sees the value written for
 * keystroke N-1, decides the store has changed underneath it, and resets the field, so every
 * other character typed is discarded. It works for the sidebar's toggle because that writes
 * localStorage synchronously alongside setState.
 *
 * The fallback name is generated only once the component is known to be on the client, because it
 * is random: producing it during the server render would guarantee a hydration mismatch.
 */
export function usePersistedDisplayName(): [string, (value: string) => void] {
  const mounted = useIsMountedOnClient();
  const [name, setName] = useState("");
  const [restored, setRestored] = useState(false);

  if (mounted && !restored) {
    setRestored(true);
    setName(window.localStorage.getItem(NAME_KEY) || suggestDisplayName());
  }

  useEffect(() => {
    if (!restored) {
      return;
    }
    window.localStorage.setItem(NAME_KEY, name);
  }, [restored, name]);

  return [name, setName];
}

export default function PeerRoomBar({
  toolPath,
  status,
  room,
  peerCount,
  error,
  displayName,
  onDisplayNameChange,
  onJoin,
  onLeave,
  children,
}: PeerRoomBarProps) {
  const [codeInput, setCodeInput] = useState("");
  const [notice, setNotice] = useState("");
  const mounted = useIsMountedOnClient();

  // Browser capabilities and the current URL are unknowable during the server render, so they are
  // derived once the component is known to be on the client rather than stored in state.
  const support = useMemo(
    () => (mounted ? { secure: isSecureContextAvailable(), webrtc: isWebRtcSupported() } : null),
    [mounted],
  );

  const shareLink = useMemo(
    () => (mounted && room ? buildShareLink(window.location.origin, toolPath, room) : ""),
    [mounted, room, toolPath],
  );

  // An invite link carries its room code in the fragment, which is never sent to a server. Seeding
  // the input from it uses React's documented "adjust state while rendering" pattern rather than
  // an effect, since the field stays freely editable afterwards.
  const [seededFromLink, setSeededFromLink] = useState(false);
  if (mounted && !seededFromLink) {
    setSeededFromLink(true);
    const fromLink = readRoomHash(window.location.hash);
    if (fromLink) {
      setCodeInput(fromLink);
    }
  }

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timeoutId = window.setTimeout(() => setNotice(""), 2200);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const normalizedInput = useMemo(() => extractRoomCode(codeInput), [codeInput]);
  const connecting = status === "connecting" || status === "reconnecting";

  const handleGenerate = () => {
    const code = generateRoomCode();
    setCodeInput(code);
    setNotice("New room code ready to share");
  };

  const handleJoin = () => {
    if (!normalizedInput) {
      setNotice("Enter a room code of at least 3 letters, digits, or hyphens");
      return;
    }
    onJoin(normalizedInput);
  };

  const handleCopy = async (value: string, message: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(message);
    } catch {
      setNotice("Clipboard copy failed");
    }
  };

  if (support && (!support.secure || !support.webrtc)) {
    return (
      <section className={`${styles.bar} panel`}>
        <p className={styles.blocked}>
          {!support.webrtc
            ? "This browser does not support WebRTC, so peer-to-peer connections are unavailable."
            : "Peer-to-peer connections need a secure page. Open this tool over HTTPS, or on localhost, and reload."}
        </p>
      </section>
    );
  }

  return (
    <section className={`${styles.bar} panel`}>
      {room ? (
        <div className={styles.joinedRow}>
          <div className={styles.roomBlock}>
            <p className={styles.label}>Room</p>
            <div className={styles.roomCode}>
              <code>{room}</code>
              <button
                className="btn btnGhost"
                onClick={() => handleCopy(room, "Room code copied")}
                title="Copy the room code"
              >
                <Copy size={14} />
                Code
              </button>
              <button
                className="btn btnGhost"
                onClick={() => handleCopy(shareLink, "Invite link copied")}
                title="Copy an invite link"
                disabled={!shareLink}
              >
                <Link2 size={14} />
                Invite link
              </button>
            </div>
          </div>

          <label className={styles.nameField}>
            <span className={styles.label}>You are</span>
            <input
              className="textInput"
              value={displayName}
              onChange={(event) => onDisplayNameChange(event.target.value)}
              maxLength={MAX_NAME_LENGTH}
              aria-label="Your display name"
            />
          </label>

          <div className={styles.joinedActions}>
            {children}
            <button className="btn btnDanger" onClick={onLeave}>
              <LogOut size={15} />
              Leave
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.joinRow}>
          <label className={styles.nameField}>
            <span className={styles.label}>Your name</span>
            <input
              className="textInput"
              value={displayName}
              onChange={(event) => onDisplayNameChange(event.target.value)}
              placeholder="Shown to everyone in the room"
              maxLength={MAX_NAME_LENGTH}
            />
          </label>

          <label className={styles.codeField}>
            <span className={styles.label}>Room code or invite link</span>
            <input
              className="textInput"
              value={codeInput}
              onChange={(event) => setCodeInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  handleJoin();
                }
              }}
              placeholder="swift-otter-meadow-481920"
              spellCheck={false}
            />
          </label>

          <div className={styles.joinActions}>
            <button className="btn btnSecondary" onClick={handleGenerate}>
              <Dices size={15} />
              New code
            </button>
            <button
              className="btn btnPrimary"
              onClick={handleJoin}
              disabled={!normalizedInput || connecting}
            >
              <Users size={15} />
              {connecting ? "Connecting..." : "Join room"}
            </button>
          </div>
        </div>
      )}

      <div className="toolMetaRow">
        <span className="statusChip">{STATUS_LABELS[status]}</span>
        {room && (
          <span className="statusChip">
            {peerCount === 0 ? "Waiting for someone to join" : `${peerCount + 1} in room`}
          </span>
        )}
        {!room && <span className="statusChip">Signaling: {signalingUrl()}</span>}
        {normalizedInput && !room && normalizedInput !== codeInput.trim().toLowerCase() && (
          <span className="statusChip">Will join as {normalizedInput}</span>
        )}
        {notice && <span className={styles.notice}>{notice}</span>}
        {error && <span className={styles.error}>{error.message}</span>}
        <span role="status" aria-live="polite" className={styles.srOnly}>
          {error?.message ?? notice}
        </span>
      </div>

      {!room && (
        <p className="helperText">
          Anyone with the room code can join, so share it only with the people you mean to. Media,
          files, and notes travel directly between browsers - the signaling server only introduces
          peers and never sees the content. Connecting also reveals your IP address to the other
          peers, as any direct connection does.
        </p>
      )}
    </section>
  );
}

export { normalizeRoomCode };
