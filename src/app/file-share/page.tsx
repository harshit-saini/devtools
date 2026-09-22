"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Download,
  FileUp,
  Send,
  ShieldCheck,
  Share2,
  X,
} from "lucide-react";
import styles from "./file-share.module.css";
import PeerList from "@/components/PeerList";
import PeerRoomBar, { usePersistedDisplayName } from "@/components/PeerRoomBar";
import ToolFullscreenButton from "@/components/ToolFullscreenButton";
import { useToolFullscreen } from "@/components/useToolFullscreen";
import { FileSession, type Transfer, type TransferStatus } from "@/lib/webrtc/fileSession";
import {
  MAX_TRANSFER_BYTES,
  formatBytes,
  formatDuration,
  formatRate,
} from "@/lib/webrtc/fileTransfer";
import { usePeerSession } from "@/lib/webrtc/peerSession";

const TOOL_PATH = "/file-share";
const EVERYONE = "everyone";

const STATUS_LABELS: Record<TransferStatus, string> = {
  hashing: "Checksumming...",
  offered: "Waiting for a decision",
  declined: "Declined",
  transferring: "Transferring",
  verifying: "Verifying",
  complete: "Complete",
  corrupt: "Checksum mismatch",
  cancelled: "Cancelled",
  failed: "Failed",
};

export default function FileShare() {
  const { containerRef, isFullscreen, fullscreenSupported, toggleFullscreen } =
    useToolFullscreen<HTMLDivElement>();
  const [displayName, setDisplayName] = usePersistedDisplayName();

  const [transfers, setTransfers] = useState<Record<string, Transfer>>({});
  const [recipient, setRecipient] = useState<string>(EVERYONE);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Constructed exactly once per mount, via a useState initializer. The mesh is handed to it
  // separately below, because it does not exist until a room has been joined.
  const [fileSession] = useState(
    () =>
      new FileSession({
        onTransferChanged: (transfer) => {
          setTransfers((current) => ({ ...current, [transfer.key]: transfer }));
        },
      }),
  );

  const session = usePeerSession({
    displayName,
    onControlMessage: (peerId, message) => {
      switch (message.type) {
        case "file-offer":
          fileSession.receiveOffer(peerId, message.offer);
          break;
        case "file-accept":
          fileSession.handleAccept(peerId, message.transferId);
          break;
        case "file-decline":
          fileSession.handleDecline(peerId, message.transferId);
          break;
        case "file-cancel":
          fileSession.handleRemoteCancel(peerId, message.transferId);
          break;
        case "file-complete":
          fileSession.handleComplete(peerId, message.transferId);
          break;
        default:
          break;
      }
    },
    onBulkChunk: (peerId, frame) => {
      void fileSession.handleChunk(peerId, frame);
    },
    onBulkDrain: (peerId) => fileSession.handleDrain(peerId),
    onPeerRemoved: (peerId) => fileSession.abortPeer(peerId),
  });

  // PeerMesh already provides everything TransferTransport asks for, so it is handed over as-is.
  useEffect(() => {
    fileSession.setTransport(session.mesh);
  }, [fileSession, session.mesh]);

  useEffect(() => {
    fileSession.open();
    return () => fileSession.close();
  }, [fileSession]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timeoutId = window.setTimeout(() => setNotice(""), 2400);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  const readyPeers = useMemo(
    () => session.peers.filter((peer) => peer.bulkReady && peer.state === "connected"),
    [session.peers],
  );

  // A recipient who leaves must not stay selected, or files would be sent into a closed channel.
  const activeRecipient =
    recipient !== EVERYONE && readyPeers.some((peer) => peer.id === recipient)
      ? recipient
      : EVERYONE;

  const sendFiles = useCallback(
    async (files: FileList | File[]) => {
      const targets =
        activeRecipient === EVERYONE ? readyPeers.map((peer) => peer.id) : [activeRecipient];

      if (targets.length === 0) {
        setNotice("No connected peer to send to yet");
        return;
      }

      const selected = Array.from(files);
      const tooLarge = selected.filter((file) => file.size > MAX_TRANSFER_BYTES);
      const sendable = selected.filter((file) => file.size <= MAX_TRANSFER_BYTES);

      if (tooLarge.length > 0) {
        setNotice(`Skipped ${tooLarge.length} file over ${formatBytes(MAX_TRANSFER_BYTES)}`);
      }

      for (const file of sendable) {
        for (const peerId of targets) {
          await fileSession.offerFile(peerId, file);
        }
      }
    },
    [activeRecipient, fileSession, readyPeers],
  );

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);

    if (event.dataTransfer.files.length > 0) {
      void sendFiles(event.dataTransfer.files);
    }
  };

  const handlePick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      void sendFiles(files);
    }
    event.target.value = "";
  };

  const handleSave = (transfer: Transfer) => {
    if (!transfer.blobUrl) {
      return;
    }

    const anchor = document.createElement("a");
    anchor.href = transfer.blobUrl;
    anchor.download = transfer.name;
    anchor.click();
    setNotice(`Saved ${transfer.name}`);
  };

  const handleLeave = useCallback(() => {
    setTransfers({});
    fileSession.close();
    fileSession.open();
    session.leave();
  }, [fileSession, session]);

  const rows = useMemo(() => {
    const order: Record<TransferStatus, number> = {
      offered: 0,
      hashing: 1,
      transferring: 2,
      verifying: 3,
      complete: 4,
      corrupt: 5,
      declined: 6,
      cancelled: 7,
      failed: 8,
    };

    return Object.values(transfers).sort((left, right) => {
      const byStatus = order[left.status] - order[right.status];
      return byStatus !== 0 ? byStatus : left.name.localeCompare(right.name);
    });
  }, [transfers]);

  const peerName = (peerId: string) =>
    session.peers.find((peer) => peer.id === peerId)?.name || "a peer";

  const activeCount = rows.filter(
    (transfer) => transfer.status === "transferring" || transfer.status === "hashing",
  ).length;

  return (
    <div
      ref={containerRef}
      className={`${styles.container} pageShell animate-enter ${isFullscreen ? "toolFullscreen" : ""}`}
    >
      <header className="toolHeader">
        <div>
          <div className="toolTitleRow">
            <span className="toolIconBadge">
              <Share2 size={22} />
            </span>
            <div>
              <h2 className="toolTitle">Peer File Share</h2>
              <p className="toolSubtitle">
                Send files straight to another browser. The bytes never touch a server, transfers
                are checksummed end to end, and nothing arrives without the recipient accepting it.
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
          <button
            className="btn btnPrimary"
            onClick={() => fileInputRef.current?.click()}
            disabled={readyPeers.length === 0}
          >
            <FileUp size={15} />
            Choose files
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className={styles.hiddenInput}
            onChange={handlePick}
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
        {readyPeers.length > 1 && (
          <label className={styles.recipientField}>
            <span className={styles.srOnly}>Send to</span>
            <select
              className="textInput"
              value={activeRecipient}
              onChange={(event) => setRecipient(event.target.value)}
            >
              <option value={EVERYONE}>Send to everyone</option>
              {readyPeers.map((peer) => (
                <option key={peer.id} value={peer.id}>
                  Send to {peer.name || "peer"}
                </option>
              ))}
            </select>
          </label>
        )}
      </PeerRoomBar>

      <div className="toolMetaRow">
        <span className="statusChip">
          {readyPeers.length === 0
            ? "No peer ready"
            : `${readyPeers.length} peer${readyPeers.length === 1 ? "" : "s"} ready`}
        </span>
        <span className="statusChip">Max {formatBytes(MAX_TRANSFER_BYTES)} per file</span>
        {activeCount > 0 && <span className="statusChip">{activeCount} in progress</span>}
        {notice && <span className={styles.notice}>{notice}</span>}
        <span role="status" aria-live="polite" className={styles.srOnly}>
          {notice}
        </span>
      </div>

      <div className={styles.workspace}>
        <div className={styles.main}>
          <div
            className={`${styles.dropZone} ${dragging ? styles.dropZoneActive : ""} panelInset`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            <ArrowUpFromLine size={26} className={styles.dropIcon} />
            <p className={styles.dropTitle}>
              {readyPeers.length === 0
                ? "Join a room and wait for a peer to connect"
                : "Drop files here to send them"}
            </p>
            <p className="helperText">
              Files are read in 16 KB chunks and streamed over the peer connection, so a large file
              never has to fit in memory on the sending side.
            </p>
          </div>

          <section className={`${styles.transfers} panel`}>
            <header className={styles.transfersHeader}>
              <h3 className={styles.sectionTitle}>Transfers</h3>
              <span className="statusChip">{rows.length}</span>
            </header>

            {rows.length === 0 ? (
              <p className={styles.empty}>
                Nothing yet. Offers you send and offers you receive both show up here.
              </p>
            ) : (
              <ul className={styles.transferList}>
                {rows.map((transfer) => (
                  <li key={transfer.key} className={`${styles.transferRow} panelInset`}>
                    <div className={styles.transferTop}>
                      <span className={styles.direction}>
                        {transfer.direction === "incoming" ? (
                          <ArrowDownToLine size={15} />
                        ) : (
                          <ArrowUpFromLine size={15} />
                        )}
                      </span>
                      <div className={styles.transferNames}>
                        <span className={styles.fileName}>{transfer.name}</span>
                        <span className={styles.transferMeta}>
                          {formatBytes(transfer.size)}
                          {" - "}
                          {transfer.direction === "incoming" ? "from" : "to"}{" "}
                          {peerName(transfer.peerId)}
                        </span>
                      </div>
                      <span
                        className={`${styles.status} ${
                          transfer.status === "complete"
                            ? styles.statusGood
                            : transfer.status === "corrupt" ||
                                transfer.status === "failed" ||
                                transfer.status === "declined"
                              ? styles.statusBad
                              : ""
                        }`}
                      >
                        {transfer.status === "complete" && <ShieldCheck size={13} />}
                        {STATUS_LABELS[transfer.status]}
                      </span>
                    </div>

                    {(transfer.status === "transferring" || transfer.status === "verifying") && (
                      <>
                        <div className={styles.progressTrack}>
                          <div
                            className={styles.progressFill}
                            style={{ width: `${Math.round(transfer.progress.ratio * 100)}%` }}
                          />
                        </div>
                        <div className={styles.transferMeta}>
                          {Math.round(transfer.progress.ratio * 100)}%
                          {" - "}
                          {formatBytes(transfer.progress.bytesTransferred)} of{" "}
                          {formatBytes(transfer.size)}
                          {" - "}
                          {formatRate(transfer.progress.bytesPerSecond)}
                          {transfer.progress.secondsRemaining !== null &&
                            ` - ${formatDuration(transfer.progress.secondsRemaining)} left`}
                        </div>
                      </>
                    )}

                    {transfer.error && <p className={styles.transferError}>{transfer.error}</p>}

                    <div className={styles.transferActions}>
                      {transfer.direction === "incoming" && transfer.status === "offered" && (
                        <>
                          <button
                            className="btn btnPrimary"
                            onClick={() =>
                              fileSession.acceptOffer(transfer.peerId, transfer.transferId)
                            }
                          >
                            <Check size={14} />
                            Accept
                          </button>
                          <button
                            className="btn btnSecondary"
                            onClick={() =>
                              fileSession.declineOffer(transfer.peerId, transfer.transferId)
                            }
                          >
                            <X size={14} />
                            Decline
                          </button>
                        </>
                      )}

                      {transfer.status === "complete" && transfer.blobUrl && (
                        <button className="btn btnPrimary" onClick={() => handleSave(transfer)}>
                          <Download size={14} />
                          Save
                        </button>
                      )}

                      {(transfer.status === "transferring" ||
                        transfer.status === "hashing" ||
                        (transfer.direction === "outgoing" && transfer.status === "offered")) && (
                        <button
                          className="btn btnDanger"
                          onClick={() =>
                            fileSession.cancel(
                              transfer.peerId,
                              transfer.transferId,
                              transfer.direction,
                            )
                          }
                        >
                          <X size={14} />
                          Cancel
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className={styles.side}>
          <PeerList
            selfId={session.selfId}
            selfName={session.selfName}
            peers={session.peers}
            detailFor={(peer) => (peer.bulkReady ? "ready for files" : null)}
          />

          <section className={`${styles.help} panel`}>
            <h3 className={styles.sectionTitle}>What is verified</h3>
            <p className="helperText">
              Before an offer goes out, the sender hashes the file chunk by chunk and hashes those
              hashes. The receiver repeats the calculation as chunks arrive, so a corrupted,
              missing, or reordered chunk is caught before you are offered a download.
            </p>
            <p className="helperText">
              A received file is held in this tab&apos;s memory until you save it, which is why the
              size is capped at {formatBytes(MAX_TRANSFER_BYTES)}.
            </p>
            <p className="helperText">
              <Send size={12} /> Filenames come from the other peer, so they are stripped of paths
              and anything else that is not a plain name before being offered to your browser.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
