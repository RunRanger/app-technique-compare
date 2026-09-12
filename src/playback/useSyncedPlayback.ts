/* eslint-disable react-hooks/immutability -- Driving a video player *is*
 * property assignment: `player.currentTime = t`, `player.muted = m`. An
 * `expo-video` VideoPlayer is a handle to a native object, not React state, and
 * mutating it is the library's documented API. The React Compiler's
 * immutability rule models every value reaching a component as frozen and so
 * reports each of these writes; there is no non-mutating alternative to
 * suppress them individually against. Mutation is confined to this file — every
 * other module in `src/playback` is pure. */

/**
 * Master transport for two `expo-video` players.
 *
 * Responsibilities:
 *   - one play/pause that starts and stops both players together,
 *   - one timeline whose scrubbing drives both, smoothly,
 *   - frame-exact stepping,
 *   - keeping the two decoders aligned during playback (see `syncEngine`).
 *
 * The playhead is exposed through a subscription rather than React state.
 * Re-rendering the whole comparison view — which contains two live video
 * surfaces — at 30 Hz would drop frames; only the small components that display
 * time actually subscribe.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { VideoPlayer } from 'expo-video';

import { DEFAULT_FPS } from '@/types';
import {
  clamp,
  computeTimeline,
  frameDuration,
  masterToClipTimes,
  snapToFrame,
  type Timeline,
} from './timeline';
import {
  DEFAULT_DRIFT_POLICY,
  EXACT_SEEK,
  SCRUB_SEEK,
  evaluateDrift,
  type SeekProfile,
} from './syncEngine';

export interface SyncedPlaybackOptions {
  referencePlayer: VideoPlayer | null;
  comparisonPlayer: VideoPlayer | null;
  referenceDuration: number | null;
  comparisonDuration: number | null;
  offsetSeconds: number;
  /** Frame rate used for stepping. Falls back to 30. */
  fps: number | null;
  playbackRate?: number;
  muted?: boolean;
  /** Called when playback reaches the end of the timeline. */
  onEnded?: () => void;
}

export type TimeListener = (masterTime: number) => void;
export type PlayingListener = (isPlaying: boolean) => void;

export interface SyncedPlayback {
  timeline: Timeline;
  frameStep: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  isPlaying: () => boolean;
  /** Current master time, read synchronously. */
  getTime: () => number;
  /** Seek both players. `exact` forces frame-accurate seeking. */
  seekTo: (masterTime: number, options?: { exact?: boolean }) => void;
  /** Step by whole frames; negative steps go backwards. Pauses playback. */
  stepFrames: (frames: number) => void;
  beginScrub: () => void;
  endScrub: () => void;
  subscribeTime: (listener: TimeListener) => () => void;
  subscribePlaying: (listener: PlayingListener) => () => void;
}

/** How often the playhead is sampled while playing. */
const TICK_MS = 1000 / 30;

export function useSyncedPlayback(options: SyncedPlaybackOptions): SyncedPlayback {
  const {
    referencePlayer,
    comparisonPlayer,
    referenceDuration,
    comparisonDuration,
    offsetSeconds,
    fps,
    playbackRate = 1,
    muted = true,
    onEnded,
  } = options;

  const timeline = useMemo(
    () => computeTimeline(referenceDuration, comparisonDuration, offsetSeconds),
    [referenceDuration, comparisonDuration, offsetSeconds]
  );

  const frameStep = frameDuration(fps ?? DEFAULT_FPS);

  // Mutable state kept in refs: none of it should trigger a re-render.
  const masterTime = useRef(timeline.start);
  const playing = useRef(false);
  const scrubbing = useRef(false);
  const lastCorrectionAt = useRef(0);
  const timeListeners = useRef(new Set<TimeListener>());
  const playingListeners = useRef(new Set<PlayingListener>());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Latest values, so the ticker closure never reads stale ones. Written in an
  // effect rather than during render: a render may be discarded, and a ref
  // written from a discarded render would leave the ticker reading state that
  // never committed.
  const latest = useRef({ timeline, offsetSeconds, referenceDuration, comparisonDuration, onEnded });
  useEffect(() => {
    latest.current = { timeline, offsetSeconds, referenceDuration, comparisonDuration, onEnded };
  }, [timeline, offsetSeconds, referenceDuration, comparisonDuration, onEnded]);

  const emitTime = useCallback((value: number) => {
    masterTime.current = value;
    timeListeners.current.forEach((listener) => listener(value));
  }, []);

  const emitPlaying = useCallback((value: boolean) => {
    playing.current = value;
    playingListeners.current.forEach((listener) => listener(value));
  }, []);

  const applySeekProfile = useCallback(
    (profile: SeekProfile) => {
      for (const player of [referencePlayer, comparisonPlayer]) {
        if (!player) continue;
        try {
          player.seekTolerance = {
            toleranceBefore: profile.toleranceBefore,
            toleranceAfter: profile.toleranceAfter,
          };
          player.scrubbingModeOptions = { scrubbingModeEnabled: profile.scrubbingModeEnabled };
        } catch {
          // Older runtimes may not expose these; exactness degrades, nothing breaks.
        }
      }
    },
    [referencePlayer, comparisonPlayer]
  );

  /** Writes both players to the positions implied by a master time. */
  const applyTime = useCallback(
    (target: number) => {
      const state = latest.current;
      const bounded = clamp(target, state.timeline.start, state.timeline.end);
      const times = masterToClipTimes(
        bounded,
        state.offsetSeconds,
        state.referenceDuration,
        state.comparisonDuration
      );
      if (referencePlayer) referencePlayer.currentTime = times.reference;
      if (comparisonPlayer) comparisonPlayer.currentTime = times.comparison;
      emitTime(bounded);
      return bounded;
    },
    [referencePlayer, comparisonPlayer, emitTime]
  );

  const pause = useCallback(() => {
    referencePlayer?.pause();
    comparisonPlayer?.pause();
    if (playing.current) emitPlaying(false);
  }, [referencePlayer, comparisonPlayer, emitPlaying]);

  const play = useCallback(() => {
    if (!referencePlayer || !comparisonPlayer) return;
    const state = latest.current;

    // Restart from the top when parked at the end, so the button always does
    // something rather than silently no-op'ing.
    if (masterTime.current >= state.timeline.end - 1e-3) {
      applyTime(state.timeline.start);
    }

    applySeekProfile(EXACT_SEEK);
    lastCorrectionAt.current = Date.now();
    // Same tick for both: the closest we can get to a simultaneous start.
    referencePlayer.play();
    comparisonPlayer.play();
    emitPlaying(true);
  }, [referencePlayer, comparisonPlayer, applyTime, applySeekProfile, emitPlaying]);

  const toggle = useCallback(() => {
    if (playing.current) pause();
    else play();
  }, [play, pause]);

  const seekTo = useCallback(
    (target: number, seekOptions?: { exact?: boolean }) => {
      if (seekOptions?.exact) applySeekProfile(EXACT_SEEK);
      applyTime(target);
    },
    [applyTime, applySeekProfile]
  );

  const stepFrames = useCallback(
    (frames: number) => {
      pause();
      applySeekProfile(EXACT_SEEK);
      const state = latest.current;
      // Snap first, so repeated steps cannot accumulate sub-frame error.
      const current = snapToFrame(masterTime.current, fps ?? DEFAULT_FPS);
      const target = clamp(
        current + frames * frameStep,
        state.timeline.start,
        state.timeline.end
      );
      applyTime(snapToFrame(target, fps ?? DEFAULT_FPS));
    },
    [pause, applySeekProfile, applyTime, frameStep, fps]
  );

  const beginScrub = useCallback(() => {
    scrubbing.current = true;
    pause();
    applySeekProfile(SCRUB_SEEK);
  }, [pause, applySeekProfile]);

  const endScrub = useCallback(() => {
    scrubbing.current = false;
    applySeekProfile(EXACT_SEEK);
    // Re-seek exactly: the loose seeks during the drag may have landed off-frame.
    applyTime(masterTime.current);
  }, [applySeekProfile, applyTime]);

  const subscribeTime = useCallback((listener: TimeListener) => {
    timeListeners.current.add(listener);
    listener(masterTime.current);
    return () => {
      timeListeners.current.delete(listener);
    };
  }, []);

  const subscribePlaying = useCallback((listener: PlayingListener) => {
    playingListeners.current.add(listener);
    listener(playing.current);
    return () => {
      playingListeners.current.delete(listener);
    };
  }, []);

  // Playback ticker: advances the reported playhead and corrects drift.
  useEffect(() => {
    if (!referencePlayer || !comparisonPlayer) return;

    intervalRef.current = setInterval(() => {
      if (!playing.current || scrubbing.current) return;
      const state = latest.current;

      const referenceTime = referencePlayer.currentTime;
      const current = clamp(referenceTime, state.timeline.start, state.timeline.end);
      emitTime(current);

      if (referenceTime >= state.timeline.end - 1e-3) {
        pause();
        emitTime(state.timeline.end);
        state.onEnded?.();
        return;
      }

      const decision = evaluateDrift(
        referenceTime,
        comparisonPlayer.currentTime,
        state.offsetSeconds,
        Date.now() - lastCorrectionAt.current,
        DEFAULT_DRIFT_POLICY
      );
      if (decision.correct) {
        comparisonPlayer.currentTime = clamp(
          decision.targetTime,
          0,
          state.comparisonDuration ?? decision.targetTime
        );
        lastCorrectionAt.current = Date.now();
      }
    }, TICK_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
    };
  }, [referencePlayer, comparisonPlayer, emitTime, pause]);

  // Keep rate and mute in step with the session settings.
  useEffect(() => {
    for (const player of [referencePlayer, comparisonPlayer]) {
      if (!player) continue;
      player.playbackRate = playbackRate;
      player.muted = muted;
    }
  }, [referencePlayer, comparisonPlayer, playbackRate, muted]);

  // Comparison audio is never wanted on top of the reference audio.
  useEffect(() => {
    if (comparisonPlayer) comparisonPlayer.muted = true;
  }, [comparisonPlayer]);

  // Changing the offset moves the comparison clip under a stationary playhead.
  useEffect(() => {
    if (!scrubbing.current && !playing.current) {
      applyTime(masterTime.current);
    }
  }, [offsetSeconds, applyTime]);

  // Keep the playhead inside the timeline when it shrinks.
  useEffect(() => {
    const bounded = clamp(masterTime.current, timeline.start, timeline.end);
    if (bounded !== masterTime.current) applyTime(bounded);
  }, [timeline, applyTime]);

  return useMemo(
    () => ({
      timeline,
      frameStep,
      play,
      pause,
      toggle,
      isPlaying: () => playing.current,
      getTime: () => masterTime.current,
      seekTo,
      stepFrames,
      beginScrub,
      endScrub,
      subscribeTime,
      subscribePlaying,
    }),
    [
      timeline,
      frameStep,
      play,
      pause,
      toggle,
      seekTo,
      stepFrames,
      beginScrub,
      endScrub,
      subscribeTime,
      subscribePlaying,
    ]
  );
}
