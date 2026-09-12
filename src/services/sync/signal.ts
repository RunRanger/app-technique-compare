/**
 * Turning pose sequences into 1-D motion signals.
 *
 * Aligning two clips is a 1-D problem: we only need a scalar per frame whose
 * shape is characteristic of the movement. Which scalar depends on the sport,
 * hence the selectable channels.
 *
 * Pure numeric code — no React, no native modules — so it is fully unit-tested.
 */

import type { LandmarkName, PoseFrame, PoseSequence } from '@/services/pose/types';

export type SignalChannel =
  /** Height of the hip midpoint. The general-purpose choice: jumps, vaults, tumbling. */
  | 'hipHeight'
  /** Height of the ankle midpoint. Sharper takeoff/landing transitions. */
  | 'ankleHeight'
  /** Vertical speed of the hips. Peaks at takeoff, which is easier to localize than an apex. */
  | 'verticalVelocity'
  /** Total per-frame movement of all landmarks. Robust when the athlete is partly occluded. */
  | 'totalMotion';

export const SIGNAL_CHANNELS: { key: SignalChannel; label: string; hint: string }[] = [
  { key: 'hipHeight', label: 'Hip height', hint: 'Best all-round choice for jumps and vaults' },
  { key: 'ankleHeight', label: 'Ankle height', hint: 'Sharper takeoff and landing edges' },
  { key: 'verticalVelocity', label: 'Vertical speed', hint: 'Peaks exactly at takeoff' },
  { key: 'totalMotion', label: 'Overall motion', hint: 'Most robust when tracking is patchy' },
];

export interface MotionSignal {
  /** Uniformly sampled values, one per time step. */
  values: number[];
  /** Time of `values[0]`. */
  startSeconds: number;
  /** Sample rate, matching the pose sequence. */
  sampleFps: number;
  /** Fraction of frames that had usable landmarks — a confidence proxy. */
  coverage: number;
  channel: SignalChannel;
}

const MIN_VISIBILITY = 0.3;

function point(frame: PoseFrame, name: LandmarkName): { x: number; y: number } | null {
  const landmark = frame.landmarks[name];
  if (!landmark) return null;
  if (landmark.visibility != null && landmark.visibility < MIN_VISIBILITY) return null;
  return { x: landmark.x, y: landmark.y };
}

/** Midpoint of a bilateral pair, tolerating one missing side. */
function midpoint(
  frame: PoseFrame,
  left: LandmarkName,
  right: LandmarkName
): { x: number; y: number } | null {
  const a = point(frame, left);
  const b = point(frame, right);
  if (a && b) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return a ?? b;
}

/**
 * Extracts a motion signal.
 *
 * Height channels are returned as "up is positive" — pose `y` grows downward, so
 * they are negated. Gaps where no landmark was detected are linearly
 * interpolated (and held flat at the ends) so downstream filters see a
 * continuous series instead of holes.
 */
export function extractSignal(sequence: PoseSequence, channel: SignalChannel): MotionSignal {
  const frames = sequence.frames;
  const raw: (number | null)[] = new Array(frames.length).fill(null);

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    if (!frame) continue;

    switch (channel) {
      case 'hipHeight': {
        const hips = midpoint(frame, 'leftHip', 'rightHip');
        raw[i] = hips ? -hips.y : null;
        break;
      }
      case 'ankleHeight': {
        const ankles = midpoint(frame, 'leftAnkle', 'rightAnkle');
        raw[i] = ankles ? -ankles.y : null;
        break;
      }
      case 'verticalVelocity': {
        // Filled in below: velocity needs the whole height series first.
        const hips = midpoint(frame, 'leftHip', 'rightHip');
        raw[i] = hips ? -hips.y : null;
        break;
      }
      case 'totalMotion': {
        const previous = i > 0 ? frames[i - 1] : undefined;
        raw[i] = previous ? totalDisplacement(previous, frame) : 0;
        break;
      }
    }
  }

  const coverage = raw.filter((v) => v != null).length / Math.max(1, raw.length);
  let values = interpolateGaps(raw);

  if (channel === 'verticalVelocity') {
    values = derivative(values, sequence.sampleFps);
  }

  return {
    values,
    startSeconds: frames[0]?.timeSeconds ?? 0,
    sampleFps: sequence.sampleFps,
    coverage,
    channel,
  };
}

function totalDisplacement(previous: PoseFrame, current: PoseFrame): number {
  let sum = 0;
  let count = 0;
  for (const key of Object.keys(current.landmarks) as LandmarkName[]) {
    const a = previous.landmarks[key];
    const b = current.landmarks[key];
    if (!a || !b) continue;
    sum += Math.hypot(b.x - a.x, b.y - a.y);
    count++;
  }
  return count > 0 ? sum / count : 0;
}

/**
 * Replaces `null` runs with a linear ramp between their neighbours; leading and
 * trailing gaps are held at the nearest known value.
 */
export function interpolateGaps(input: (number | null)[]): number[] {
  const n = input.length;
  const out = new Array<number>(n).fill(0);
  if (n === 0) return out;

  const knownIndices: number[] = [];
  for (let i = 0; i < n; i++) if (input[i] != null) knownIndices.push(i);
  if (knownIndices.length === 0) return out;

  const firstKnown = knownIndices[0]!;
  const lastKnown = knownIndices[knownIndices.length - 1]!;

  for (let i = 0; i < firstKnown; i++) out[i] = input[firstKnown]!;
  for (let i = lastKnown + 1; i < n; i++) out[i] = input[lastKnown]!;

  for (let k = 0; k < knownIndices.length; k++) {
    const index = knownIndices[k]!;
    out[index] = input[index]!;
    const next = knownIndices[k + 1];
    if (next == null || next === index + 1) continue;
    const span = next - index;
    const from = input[index]!;
    const to = input[next]!;
    for (let j = 1; j < span; j++) {
      out[index + j] = from + ((to - from) * j) / span;
    }
  }
  return out;
}

/** Central-difference derivative, in units per second. */
export function derivative(values: number[], sampleFps: number): number[] {
  const n = values.length;
  const out = new Array<number>(n).fill(0);
  if (n < 2) return out;
  const dt = 1 / sampleFps;
  for (let i = 0; i < n; i++) {
    const previous = values[Math.max(0, i - 1)]!;
    const next = values[Math.min(n - 1, i + 1)]!;
    const span = Math.min(n - 1, i + 1) - Math.max(0, i - 1);
    out[i] = span > 0 ? (next - previous) / (span * dt) : 0;
  }
  return out;
}

/**
 * Moving-average smoothing over an odd window, with edges handled by shrinking
 * the window rather than padding (padding would drag the ends toward zero and
 * invent peaks near the clip boundaries).
 */
export function smooth(values: number[], windowSize: number): number[] {
  const n = values.length;
  if (windowSize <= 1 || n === 0) return [...values];
  const half = Math.floor(windowSize / 2);
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) {
      sum += values[j]!;
      count++;
    }
    out[i] = sum / count;
  }
  return out;
}

/** Zero mean, unit standard deviation. Flat input returns all zeros. */
export function normalize(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / n;

  let variance = 0;
  for (const v of values) variance += (v - mean) ** 2;
  const sd = Math.sqrt(variance / n);
  if (sd < 1e-9) return new Array<number>(n).fill(0);

  return values.map((v) => (v - mean) / sd);
}
