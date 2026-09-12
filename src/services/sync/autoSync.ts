/**
 * The auto-sync solver: two pose sequences in, one offset out.
 *
 * Combines the two independent methods and reports which one it trusted, so the
 * UI can be honest about how the number was reached. The result is always a
 * *suggestion* — it lands in the same offset slider the user can nudge by hand,
 * never applied silently.
 */

import { extractSignal, normalize, smooth, type SignalChannel } from './signal';
import { detectEvent, type MovementEvent, type MovementEventKind } from './events';
import { bestLag } from './correlation';
import type { PoseSequence } from '@/services/pose/types';

export type AutoSyncMethod = 'correlation' | 'event' | 'none';

export interface AutoSyncOptions {
  channel?: SignalChannel;
  /** Event used for the cross-check and as the fallback anchor. */
  eventKind?: MovementEventKind;
  /** Largest offset to consider, in seconds. */
  maxOffsetSeconds?: number;
  smoothingWindow?: number;
}

export interface AutoSyncResult {
  /**
   * Seconds to add to reference-clip time to reach the matching moment in the
   * comparison clip — the same convention as `timeline.ts`.
   */
  offsetSeconds: number;
  /** 0..1 overall trust in this offset. */
  confidence: number;
  method: AutoSyncMethod;
  /** Correlation at the chosen lag, when correlation was used. */
  correlationScore: number | null;
  referenceEvent: MovementEvent | null;
  comparisonEvent: MovementEvent | null;
  /** What the event-matching method would have produced, for display. */
  eventOffsetSeconds: number | null;
  /** Human-readable account of how the offset was chosen. */
  explanation: string;
}

export const DEFAULT_AUTO_SYNC_OPTIONS: Required<AutoSyncOptions> = {
  channel: 'hipHeight',
  eventKind: 'takeoff',
  maxOffsetSeconds: 5,
  smoothingWindow: 3,
};

/** Below this correlation the shapes simply do not match. */
const MIN_TRUSTED_CORRELATION = 0.5;
/** Event and correlation answers further apart than this are treated as a conflict. */
const AGREEMENT_TOLERANCE_SECONDS = 0.25;

export function computeAutoSync(
  reference: PoseSequence,
  comparison: PoseSequence,
  options: AutoSyncOptions = {}
): AutoSyncResult {
  const config = { ...DEFAULT_AUTO_SYNC_OPTIONS, ...options };

  const referenceSignal = extractSignal(reference, config.channel);
  const comparisonSignal = extractSignal(comparison, config.channel);

  const referenceEvent = detectEvent(referenceSignal, config.eventKind, config.smoothingWindow);
  const comparisonEvent = detectEvent(comparisonSignal, config.eventKind, config.smoothingWindow);

  const eventOffsetSeconds =
    referenceEvent && comparisonEvent
      ? comparisonEvent.timeSeconds - referenceEvent.timeSeconds
      : null;

  // Correlation needs a shared sample rate; bail out to events if they differ.
  const ratesMatch = Math.abs(referenceSignal.sampleFps - comparisonSignal.sampleFps) < 1e-6;

  if (!ratesMatch || referenceSignal.values.length < 8 || comparisonSignal.values.length < 8) {
    return eventOnlyResult(
      eventOffsetSeconds,
      referenceEvent,
      comparisonEvent,
      ratesMatch
        ? 'Too few pose samples for shape matching; used event alignment only.'
        : 'Pose sample rates differ; used event alignment only.',
      config.maxOffsetSeconds
    );
  }

  const sampleFps = referenceSignal.sampleFps;
  const a = normalize(smooth(referenceSignal.values, config.smoothingWindow));
  const b = normalize(smooth(comparisonSignal.values, config.smoothingWindow));
  const maxLagSamples = Math.max(1, Math.round(config.maxOffsetSeconds * sampleFps));

  const correlation = bestLag(a, b, maxLagSamples);

  // Lag is measured between the signals' own start times, which need not be the
  // clips' start times; carry that difference through.
  const startDelta = comparisonSignal.startSeconds - referenceSignal.startSeconds;
  const correlationOffset = correlation.lagSamples / sampleFps + startDelta;

  const agrees =
    eventOffsetSeconds != null &&
    Math.abs(correlationOffset - eventOffsetSeconds) <= AGREEMENT_TOLERANCE_SECONDS;

  const coverage = Math.min(referenceSignal.coverage, comparisonSignal.coverage);

  if (correlation.score >= MIN_TRUSTED_CORRELATION) {
    // Shape match is trusted. Agreement with the event detector raises confidence;
    // disagreement lowers it but does not override — correlation uses more data.
    const base = correlation.score * (0.6 + 0.4 * correlation.distinctness);
    const confidence = clamp01(base * coverage * (agrees ? 1 : 0.75));
    return {
      offsetSeconds: correlationOffset,
      confidence,
      method: 'correlation',
      correlationScore: correlation.score,
      referenceEvent,
      comparisonEvent,
      eventOffsetSeconds,
      explanation: agrees
        ? `Matched the movement shape (r=${correlation.score.toFixed(2)}); the detected ${config.eventKind} agrees.`
        : eventOffsetSeconds != null
          ? `Matched the movement shape (r=${correlation.score.toFixed(2)}). The detected ${config.eventKind} suggests ${eventOffsetSeconds.toFixed(2)} s instead — check the result.`
          : `Matched the movement shape (r=${correlation.score.toFixed(2)}).`,
    };
  }

  // The event answer is only a candidate if it also respects the caller's bound.
  // Without this check a rejected correlation could hand back an offset the
  // caller explicitly declared out of range.
  const eventWithinBounds =
    eventOffsetSeconds != null && Math.abs(eventOffsetSeconds) <= config.maxOffsetSeconds;

  if (eventOffsetSeconds != null && eventWithinBounds) {
    const confidence = clamp01(
      0.5 *
        coverage *
        Math.min(referenceEvent?.confidence ?? 0, comparisonEvent?.confidence ?? 0) *
        2
    );
    return {
      offsetSeconds: eventOffsetSeconds,
      confidence,
      method: 'event',
      correlationScore: correlation.score,
      referenceEvent,
      comparisonEvent,
      eventOffsetSeconds,
      explanation: `The clips' shapes did not match well (r=${correlation.score.toFixed(2)}); aligned on the detected ${config.eventKind} instead.`,
    };
  }

  return {
    offsetSeconds: 0,
    confidence: 0,
    method: 'none',
    correlationScore: correlation.score,
    referenceEvent,
    comparisonEvent,
    eventOffsetSeconds,
    explanation:
      eventOffsetSeconds != null && !eventWithinBounds
        ? `The only alignment found (${eventOffsetSeconds.toFixed(2)} s) exceeds the ${config.maxOffsetSeconds} s search limit. Widen the limit, or sync by hand.`
        : 'Could not find a reliable alignment. Try another channel, or sync by hand.',
  };
}

function eventOnlyResult(
  eventOffsetSeconds: number | null,
  referenceEvent: MovementEvent | null,
  comparisonEvent: MovementEvent | null,
  explanation: string,
  maxOffsetSeconds: number
): AutoSyncResult {
  if (eventOffsetSeconds != null && Math.abs(eventOffsetSeconds) > maxOffsetSeconds) {
    return {
      offsetSeconds: 0,
      confidence: 0,
      method: 'none',
      correlationScore: null,
      referenceEvent,
      comparisonEvent,
      eventOffsetSeconds,
      explanation: `The only alignment found (${eventOffsetSeconds.toFixed(2)} s) exceeds the ${maxOffsetSeconds} s search limit.`,
    };
  }
  if (eventOffsetSeconds == null) {
    return {
      offsetSeconds: 0,
      confidence: 0,
      method: 'none',
      correlationScore: null,
      referenceEvent,
      comparisonEvent,
      eventOffsetSeconds: null,
      explanation: 'No movement event was detected in one of the clips.',
    };
  }
  return {
    offsetSeconds: eventOffsetSeconds,
    confidence: clamp01(
      0.4 * Math.min(referenceEvent?.confidence ?? 0, comparisonEvent?.confidence ?? 0) * 2
    ),
    method: 'event',
    correlationScore: null,
    referenceEvent,
    comparisonEvent,
    eventOffsetSeconds,
    explanation,
  };
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
