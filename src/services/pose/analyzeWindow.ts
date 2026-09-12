/**
 * Running pose estimation over the same window of two clips.
 *
 * Shared by the auto-sync and auto-size panels, which need identical sampling:
 * a window around the moment the user is looking at, not the whole clip. Pose
 * extraction is the expensive step, and a few seconds around the movement is
 * both faster and more accurate than a full clip that may contain a walk-up, a
 * second attempt, or someone else's turn.
 */

import { poseRegistry } from './registry';
import type { PoseSequence } from './types';

/** Seconds analysed either side of the chosen moment. */
export const WINDOW_HALF_SPAN = 2;
/** Well above the movement's frequency content, far below video frame rate. */
export const SAMPLE_FPS = 15;

export interface AnalyzableClip {
  uri: string;
  sourceId: string;
  durationSeconds: number | null;
}

export interface WindowAnalysis {
  reference: PoseSequence;
  comparison: PoseSequence;
}

function windowFor(clip: AnalyzableClip, centerSeconds: number) {
  const duration = clip.durationSeconds ?? centerSeconds + WINDOW_HALF_SPAN;
  return {
    startSeconds: Math.max(0, centerSeconds - WINDOW_HALF_SPAN),
    endSeconds: Math.min(duration, centerSeconds + WINDOW_HALF_SPAN),
  };
}

/**
 * Estimates pose for both clips, reporting combined progress.
 *
 * The two runs are sequential rather than concurrent: they compete for the same
 * decoder and the same model instance, so running them in parallel makes the
 * whole thing slower on the mid-range devices this is most likely to run on.
 */
export async function analyzeWindow(
  reference: AnalyzableClip,
  comparison: AnalyzableClip,
  centerSeconds: number,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal
): Promise<WindowAnalysis> {
  const referenceSequence = await poseRegistry.estimate(
    { uri: reference.uri, sourceId: reference.sourceId, sampleFps: SAMPLE_FPS, ...windowFor(reference, centerSeconds) },
    (update) => onProgress?.(update.fraction * 0.5),
    signal
  );

  const comparisonSequence = await poseRegistry.estimate(
    { uri: comparison.uri, sourceId: comparison.sourceId, sampleFps: SAMPLE_FPS, ...windowFor(comparison, centerSeconds) },
    (update) => onProgress?.(0.5 + update.fraction * 0.5),
    signal
  );

  return { reference: referenceSequence, comparison: comparisonSequence };
}
