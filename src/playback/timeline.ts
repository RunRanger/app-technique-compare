/**
 * Pure timeline math for two-clip comparison.
 *
 * Sync model
 * ----------
 * A single scalar, `offsetSeconds` (`o`), fully describes the alignment:
 *
 *     the moment at time `t` in the reference clip
 *     corresponds to the moment at time `t + o` in the comparison clip.
 *
 * So a positive offset means the comparison clip's event happens *later* in its
 * own file than the reference clip's does — we must skip ahead in clip B.
 *
 * The "master timeline" is expressed in reference-clip time. Its usable range is
 * the intersection of both clips once the offset is applied, so scrubbing never
 * lands on a point where one of the two videos has no frame to show.
 *
 * Everything here is a pure function of numbers: no players, no React, no
 * native modules. That keeps the tricky part of the app unit-testable.
 */

import { DEFAULT_FPS } from '@/types';

export interface Timeline {
  /** First reference-clip time at which both clips have a frame. */
  start: number;
  /** Last reference-clip time at which both clips have a frame. */
  end: number;
  /** `end - start`, always >= 0. */
  duration: number;
  /**
   * True when the offset pushes the clips fully apart and no real overlap
   * exists. The timeline then degrades to a clamped best-effort range rather
   * than collapsing to a single unusable point.
   */
  degraded: boolean;
}

/** Times to seek each player to, for a given master time. */
export interface ClipTimes {
  reference: number;
  comparison: number;
}

export const clamp = (value: number, min: number, max: number): number =>
  value < min ? min : value > max ? max : value;

/** Frame duration in seconds, guarding against absent or nonsensical fps. */
export function frameDuration(fps: number | null | undefined): number {
  if (fps == null || !Number.isFinite(fps) || fps <= 0) return 1 / DEFAULT_FPS;
  return 1 / fps;
}

/**
 * Rounds a time to the nearest frame boundary, then nudges it a hair *into* the
 * frame. Landing exactly on a boundary is ambiguous — decoders may resolve it to
 * either neighbouring frame — so we aim for the frame's midpoint region, which
 * makes repeated seeks to the same frame index deterministic.
 */
export function snapToFrame(timeSeconds: number, fps: number | null | undefined): number {
  const step = frameDuration(fps);
  const index = Math.round(timeSeconds / step);
  return Math.max(0, index * step + step * 0.25);
}

/** The frame index a time falls in. */
export function frameIndexAt(timeSeconds: number, fps: number | null | undefined): number {
  return Math.max(0, Math.round(timeSeconds / frameDuration(fps)));
}

/**
 * Computes the master timeline for two clip durations and an offset.
 *
 * Reference time `t` is playable when `0 <= t <= dRef` and
 * `0 <= t + o <= dCmp`, i.e. `-o <= t <= dCmp - o`.
 */
export function computeTimeline(
  referenceDuration: number | null,
  comparisonDuration: number | null,
  offsetSeconds: number
): Timeline {
  const dRef = normalizeDuration(referenceDuration);
  const dCmp = normalizeDuration(comparisonDuration);

  const start = Math.max(0, -offsetSeconds);
  const end = Math.min(dRef, dCmp - offsetSeconds);

  if (end > start) {
    return { start, end, duration: end - start, degraded: false };
  }

  // No overlap: the user has dialled in an offset larger than either clip.
  // Rather than freeze the UI, expose the reference clip's own range and let
  // per-clip clamping hold the comparison clip on its first or last frame.
  const fallbackEnd = dRef > 0 ? dRef : dCmp;
  return { start: 0, end: fallbackEnd, duration: fallbackEnd, degraded: true };
}

/**
 * Maps a master time to the per-clip seek targets, clamping each to its own
 * clip so neither player is ever asked to seek out of bounds.
 */
export function masterToClipTimes(
  masterTime: number,
  offsetSeconds: number,
  referenceDuration: number | null,
  comparisonDuration: number | null
): ClipTimes {
  const dRef = normalizeDuration(referenceDuration);
  const dCmp = normalizeDuration(comparisonDuration);
  return {
    reference: clamp(masterTime, 0, dRef),
    comparison: clamp(masterTime + offsetSeconds, 0, dCmp),
  };
}

/**
 * The range the offset slider should span.
 *
 * Any alignment worth having keeps *some* overlap between the clips, so the
 * extremes are "clip B's end meets clip A's start" and vice versa.
 */
export function offsetBounds(
  referenceDuration: number | null,
  comparisonDuration: number | null
): { min: number; max: number } {
  const dRef = normalizeDuration(referenceDuration);
  const dCmp = normalizeDuration(comparisonDuration);
  if (dRef <= 0 && dCmp <= 0) return { min: -1, max: 1 };
  return { min: -dRef, max: dCmp };
}

/** Keeps an offset inside {@link offsetBounds}. */
export function clampOffset(
  offsetSeconds: number,
  referenceDuration: number | null,
  comparisonDuration: number | null
): number {
  const { min, max } = offsetBounds(referenceDuration, comparisonDuration);
  return clamp(offsetSeconds, min, max);
}

/**
 * Master time that keeps a given *reference-clip* moment on screen after the
 * offset changes. Used so nudging the offset does not throw away the user's
 * position in the clip.
 */
export function preservePosition(masterTime: number, timeline: Timeline): number {
  return clamp(masterTime, timeline.start, timeline.end);
}

/** `mm:ss.cs` — centisecond precision is what frame-level work needs. */
export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds)) return '--:--.--';
  const sign = seconds < 0 ? '-' : '';
  const abs = Math.abs(seconds);
  const mins = Math.floor(abs / 60);
  const secs = Math.floor(abs % 60);
  const cs = Math.floor((abs - Math.floor(abs)) * 100);
  return `${sign}${pad(mins)}:${pad(secs)}.${pad(cs)}`;
}

/** Signed offset label, e.g. `+0.133 s (+4 f)`. */
export function formatOffset(offsetSeconds: number, fps: number | null | undefined): string {
  const frames = Math.round(offsetSeconds / frameDuration(fps));
  const sign = offsetSeconds >= 0 ? '+' : '−';
  const abs = Math.abs(offsetSeconds);
  return `${sign}${abs.toFixed(3)} s (${sign}${Math.abs(frames)} f)`;
}

const pad = (n: number): string => (n < 10 ? `0${n}` : String(n));

function normalizeDuration(duration: number | null | undefined): number {
  if (duration == null || !Number.isFinite(duration) || duration <= 0) return 0;
  return duration;
}
