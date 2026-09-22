"use client";

import { useEffect, useRef, useState } from "react";
import { MicOff, Play } from "lucide-react";
import styles from "./PeerVideo.module.css";

type PeerVideoProps = {
  stream: MediaStream | null;
  label: string;
  color: string;
  initials: string;
  /** False when the peer has no video to show, so the avatar is displayed instead. */
  showVideo: boolean;
  isLocal?: boolean;
  muted?: boolean;
  badge?: string;
};

/**
 * One participant tile.
 *
 * `srcObject` is assigned imperatively rather than through a prop because it is not an attribute -
 * React cannot set it - and autoplay needs care: browsers only start a video without a gesture if
 * it is muted, and `play()` can still reject. A rejection surfaces as a tap-to-play overlay rather
 * than a tile that is silently frozen.
 */
export default function PeerVideo({
  stream,
  label,
  color,
  initials,
  showVideo,
  isLocal = false,
  muted = false,
  badge,
}: PeerVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [needsGesture, setNeedsGesture] = useState(false);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) {
      return;
    }

    // Reassigning the same stream restarts playback, so only touch it when it actually changed.
    if (element.srcObject !== stream) {
      element.srcObject = stream;
    }

    if (!stream) {
      return;
    }

    const tryPlay = () => {
      const attempt = element.play();
      if (attempt) {
        attempt.then(
          () => setNeedsGesture(false),
          () => setNeedsGesture(true),
        );
      }
    };

    tryPlay();

    // The peer's stream is mutated in place as tracks arrive - a camera some seconds after a
    // microphone, or a screen share replacing a camera - and the element does not always start
    // rendering a track added after playback began.
    stream.addEventListener("addtrack", tryPlay);

    return () => {
      stream.removeEventListener("addtrack", tryPlay);
      // Dropping the reference on unmount lets the browser release the decoder.
      element.pause();
      element.srcObject = null;
    };
  }, [stream]);

  const handleGesture = () => {
    const attempt = videoRef.current?.play();
    attempt?.then(
      () => setNeedsGesture(false),
      () => setNeedsGesture(true),
    );
  };

  return (
    <div className={styles.tile}>
      <video
        ref={videoRef}
        className={`${styles.video} ${showVideo ? "" : styles.videoHidden} ${
          isLocal ? styles.mirrored : ""
        }`}
        // A local preview must be muted or the user hears themselves with a delay.
        muted={isLocal}
        playsInline
        autoPlay
      />

      {!showVideo && (
        <div className={styles.placeholder}>
          <span className={styles.avatar} style={{ background: color }}>
            {initials}
          </span>
        </div>
      )}

      {needsGesture && !isLocal && (
        <button className={styles.gesture} onClick={handleGesture}>
          <Play size={16} />
          Tap to play
        </button>
      )}

      <div className={styles.footer}>
        <span className={styles.label}>{label}</span>
        {badge && <span className={styles.badge}>{badge}</span>}
        {muted && !isLocal && (
          <span className={styles.mutedIcon} title="Microphone muted">
            <MicOff size={13} />
          </span>
        )}
      </div>
    </div>
  );
}
