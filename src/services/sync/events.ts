/**
 * Locating movement landmarks in a 1-D motion signal.
 *
 * Both detectors return *sub-sample* times. That matters: pose is sampled at
 * ~15 fps while the video runs at 30–240 fps, so rounding an event to the
 * nearest pose sample would cap alignment accuracy at ~66 ms — several frames of
 * visible error. Fitting a parabola to the peak and its two neighbours recovers
 * a position between samples and brings the error well under one video frame.
 */

import type { MotionSignal } from './signal';
import { smooth } from './signal';

export type MovementEventKind = 'apex' | 'takeoff' | 'landing';

export interface MovementEvent {
  kind: MovementEventKind;
  /** Time within the clip, in seconds. Sub-sample accurate. */
  timeSeconds: number;
  /** Fractional index into the signal. */
  index: number;
  /** 0..1 — how pronounced the event is relative to the signal's range. */
  confidence: number;
}

/**
 * Fits a parabola through `(x-1, y-1), (x, y), (x+1, y+1)` and returns the
 * offset of its vertex from `x`, in samples, constrained to (-0.5, 0.5).
 */
export function parabolicRefine(values: number[], index: number): number {
  const previous = values[index - 1];
  const current = values[index];
  const next = values[index + 1];
  if (previous == null || current == null || next == null) return 0;

  const denominator = previous - 2 * current + next;
  if (Math.abs(denominator) < 1e-12) return 0;

  const delta = (0.5 * (previous - next)) / denominator;
  return Math.max(-0.5, Math.min(0.5, delta));
}

const indexToTime = (signal: MotionSignal, index: number): number =>
  signal.startSeconds + index / signal.sampleFps;

/**
 * The apex: the signal's global maximum. For a height channel this is the
 * highest point of the flight; the signal is already oriented "up is positive".
 */
export function detectApex(signal: MotionSignal, smoothingWindow = 3): MovementEvent | null {
  const values = smooth(signal.values, smoothingWindow);
  if (values.length === 0) return null;

  let peakIndex = 0;
  let peakValue = values[0]!;
  let minValue = values[0]!;
  for (let i = 1; i < values.length; i++) {
    const v = values[i]!;
    if (v > peakValue) {
      peakValue = v;
      peakIndex = i;
    }
    if (v < minValue) minValue = v;
  }

  const range = peakValue - minValue;
  // A flat signal has no meaningful apex — report it rather than returning noise.
  if (range < 1e-9) return null;

  const refined = peakIndex + parabolicRefine(values, peakIndex);
  return {
    kind: 'apex',
    index: refined,
    timeSeconds: indexToTime(signal, refined),
    confidence: clamp01(range / (Math.abs(peakValue) + range + 1e-9)),
  };
}

/**
 * The takeoff: the instant of greatest upward speed before the apex.
 *
 * This is usually a better sync anchor than the apex itself — an apex is a
 * turning point where the signal is flat by definition, so its exact position is
 * poorly conditioned, whereas the takeoff is a steep edge.
 */
export function detectTakeoff(signal: MotionSignal, smoothingWindow = 3): MovementEvent | null {
  const apex = detectApex(signal, smoothingWindow);
  if (!apex) return null;

  const values = smooth(signal.values, smoothingWindow);
  const apexIndex = Math.round(apex.index);
  if (apexIndex <= 0) return null;

  const velocity: number[] = new Array(values.length).fill(0);
  for (let i = 1; i < values.length; i++) {
    velocity[i] = values[i]! - values[i - 1]!;
  }

  let bestIndex = 1;
  let bestValue = -Infinity;
  for (let i = 1; i <= apexIndex; i++) {
    const v = velocity[i]!;
    if (v > bestValue) {
      bestValue = v;
      bestIndex = i;
    }
  }
  if (bestValue <= 0) return null;

  const refined = bestIndex + parabolicRefine(velocity, bestIndex);
  const span = Math.max(...values) - Math.min(...values);
  return {
    kind: 'takeoff',
    index: refined,
    timeSeconds: indexToTime(signal, refined),
    confidence: clamp01(span > 1e-9 ? bestValue / span : 0),
  };
}

/** The mirror of takeoff: steepest downward move after the apex. */
export function detectLanding(signal: MotionSignal, smoothingWindow = 3): MovementEvent | null {
  const apex = detectApex(signal, smoothingWindow);
  if (!apex) return null;

  const values = smooth(signal.values, smoothingWindow);
  const apexIndex = Math.round(apex.index);

  const velocity: number[] = new Array(values.length).fill(0);
  for (let i = 1; i < values.length; i++) {
    velocity[i] = values[i]! - values[i - 1]!;
  }

  let bestIndex = -1;
  let bestValue = Infinity;
  for (let i = apexIndex + 1; i < velocity.length; i++) {
    const v = velocity[i]!;
    if (v < bestValue) {
      bestValue = v;
      bestIndex = i;
    }
  }
  if (bestIndex < 0 || bestValue >= 0) return null;

  const refined = bestIndex + parabolicRefine(velocity, bestIndex);
  const span = Math.max(...values) - Math.min(...values);
  return {
    kind: 'landing',
    index: refined,
    timeSeconds: indexToTime(signal, refined),
    confidence: clamp01(span > 1e-9 ? Math.abs(bestValue) / span : 0),
  };
}

export function detectEvent(
  signal: MotionSignal,
  kind: MovementEventKind,
  smoothingWindow = 3
): MovementEvent | null {
  switch (kind) {
    case 'apex':
      return detectApex(signal, smoothingWindow);
    case 'takeoff':
      return detectTakeoff(signal, smoothingWindow);
    case 'landing':
      return detectLanding(signal, smoothingWindow);
  }
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
