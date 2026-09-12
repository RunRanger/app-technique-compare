/**
 * Solving for the zoom that makes two athletes appear the same size.
 *
 * Apparent size is a camera artefact — distance and focal length — not a
 * property of the technique, and it makes shapes genuinely hard to compare. If
 * pose data is available for both clips, the correction can be measured rather
 * than eyeballed.
 *
 * The measure is the athlete's **on-screen body length**: the distance from the
 * ankle midpoint to the shoulder midpoint, in normalized frame units. Two
 * properties make it the right choice here:
 *
 *  - it is invariant to where in the frame the athlete is, so panning does not
 *    disturb it, and
 *  - it barely changes through a skill, unlike overall bounding-box height,
 *    which collapses in a tuck and stretches in a layout. A bounding box would
 *    make the solved scale depend on which instant happened to be sampled.
 *
 * Per-frame ratios are reduced with a **median**, not a mean: a handful of
 * badly-tracked frames is normal, and a median ignores them instead of being
 * dragged by them.
 *
 * Pure numeric code, so it is testable without a model.
 */

import type { LandmarkName, PoseFrame, PoseSequence } from '@/services/pose/types';

export interface AutoScaleResult {
  /** Multiply the comparison clip's zoom by this to match the reference. */
  scale: number;
  /** 0..1 — how much of both clips produced a usable measurement. */
  confidence: number;
  /** Median body length in the reference clip, normalized frame units. */
  referenceLength: number;
  comparisonLength: number;
  /** How many frames contributed to each median. */
  referenceSamples: number;
  comparisonSamples: number;
  explanation: string;
}

const MIN_VISIBILITY = 0.3;
/** Below this the measurement is too small to trust as a ratio denominator. */
const MIN_BODY_LENGTH = 0.02;
/** Fewer usable frames than this and the median means little. */
const MIN_SAMPLES = 3;

function point(frame: PoseFrame, name: LandmarkName): { x: number; y: number } | null {
  const landmark = frame.landmarks[name];
  if (!landmark) return null;
  if (landmark.visibility != null && landmark.visibility < MIN_VISIBILITY) return null;
  return { x: landmark.x, y: landmark.y };
}

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
 * Ankle-midpoint to shoulder-midpoint distance for one frame, or `null` when
 * either end is not reliably tracked.
 */
export function bodyLength(frame: PoseFrame): number | null {
  const ankles = midpoint(frame, 'leftAnkle', 'rightAnkle');
  const shoulders = midpoint(frame, 'leftShoulder', 'rightShoulder');
  if (!ankles || !shoulders) return null;

  const length = Math.hypot(shoulders.x - ankles.x, shoulders.y - ankles.y);
  return length >= MIN_BODY_LENGTH ? length : null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** Median body length across a sequence, with the count that produced it. */
export function medianBodyLength(sequence: PoseSequence): {
  length: number | null;
  samples: number;
} {
  const lengths: number[] = [];
  for (const frame of sequence.frames) {
    const length = bodyLength(frame);
    if (length != null) lengths.push(length);
  }
  return { length: median(lengths), samples: lengths.length };
}

/**
 * Scale factor to apply to the **comparison** clip so its athlete matches the
 * reference athlete's on-screen size.
 */
export function computeAutoScale(
  reference: PoseSequence,
  comparison: PoseSequence
): AutoScaleResult {
  const ref = medianBodyLength(reference);
  const cmp = medianBodyLength(comparison);

  const base: Omit<AutoScaleResult, 'scale' | 'confidence' | 'explanation'> = {
    referenceLength: ref.length ?? 0,
    comparisonLength: cmp.length ?? 0,
    referenceSamples: ref.samples,
    comparisonSamples: cmp.samples,
  };

  if (ref.length == null || cmp.length == null) {
    return {
      ...base,
      scale: 1,
      confidence: 0,
      explanation: 'Could not measure the athlete in one of the clips.',
    };
  }

  if (ref.samples < MIN_SAMPLES || cmp.samples < MIN_SAMPLES) {
    return {
      ...base,
      scale: 1,
      confidence: 0,
      explanation: 'Too few clearly tracked frames to measure a size difference.',
    };
  }

  const scale = ref.length / cmp.length;

  // Coverage over both clips is the honest confidence signal: a ratio from two
  // frames out of sixty is arithmetically fine and practically meaningless.
  const coverage = Math.min(
    ref.samples / Math.max(1, reference.frames.length),
    cmp.samples / Math.max(1, comparison.frames.length)
  );

  const percent = Math.round(Math.abs(scale - 1) * 100);
  return {
    ...base,
    scale,
    confidence: clamp01(coverage),
    explanation:
      percent < 3
        ? 'Both athletes already appear the same size.'
        : `Video 2's athlete appears ${scale > 1 ? 'smaller' : 'larger'}; scaling it by ${scale.toFixed(2)}× matches video 1.`,
  };
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
