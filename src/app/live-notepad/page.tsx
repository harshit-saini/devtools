"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, Eraser, NotebookPen, Users2 } from "lucide-react";
import styles from "./live-notepad.module.css";
import PeerList from "@/components/PeerList";
import PeerRoomBar, { usePersistedDisplayName } from "@/components/PeerRoomBar";
import ToolFullscreenButton from "@/components/ToolFullscreenButton";
import { useToolFullscreen } from "@/components/useToolFullscreen";
import { LogootDocument, type TextOp } from "@/lib/webrtc/logoot";
import { usePeerSession } from "@/lib/webrtc/peerSession";
import { batchOps, type ControlMessage } from "@/lib/webrtc/protocol";
import {
  anchorCaret,
  describeSelection,
  diffTextChange,
  lineAndColumn,
  resolveCaret,
  resolveSelection,
  type CaretAnchor,
} from "@/lib/webrtc/textOps";

const TOOL_PATH = "/live-notepad";
/** Presence is cosmetic, so it is rate limited well below the typing rate. */
const PRESENCE_INTERVAL_MS = 120;
const TYPING_IDLE_MS = 1500;

/**
 * A peer's cursor, already resolved to a line and column.
 *
 * Resolving on arrival rather than at render time is deliberate: the document is a mutable store
 * held in a ref, so a memo that read it during render would not recompute when it changed. Peers
 * send presence continuously while they are active, so the displayed position stays current.
 */
type PeerPresence = {
  line: number;
  column: number;
  selected: number;
  typing: boolean;
};

export default function LiveNotepad() {
  const { containerRef, isFullscreen, fullscreenSupported, toggleFullscreen } =
    useToolFullscreen<HTMLDivElement>();
  const [displayName, setDisplayName] = usePersistedDisplayName();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /**
   * The replicated document. It lives in a ref because it is a mutable store that must survive
   * every re-render; `text` below is the rendered projection of it.
   */
  const documentRef = useRef<LogootDocument | null>(null);
  const [text, setText] = useState("");
  const [presence, setPresence] = useState<Record<string, PeerPresence>>({});
  const [notice, setNotice] = useState("");

  // Set while a remote patch is being written into the textarea, so the resulting change event is
  // not mistaken for something the user typed.
  const applyingRemoteRef = useRef(false);
  // The value the textarea held last time we looked, which is what a change is diffed against.
  const previousValueRef = useRef("");
  // Caret anchored to a character rather than an offset, so a remote edit above it does not drag
  // it along; restored in a layout effect after the value is written back.
  const pendingCaretRef = useRef<{ anchor: CaretAnchor; head: CaretAnchor } | null>(null);
  const compositionRef = useRef(false);
  // Remote ops that arrived mid-composition. Writing into the textarea while an IME is composing
  // cancels the composition and can lose the half-typed characters, so they wait.
  const deferredOpsRef = useRef<TextOp[]>([]);
  const presenceSentAtRef = useRef(0);
  const presenceTimerRef = useRef<number | null>(null);
  const typingTimerRef = useRef<number | null>(null);

  const ensureDocument = useCallback((site: string): LogootDocument => {
    if (!documentRef.current) {
      documentRef.current = new LogootDocument({ site });
    }
    return documentRef.current;
  }, []);

  const broadcastRef = useRef<(message: ControlMessage) => void>(() => {});
  const sendRef = useRef<(peerId: string, message: ControlMessage) => boolean>(() => false);

  /** Sends ops in batches, because one message per edit can exceed the channel's size limit. */
  const broadcastOps = useCallback((ops: readonly TextOp[]) => {
    for (const batch of batchOps(ops)) {
      broadcastRef.current({ type: "doc-ops", ops: batch });
    }
  }, []);

  const applyRemoteOps = useCallback((ops: readonly TextOp[]) => {
    const document = documentRef.current;
    if (!document) {
      return;
    }

    if (compositionRef.current) {
      deferredOpsRef.current.push(...ops);
      return;
    }

    const element = textareaRef.current;
    const isFocused = element !== null && document !== null && element === window.document.activeElement;

    // Anchor before applying: afterwards the character the caret sat next to may have moved.
    const caret = isFocused
      ? {
          anchor: anchorCaret(document, element.selectionStart ?? 0),
          head: anchorCaret(document, element.selectionEnd ?? 0),
        }
      : null;

    if (!document.applyAll(ops)) {
      return;
    }

    applyingRemoteRef.current = true;
    pendingCaretRef.current = caret;
    const next = document.text();
    previousValueRef.current = next;
    setText(next);
  }, []);

  const session = usePeerSession({
    displayName,
    onControlMessage: (peerId, message) => {
      switch (message.type) {
        case "doc-ops":
          applyRemoteOps(message.ops);
          break;

        case "doc-request": {
          // A peer that just joined wants the current document. Insert ops are idempotent and
          // order-independent, so the whole document is just a (batched) op stream.
          const document = documentRef.current;
          if (document) {
            for (const batch of batchOps(document.toInsertOps())) {
              sendRef.current(peerId, { type: "doc-ops", ops: batch });
            }
          }
          break;
        }

        case "presence": {
          const document = documentRef.current;
          if (!document) {
            break;
          }

          const cursor = message.cursor;
          const range = cursor ? resolveSelection(document, cursor) : null;
          const position = range ? lineAndColumn(document.text(), range.end) : null;

          setPresence((current) => ({
            ...current,
            [peerId]: {
              line: position?.line ?? 1,
              column: position?.column ?? 1,
              selected: range ? range.end - range.start : 0,
              typing: message.typing,
            },
          }));
          break;
        }

        default:
          break;
      }
    },
    onPeerReady: (peerId) => {
      const document = documentRef.current;
      // The peer with content sends it; a peer that has none asks for it. Both can happen at once
      // and still converge, since the ops merge.
      if (document && document.length > 0) {
        for (const batch of batchOps(document.toInsertOps())) {
          sendRef.current(peerId, { type: "doc-ops", ops: batch });
        }
      } else {
        sendRef.current(peerId, { type: "doc-request" });
      }
    },
    onPeerRemoved: (peerId) => {
      setPresence((current) => {
        if (!(peerId in current)) {
          return current;
        }
        const next = { ...current };
        delete next[peerId];
        return next;
      });
    },
  });

  useEffect(() => {
    broadcastRef.current = session.broadcast;
    sendRef.current = session.send;
  });

  // The document's site id must be this peer's id, because that is what makes concurrent
  // positions unique, and it is only known once a room has been joined. Recreated per room so a
  // note never leaks from one room into the next.
  useEffect(() => {
    if (session.selfId) {
      ensureDocument(session.selfId);
    }
  }, [ensureDocument, session.selfId, session.room]);

  /** Discards the previous room's note. Called from the actions that change rooms. */
  const resetDocument = useCallback(() => {
    documentRef.current = null;
    previousValueRef.current = "";
    deferredOpsRef.current = [];
    setText("");
    setPresence({});
  }, []);

  const handleJoin = useCallback(
    (room: string) => {
      resetDocument();
      session.join(room);
    },
    [resetDocument, session],
  );

  const handleLeave = useCallback(() => {
    resetDocument();
    session.leave();
  }, [resetDocument, session]);

  // Restoring the caret must happen before the browser paints, or the caret visibly jumps.
  useLayoutEffect(() => {
    if (!applyingRemoteRef.current) {
      return;
    }
    applyingRemoteRef.current = false;

    const element = textareaRef.current;
    const document = documentRef.current;
    const caret = pendingCaretRef.current;
    pendingCaretRef.current = null;

    if (!element || !document || !caret) {
      return;
    }

    const start = resolveCaret(document, caret.anchor);
    const end = resolveCaret(document, caret.head);
    element.setSelectionRange(start, end);
  }, [text]);

  useEffect(() => {
    if (!notice) {
      return;
    }
    const timeoutId = window.setTimeout(() => setNotice(""), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  useEffect(() => {
    return () => {
      if (presenceTimerRef.current !== null) {
        window.clearTimeout(presenceTimerRef.current);
      }
      if (typingTimerRef.current !== null) {
        window.clearTimeout(typingTimerRef.current);
      }
    };
  }, []);

  const sendPresence = useCallback((typing: boolean) => {
    const element = textareaRef.current;
    const document = documentRef.current;
    if (!element || !document) {
      return;
    }

    const cursor = describeSelection(
      document,
      element.selectionStart ?? 0,
      element.selectionEnd ?? 0,
    );
    broadcastRef.current({ type: "presence", cursor, typing });
  }, []);

  /** Throttles presence so a fast typist does not flood the channel behind the actual edits. */
  const schedulePresence = useCallback(
    (typing: boolean) => {
      const now = Date.now();
      const elapsed = now - presenceSentAtRef.current;

      if (elapsed >= PRESENCE_INTERVAL_MS) {
        presenceSentAtRef.current = now;
        sendPresence(typing);
        return;
      }

      if (presenceTimerRef.current === null) {
        presenceTimerRef.current = window.setTimeout(() => {
          presenceTimerRef.current = null;
          presenceSentAtRef.current = Date.now();
          sendPresence(typing);
        }, PRESENCE_INTERVAL_MS - elapsed);
      }
    },
    [sendPresence],
  );

  const markTyping = useCallback(() => {
    schedulePresence(true);

    if (typingTimerRef.current !== null) {
      window.clearTimeout(typingTimerRef.current);
    }
    typingTimerRef.current = window.setTimeout(() => {
      typingTimerRef.current = null;
      sendPresence(false);
    }, TYPING_IDLE_MS);
  }, [schedulePresence, sendPresence]);

  const handleChange = (value: string) => {
    const document = documentRef.current;
    if (!document) {
      // Without a joined room there is no replica to edit; the textarea is read-only then.
      return;
    }

    // A composing IME reports intermediate values that are not real edits yet; committing them
    // would send characters the user has not chosen.
    if (compositionRef.current) {
      setText(value);
      return;
    }

    const element = textareaRef.current;
    const change = diffTextChange(previousValueRef.current, value, element?.selectionStart ?? undefined);
    previousValueRef.current = value;
    setText(value);

    if (!change) {
      return;
    }

    const ops = document.replaceRange(change.start, change.end, change.inserted);
    broadcastOps(ops);
    markTyping();
  };

  const handleCompositionEnd = (value: string) => {
    compositionRef.current = false;

    const document = documentRef.current;
    if (!document) {
      return;
    }

    const change = diffTextChange(previousValueRef.current, value);
    previousValueRef.current = value;

    if (change) {
      broadcastOps(document.replaceRange(change.start, change.end, change.inserted));
    }

    // Remote ops held back during composition can be applied now.
    const deferred = deferredOpsRef.current;
    deferredOpsRef.current = [];
    if (deferred.length > 0) {
      applyRemoteOps(deferred);
    } else if (change) {
      setText(document.text());
      previousValueRef.current = document.text();
    }

    markTyping();
  };

  const handleClear = () => {
    const document = documentRef.current;
    if (!document || document.length === 0) {
      return;
    }
    if (!window.confirm("Clear the shared note for everyone in this room?")) {
      return;
    }

    const ops = document.clear();
    broadcastOps(ops);
    previousValueRef.current = "";
    setText("");
    setNotice("Shared note cleared");
  };

  const handleCopy = async () => {
    if (!text) {
      setNotice("Nothing to copy");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Copied to clipboard");
    } catch {
      setNotice("Clipboard copy failed");
    }
  };

  const handleDownload = () => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `${session.room ?? "shared"}-note.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const stats = useMemo(() => {
    const trimmed = text.trim();
    return {
      words: trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length,
      lines: text.length === 0 ? 0 : text.split(/\r?\n/).length,
      characters: text.length,
    };
  }, [text]);

  const activeEditors = Object.values(presence).filter((entry) => entry.typing).length;

  return (
    <div
      ref={containerRef}
      className={`${styles.container} pageShell animate-enter ${isFullscreen ? "toolFullscreen" : ""}`}
    >
      <header className="toolHeader">
        <div>
          <div className="toolTitleRow">
            <span className="toolIconBadge">
              <NotebookPen size={22} />
            </span>
            <div>
              <h2 className="toolTitle">Live Notepad</h2>
              <p className="toolSubtitle">
                A shared note that several people edit at once, synced peer-to-peer. Everyone&apos;s
                caret is visible, and concurrent edits merge instead of overwriting each other.
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
          <button className="btn btnSecondary" onClick={handleCopy} disabled={!text}>
            <Copy size={15} />
            Copy
          </button>
          <button className="btn btnSecondary" onClick={handleDownload} disabled={!text}>
            <Download size={15} />
            Download
          </button>
          <button className="btn btnDanger" onClick={handleClear} disabled={!text}>
            <Eraser size={15} />
            Clear
          </button>
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
        onJoin={handleJoin}
        onLeave={handleLeave}
      />

      <div className="toolMetaRow">
        <span className="statusChip">Words: {stats.words}</span>
        <span className="statusChip">Lines: {stats.lines}</span>
        <span className="statusChip">Characters: {stats.characters}</span>
        {activeEditors > 0 && (
          <span className={styles.liveChip}>
            <Users2 size={13} />
            {activeEditors === 1 ? "1 person typing" : `${activeEditors} people typing`}
          </span>
        )}
        {notice && <span className={styles.notice}>{notice}</span>}
        <span role="status" aria-live="polite" className={styles.srOnly}>
          {notice}
        </span>
      </div>

      <div className={styles.workspace}>
        <section className={`${styles.editorCard} panel`}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={text}
            onChange={(event) => handleChange(event.target.value)}
            onCompositionStart={() => {
              compositionRef.current = true;
            }}
            onCompositionEnd={(event) => handleCompositionEnd(event.currentTarget.value)}
            onSelect={() => schedulePresence(false)}
            onBlur={() => sendPresence(false)}
            placeholder={
              session.room
                ? "Start typing. Everyone in this room sees it as you type."
                : "Join a room to start a shared note."
            }
            spellCheck={false}
            readOnly={!session.room}
            aria-label="Shared note"
          />
        </section>

        <div className={styles.side}>
          <PeerList
            selfId={session.selfId}
            selfName={session.selfName}
            peers={session.peers}
            detailFor={(peer) => {
              const entry = presence[peer.id];
              if (!entry) {
                return null;
              }

              const where = `line ${entry.line}, col ${entry.column}`;
              if (entry.typing) {
                return `typing at ${where}`;
              }
              if (entry.selected > 0) {
                return `${entry.selected} selected at ${where}`;
              }
              return `at ${where}`;
            }}
          />

          <section className={`${styles.help} panel`}>
            <h3 className={styles.helpTitle}>How the merge works</h3>
            <p className="helperText">
              Every character carries an identifier that orders it against every other, so two
              people typing in the same place both keep their text and every browser ends up with
              the same result. Nothing is sent to a server: edits travel straight to the other
              browsers.
            </p>
            <p className="helperText">
              The note lives only in the open tabs. It is not saved anywhere, and it is gone once
              everyone leaves - download it if you need to keep it.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
