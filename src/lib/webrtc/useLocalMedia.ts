"use client";

/**
 * Camera, microphone, and screen capture for the video tool.
 *
 * Two behaviours here are deliberate and worth stating, because the alternatives are subtly wrong:
 *
 * - Turning the camera off calls `track.stop()` and re-acquires on the way back on, rather than
 *   just setting `track.enabled = false`. A disabled track still holds the device, so the camera
 *   indicator light stays on - which users reasonably read as "it is still recording me". A
 *   stopped track can never be restarted, hence the re-acquire.
 * - Screen sharing *replaces* the outgoing camera track rather than adding a second one. One
 *   video track per peer keeps the tile layout and the sender bookkeeping simple, and swapping
 *   through `replaceTrack` needs no renegotiation at all.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { isDisplayMediaSupported, isUserMediaSupported } from "./config";

export type MediaErrorKind =
  | "denied"
  | "not-found"
  | "in-use"
  | "unsupported"
  | "insecure"
  | "failed";

export type MediaError = {
  readonly kind: MediaErrorKind;
  readonly message: string;
};

export type LocalMediaState = {
  readonly stream: MediaStream | null;
  readonly cameraOn: boolean;
  readonly microphoneOn: boolean;
  readonly screenOn: boolean;
  readonly error: MediaError | null;
  readonly busy: boolean;
};

/**
 * Maps a getUserMedia rejection to something a person can act on. The distinction matters: "you
 * denied permission" and "another app has the camera" need completely different responses, and
 * both surface as a rejected promise.
 */
export function describeMediaError(error: unknown): MediaError {
  const name = error instanceof Error ? error.name : "";

  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return {
        kind: "denied",
        message:
          "Camera and microphone access was blocked. Allow it in your browser's site settings, then try again.",
      };
    case "NotFoundError":
    case "DevicesNotFoundError":
      return { kind: "not-found", message: "No camera or microphone was found on this device." };
    case "NotReadableError":
    case "TrackStartError":
      return {
        kind: "in-use",
        message: "Your camera or microphone is already in use by another application.",
      };
    case "OverconstrainedError":
      return { kind: "failed", message: "The selected device does not support these settings." };
    case "SecurityError":
      return {
        kind: "insecure",
        message: "Media capture needs a secure page. Use HTTPS, or run this on localhost.",
      };
    case "AbortError":
      return { kind: "failed", message: "Media capture was interrupted. Try again." };
    default:
      return { kind: "failed", message: "Could not start your camera or microphone." };
  }
}

export type UseLocalMediaOptions = {
  /** Called whenever the track that should be sent to peers changes. */
  onVideoTrackChanged?(track: MediaStreamTrack | null): void;
  onStreamChanged?(stream: MediaStream | null): void;
};

export function useLocalMedia(options: UseLocalMediaOptions = {}) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [microphoneOn, setMicrophoneOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [error, setError] = useState<MediaError | null>(null);
  const [busy, setBusy] = useState(false);

  // The stream and the screen track are mutable device handles, so they live in refs; render state
  // only mirrors them for display.
  const streamRef = useRef<MediaStream | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);

  const publishStream = useCallback((next: MediaStream | null) => {
    streamRef.current = next;
    setStream(next);
    optionsRef.current.onStreamChanged?.(next);
  }, []);

  const ensureStream = useCallback((): MediaStream => {
    if (streamRef.current) {
      return streamRef.current;
    }
    const created = new MediaStream();
    publishStream(created);
    return created;
  }, [publishStream]);

  /** Everything that must happen to fully release a device. */
  const stopTrack = useCallback((track: MediaStreamTrack | null) => {
    if (!track) {
      return;
    }
    track.onended = null;
    track.stop();
    streamRef.current?.removeTrack(track);
  }, []);

  const start = useCallback(
    async (want: { video: boolean; audio: boolean }) => {
      if (!isUserMediaSupported()) {
        setError({
          kind: "unsupported",
          message:
            "This browser will not expose your camera here. That usually means the page is not served over HTTPS or localhost.",
        });
        return;
      }

      setBusy(true);
      try {
        const captured = await navigator.mediaDevices.getUserMedia({
          video: want.video ? { width: { ideal: 1280 }, height: { ideal: 720 } } : false,
          audio: want.audio ? { echoCancellation: true, noiseSuppression: true } : false,
        });

        const target = ensureStream();

        for (const track of captured.getTracks()) {
          if (track.kind === "video") {
            stopTrack(cameraTrackRef.current);
            cameraTrackRef.current = track;
            // While a screen share is up it owns the outgoing video track, so a camera acquired
            // now is held locally until the share stops.
            if (!screenTrackRef.current) {
              target.addTrack(track);
              optionsRef.current.onVideoTrackChanged?.(track);
            }
            setCameraOn(true);
          } else {
            target.addTrack(track);
            setMicrophoneOn(true);
          }
        }

        setError(null);
        // A new track list means the stream object's contents changed; React needs a new reference.
        publishStream(new MediaStream(target.getTracks()));
      } catch (caught) {
        setError(describeMediaError(caught));
      } finally {
        setBusy(false);
      }
    },
    [ensureStream, publishStream, stopTrack],
  );

  const startCall = useCallback(() => start({ video: true, audio: true }), [start]);

  const toggleCamera = useCallback(async () => {
    if (!cameraOn) {
      await start({ video: true, audio: false });
      return;
    }

    // Stopping rather than disabling is what actually turns the camera light off.
    stopTrack(cameraTrackRef.current);
    cameraTrackRef.current = null;
    setCameraOn(false);

    if (!screenTrackRef.current) {
      optionsRef.current.onVideoTrackChanged?.(null);
    }
    publishStream(streamRef.current ? new MediaStream(streamRef.current.getTracks()) : null);
  }, [cameraOn, publishStream, start, stopTrack]);

  const toggleMicrophone = useCallback(async () => {
    const audioTrack = streamRef.current?.getAudioTracks()[0] ?? null;

    if (!audioTrack) {
      await start({ video: false, audio: true });
      return;
    }

    // Audio has no device indicator to worry about, so a plain enable/disable is right here: it
    // keeps the track (and therefore the transceiver) in place, so unmuting is instant.
    audioTrack.enabled = !audioTrack.enabled;
    setMicrophoneOn(audioTrack.enabled);
  }, [start]);

  const stopScreenShare = useCallback(() => {
    const screenTrack = screenTrackRef.current;
    if (!screenTrack) {
      return;
    }

    screenTrackRef.current = null;
    stopTrack(screenTrack);
    setScreenOn(false);

    // Hand the outgoing video slot back to the camera if it is still running.
    const camera = cameraTrackRef.current;
    if (camera && camera.readyState === "live") {
      streamRef.current?.addTrack(camera);
      optionsRef.current.onVideoTrackChanged?.(camera);
    } else {
      cameraTrackRef.current = null;
      setCameraOn(false);
      optionsRef.current.onVideoTrackChanged?.(null);
    }

    publishStream(streamRef.current ? new MediaStream(streamRef.current.getTracks()) : null);
  }, [publishStream, stopTrack]);

  const startScreenShare = useCallback(async () => {
    if (!isDisplayMediaSupported()) {
      setError({ kind: "unsupported", message: "This browser cannot share a screen here." });
      return;
    }

    setBusy(true);
    try {
      // getDisplayMedia must be reached from the user's click with no intervening await, or the
      // browser treats it as programmatic and rejects it.
      const captured = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 } },
        audio: false,
      });

      const [screenTrack] = captured.getVideoTracks();
      if (!screenTrack) {
        setError({ kind: "failed", message: "No screen track was returned." });
        return;
      }

      const target = ensureStream();
      const camera = cameraTrackRef.current;
      if (camera) {
        // The camera keeps running but stops being the published track.
        target.removeTrack(camera);
      }

      screenTrackRef.current = screenTrack;
      target.addTrack(screenTrack);
      setScreenOn(true);
      setError(null);
      optionsRef.current.onVideoTrackChanged?.(screenTrack);
      publishStream(new MediaStream(target.getTracks()));

      // The browser's own "Stop sharing" bar bypasses our UI entirely, so the only reliable way to
      // notice it is the track ending.
      screenTrack.onended = () => stopScreenShare();
    } catch (caught) {
      // Dismissing the picker rejects with NotAllowedError; that is a choice, not an error.
      const described = describeMediaError(caught);
      setError(described.kind === "denied" ? null : described);
    } finally {
      setBusy(false);
    }
  }, [ensureStream, publishStream, stopScreenShare]);

  const toggleScreenShare = useCallback(async () => {
    if (screenOn) {
      stopScreenShare();
      return;
    }
    await startScreenShare();
  }, [screenOn, startScreenShare, stopScreenShare]);

  const stopAll = useCallback(() => {
    stopTrack(screenTrackRef.current);
    screenTrackRef.current = null;
    stopTrack(cameraTrackRef.current);
    cameraTrackRef.current = null;

    // Any track the stream still holds - a microphone, or one swapped out earlier - is released
    // here, because a track that is merely detached keeps its device open.
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.onended = null;
      track.stop();
    }

    publishStream(null);
    setCameraOn(false);
    setMicrophoneOn(false);
    setScreenOn(false);
    optionsRef.current.onVideoTrackChanged?.(null);
  }, [publishStream, stopTrack]);

  // Releasing devices on unmount is not optional: a navigation away with the camera still open
  // leaves the indicator light on until the tab is closed.
  useEffect(() => {
    return () => {
      const screenTrack = screenTrackRef.current;
      const cameraTrack = cameraTrackRef.current;
      const active = streamRef.current;

      for (const track of [screenTrack, cameraTrack, ...(active?.getTracks() ?? [])]) {
        if (track) {
          track.onended = null;
          track.stop();
        }
      }

      screenTrackRef.current = null;
      cameraTrackRef.current = null;
      streamRef.current = null;
    };
  }, []);

  const state: LocalMediaState = { stream, cameraOn, microphoneOn, screenOn, error, busy };

  return {
    ...state,
    startCall,
    toggleCamera,
    toggleMicrophone,
    toggleScreenShare,
    stopAll,
    clearError: useCallback(() => setError(null), []),
  };
}
