"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  PhoneCall,
  PhoneOff,
  SendHorizontal,
  Video,
  VideoOff,
} from "lucide-react";
import styles from "./meet.module.css";
import PeerList from "@/components/PeerList";
import PeerRoomBar, { usePersistedDisplayName } from "@/components/PeerRoomBar";
import PeerVideo from "@/components/PeerVideo";
import ToolFullscreenButton from "@/components/ToolFullscreenButton";
import { useToolFullscreen } from "@/components/useToolFullscreen";
import { isDisplayMediaSupported } from "@/lib/webrtc/config";
import { usePeerSession } from "@/lib/webrtc/peerSession";
import { MAX_CHAT_LENGTH, sanitizeChatText, type MediaState } from "@/lib/webrtc/protocol";
import { colorForPeer, initialsOf } from "@/lib/webrtc/roomCode";
import { useLocalMedia } from "@/lib/webrtc/useLocalMedia";

const TOOL_PATH = "/meet";

type ChatEntry = {
  id: string;
  peerId: string | null;
  author: string;
  text: string;
  sentAt: number;
};

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function Meet() {
  const { containerRef, isFullscreen, fullscreenSupported, toggleFullscreen } =
    useToolFullscreen<HTMLDivElement>();
  const [displayName, setDisplayName] = usePersistedDisplayName();

  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [peerMedia, setPeerMedia] = useState<Record<string, MediaState>>({});
  const [notice, setNotice] = useState("");
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const chatCounterRef = useRef(0);

  const media = useLocalMedia({
    // One path for every media change. The mesh swaps tracks with replaceTrack where it can, so
    // starting a screen share mid-call needs no renegotiation.
    onStreamChanged: (stream) => {
      void meshRef.current?.setLocalStream(stream);
    },
  });

  const session = usePeerSession({
    displayName,
    withMedia: true,
    onControlMessage: (peerId, message) => {
      switch (message.type) {
        case "chat":
          setChat((current) => [
            ...current,
            {
              id: `${peerId}:${message.message.id}`,
              peerId,
              author: "",
              text: message.message.text,
              sentAt: message.message.sentAt,
            },
          ]);
          break;

        case "media-state":
          setPeerMedia((current) => ({ ...current, [peerId]: message.state }));
          break;

        default:
          break;
      }
    },
    onPeerReady: () => {
      // A peer that just connected has no idea what our camera is doing.
      broadcastMediaStateRef.current();
    },
    onPeerRemoved: (peerId) => {
      setPeerMedia((current) => {
        if (!(peerId in current)) {
          return current;
        }
        const next = { ...current };
        delete next[peerId];
        return next;
      });
    },
  });

  const meshRef = useRef<typeof session.mesh>(null);
  useEffect(() => {
    meshRef.current = session.mesh;
  }, [session.mesh]);

  // A newly created mesh has no tracks yet, so the current stream is published to it.
  useEffect(() => {
    if (session.mesh && media.stream) {
      void session.mesh.setLocalStream(media.stream);
    }
  }, [session.mesh, media.stream]);

  const broadcastMediaStateRef = useRef<() => void>(() => {});
  useEffect(() => {
    broadcastMediaStateRef.current = () => {
      session.broadcast({
        type: "media-state",
        // Signalled explicitly rather than inferred from the remote track: a track can read as
        // muted for reasons that have nothing to do with the user's choice.
        state: {
          camera: media.cameraOn && !media.screenOn,
          microphone: media.microphoneOn,
          screen: media.screenOn,
        },
      });
    };
  });

  useEffect(() => {
    broadcastMediaStateRef.current();
  }, [media.cameraOn, media.microphoneOn, media.screenOn]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timeoutId = window.setTimeout(() => setNotice(""), 2400);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  // Keep the transcript pinned to the newest message.
  useEffect(() => {
    const element = chatScrollRef.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [chat]);

  const handleSend = () => {
    const text = sanitizeChatText(draft);
    if (!text) {
      return;
    }

    chatCounterRef.current += 1;
    const message = {
      id: `${session.selfId ?? "self"}-${chatCounterRef.current}`,
      text,
      sentAt: Date.now(),
    };

    session.broadcast({ type: "chat", message });
    setChat((current) => [
      ...current,
      { id: `self:${message.id}`, peerId: null, author: displayName, text, sentAt: message.sentAt },
    ]);
    setDraft("");
  };

  const handleLeave = useCallback(() => {
    media.stopAll();
    setChat([]);
    setPeerMedia({});
    session.leave();
  }, [media, session]);

  const handleScreenShare = () => {
    if (!isDisplayMediaSupported()) {
      setNotice("This browser cannot share a screen");
      return;
    }
    // Reached straight from the click, with no await before it, or the browser rejects the request
    // as not user-initiated.
    void media.toggleScreenShare();
  };

  const nameFor = useCallback(
    (peerId: string | null) => {
      if (peerId === null) {
        return displayName || "You";
      }
      return session.peers.find((peer) => peer.id === peerId)?.name || "A peer";
    },
    [displayName, session.peers],
  );

  const connectedPeers = useMemo(
    () => session.peers.filter((peer) => peer.state === "connected"),
    [session.peers],
  );

  // Whether media is open at all, rather than whether anything is currently enabled: a muted
  // microphone with the camera off is still an open call, and collapsing back to "Start camera"
  // there would strand the user with a live microphone and no way to see or stop it.
  const inCall = media.stream !== null;
  const tileCount = connectedPeers.length + (media.stream ? 1 : 0);

  return (
    <div
      ref={containerRef}
      className={`${styles.container} pageShell animate-enter ${isFullscreen ? "toolFullscreen" : ""}`}
    >
      <header className="toolHeader">
        <div>
          <div className="toolTitleRow">
            <span className="toolIconBadge">
              <Video size={22} />
            </span>
            <div>
              <h2 className="toolTitle">Peer Video Chat</h2>
              <p className="toolSubtitle">
                Camera, microphone, screen sharing, and text chat between browsers over a direct
                connection. No account, no room server holding your media.
              </p>
            </div>
          </div>
        </div>

        <div className={styles.actions}>
          <ToolFullscreenButton
            isFullscreen={isFullscreen}
            onToggle={toggleFullscreen}
            supported={fullscreenSupported}
          />
        </div>
      </header>

      <PeerRoomBar
        toolPath={TOOL_PATH}
        status={session.status}
        room={session.room}
        peerCount={session.peers.length}
        error={session.error}
        displayName={displayName}
        onDisplayNameChange={setDisplayName}
        onJoin={session.join}
        onLeave={handleLeave}
      >
        {!inCall ? (
          <button className="btn btnPrimary" onClick={() => void media.startCall()} disabled={media.busy}>
            <PhoneCall size={15} />
            {media.busy ? "Starting..." : "Start camera"}
          </button>
        ) : (
          <>
            <button className="btn btnSecondary" onClick={() => void media.toggleMicrophone()}>
              {media.microphoneOn ? <Mic size={15} /> : <MicOff size={15} />}
              {media.microphoneOn ? "Mute" : "Unmute"}
            </button>
            <button
              className="btn btnSecondary"
              onClick={() => void media.toggleCamera()}
              disabled={media.busy || media.screenOn}
              title={media.screenOn ? "Stop sharing your screen to use the camera" : undefined}
            >
              {media.cameraOn ? <Video size={15} /> : <VideoOff size={15} />}
              {media.cameraOn ? "Camera off" : "Camera on"}
            </button>
            <button className="btn btnSecondary" onClick={handleScreenShare} disabled={media.busy}>
              {media.screenOn ? <MonitorOff size={15} /> : <MonitorUp size={15} />}
              {media.screenOn ? "Stop sharing" : "Share screen"}
            </button>
            <button className="btn btnDanger" onClick={() => media.stopAll()}>
              <PhoneOff size={15} />
              Stop media
            </button>
          </>
        )}
      </PeerRoomBar>

      <div className="toolMetaRow">
        {media.screenOn && <span className={styles.liveChip}>Sharing your screen</span>}
        {inCall && !media.screenOn && (
          <span className="statusChip">
            {media.cameraOn ? "Camera on" : "Camera off"} - {media.microphoneOn ? "Mic on" : "Mic muted"}
          </span>
        )}
        {notice && <span className={styles.notice}>{notice}</span>}
        {media.error && (
          <span className={styles.error}>
            {media.error.message}
            <button className={styles.dismiss} onClick={media.clearError} aria-label="Dismiss">
              &times;
            </button>
          </span>
        )}
        <span role="status" aria-live="polite" className={styles.srOnly}>
          {media.error?.message ?? notice}
        </span>
      </div>

      <div className={styles.workspace}>
        <div className={styles.stageColumn}>
          <section
            className={`${styles.stage} panel`}
            data-tiles={Math.min(tileCount, 4)}
          >
            {media.stream && (
              <PeerVideo
                stream={media.stream}
                label={`${displayName || "You"} (you)`}
                color={session.selfId ? colorForPeer(session.selfId) : "#0f766e"}
                initials={initialsOf(displayName || "You")}
                isLocal
                showVideo={media.cameraOn || media.screenOn}
                badge={media.screenOn ? "Screen" : undefined}
              />
            )}

            {connectedPeers.map((peer) => {
              const state = peerMedia[peer.id];
              return (
                <PeerVideo
                  key={peer.id}
                  stream={peer.stream}
                  label={peer.name || "A peer"}
                  color={peer.color}
                  initials={initialsOf(peer.name || peer.id)}
                  showVideo={state ? state.camera || state.screen : Boolean(peer.stream)}
                  muted={state ? !state.microphone : false}
                  badge={state?.screen ? "Screen" : undefined}
                  trackEpoch={peer.trackEpoch}
                />
              );
            })}

            {tileCount === 0 && (
              <div className={styles.stageEmpty}>
                <p className={styles.stageEmptyTitle}>
                  {session.room ? "Start your camera to join the call" : "Join a room to begin"}
                </p>
                <p className="helperText">
                  You can join a room first and turn your camera on afterwards. Text chat works
                  without any camera at all.
                </p>
              </div>
            )}
          </section>
        </div>

        <div className={styles.side}>
          <section className={`${styles.chat} panel`}>
            <header className={styles.chatHeader}>
              <h3 className={styles.sectionTitle}>Chat</h3>
              <span className="statusChip">{chat.length}</span>
            </header>

            <div className={styles.chatScroll} ref={chatScrollRef}>
              {chat.length === 0 ? (
                <p className={styles.chatEmpty}>
                  Messages go over the same direct connection as the video, so they are not stored
                  anywhere and are gone when you leave.
                </p>
              ) : (
                <ul className={styles.chatList}>
                  {chat.map((entry) => (
                    <li
                      key={entry.id}
                      className={`${styles.chatRow} ${entry.peerId === null ? styles.chatMine : ""}`}
                    >
                      <span className={styles.chatMeta}>
                        <span
                          className={styles.chatAuthor}
                          style={{
                            color: entry.peerId ? colorForPeer(entry.peerId) : "var(--accent-strong)",
                          }}
                        >
                          {entry.peerId === null ? entry.author || "You" : nameFor(entry.peerId)}
                        </span>
                        <span className={styles.chatTime}>{formatTime(entry.sentAt)}</span>
                      </span>
                      <p className={styles.chatText}>{entry.text}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className={styles.chatCompose}>
              <textarea
                className={styles.chatInput}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  // Enter sends, Shift+Enter makes a new line - the convention people expect.
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={session.room ? "Message everyone in the room" : "Join a room to chat"}
                rows={2}
                maxLength={MAX_CHAT_LENGTH}
                disabled={!session.room}
                aria-label="Chat message"
              />
              <button
                className="btn btnPrimary"
                onClick={handleSend}
                disabled={!session.room || sanitizeChatText(draft).length === 0}
              >
                <SendHorizontal size={15} />
                Send
              </button>
            </div>
          </section>

          <PeerList
            selfId={session.selfId}
            selfName={session.selfName}
            peers={session.peers}
            selfDetail={
              media.screenOn
                ? "sharing screen"
                : inCall
                  ? `${media.cameraOn ? "camera on" : "camera off"}, ${media.microphoneOn ? "mic on" : "muted"}`
                  : "no media"
            }
            detailFor={(peer) => {
              const state = peerMedia[peer.id];
              if (!state) {
                return null;
              }
              if (state.screen) {
                return "sharing screen";
              }
              return `${state.camera ? "camera on" : "camera off"}, ${
                state.microphone ? "mic on" : "muted"
              }`;
            }}
          />
        </div>
      </div>
    </div>
  );
}
