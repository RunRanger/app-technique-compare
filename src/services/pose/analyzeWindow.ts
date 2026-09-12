/**
 * Running pose estimation over the same window of two clips.
 *
 * Shared by the auto-sync and auto-size panels, which need identical sampling: a
 * window around the moment the user is looking at, not the whole clip. Pose
 * extraction is the expensive step, and a few seconds around the movement is
 * both faster and more accurate than a full clip that may contain a walk-up, a
 * second attempt, or someone else's turn.
 *
 * The window and rate below are chosen against a wall-clock target rather than
 * for maximum data. Sampling at 8 fps over 3 seconds is 25 frames per clip; at
 * 15 fps over 4 seconds it was 61, and roughly two and a half times the work for
 * accuracy that the sub-sample refinement in the solvers already recovers. Both
 * cross-correlation and event detection fit a parabola around their peak, which
 * resolves position to a fraction of a sample — so a coarser grid costs far less
 * precision than the frame count suggests.
 *
 * Results are cached by the registry per (estimator, clip, window, rate), so
 * running auto-sync and then auto-size over the same moment does the extraction
 * once.
 */

import { ANALYSIS_BUDGET_MS, perClipDeadline } from './budget';
import { poseRegistry } from './registry';
import type { PoseSequence } from './types';
import type { VideoPlayer } from 'expo-video';

/** Seconds analysed either side of the chosen moment. */
export const WINDOW_HALF_SPAN = 1.5;
/** Comfortably above the frequency content of a human movement. */
export const SAMPLE_FPS = 8;

export { ANALYSIS_BUDGET_MS };

export interface AnalyzableClip {
  uri: string;
  sourceId: string;
  durationSeconds: number | null;
  /**
   * The clip's already-loaded player, when the caller has one. Passing it saves
   * opening the asset again, which on both sync screens is otherwise pure
   * latency before any real work starts.
   */
  player?: VideoPlayer;
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
 * Each gets half the time budget, so one slow clip cannot starve the other.
 */
export async function analyzeWindow(
  reference: AnalyzableClip,
  comparison: AnalyzableClip,
  centerSeconds: number,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal
): Promise<WindowAnalysis> {
  const startedAt = Date.now();

  const referenceSequence = await poseRegistry.estimate(
    {
      uri: reference.uri,
      sourceId: reference.sourceId,
      sampleFps: SAMPLE_FPS,
      player: reference.player,
      deadlineAt: perClipDeadline(startedAt),
      ...windowFor(reference, centerSeconds),
    },
    (update) => onProgress?.(update.fraction * 0.5),
    signal
  );

  // The second clip gets whatever is left, measured from now — if the first
  // finished early, the second may use the slack.
  const comparisonSequence = await poseRegistry.estimate(
    {
      uri: comparison.uri,
      sourceId: comparison.sourceId,
      sampleFps: SAMPLE_FPS,
      player: comparison.player,
      deadlineAt: startedAt + ANALYSIS_BUDGET_MS,
      ...windowFor(comparison, centerSeconds),
    },
    (update) => onProgress?.(0.5 + update.fraction * 0.5),
    signal
  );

  return { reference: referenceSequence, comparison: comparisonSequence };
}
