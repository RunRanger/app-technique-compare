/**
 * Keeping analysis inside a wall-clock budget.
 *
 * Pose extraction is the only slow part of this app, and its cost is almost
 * entirely "number of frames × cost per frame". The per-frame cost varies by an
 * order of magnitude across devices, so a fixed sample rate that feels instant
 * on one phone stalls on another.
 *
 * Two mechanisms, because one is not enough:
 *
 *  - a **frame count** derived from the window and sample rate, which sets the
 *    expected work up front, and
 *  - a **deadline**, checked while sampling, which caps the worst case on a slow
 *    device by stopping early.
 *
 * Stopping early degrades rather than fails: the solvers work on whatever span
 * they are given, cross-correlation included, as long as both clips are sampled
 * at the same rate. So the rate is never adjusted mid-run — only the number of
 * samples taken.
 */

/** Wall-clock target for a complete analysis of both clips. */
export const ANALYSIS_BUDGET_MS = 4000;

/**
 * Reserved for work that is not frame sampling: model load on first use, the
 * solver itself, and the render that follows.
 */
const OVERHEAD_MS = 400;

/** Below this many samples the solvers have nothing meaningful to work with. */
export const MIN_USABLE_FRAMES = 8;

export interface SamplingPlan {
  /** Times to sample, in seconds, ascending. */
  times: number[];
  /** The rate those times represent. Must match across both clips. */
  sampleFps: number;
}

/**
 * Even sampling across a window, capped so a long window cannot silently blow
 * the budget.
 */
export function planSampling(
  startSeconds: number,
  endSeconds: number,
  sampleFps: number,
  maxFrames: number
): SamplingPlan {
  const span = Math.max(0, endSeconds - startSeconds);
  const wanted = Math.floor(span * sampleFps) + 1;
  const count = Math.max(1, Math.min(wanted, maxFrames));

  // Keep the nominal rate when the cap does not bite; otherwise the times are
  // spread over the same window at a correspondingly lower rate.
  const step = count > 1 ? span / (count - 1) : 0;
  const effectiveFps = step > 0 ? 1 / step : sampleFps;

  const times: number[] = [];
  for (let i = 0; i < count; i++) times.push(startSeconds + i * step);

  return { times, sampleFps: count > 1 ? effectiveFps : sampleFps };
}

/** Splits the total budget between the two clips, leaving room for overhead. */
export function perClipDeadline(startedAt: number, clips = 2): number {
  const usable = Math.max(0, ANALYSIS_BUDGET_MS - OVERHEAD_MS);
  return startedAt + usable / clips;
}

/**
 * Whether to keep sampling.
 *
 * The next chunk is only started if the time it is expected to take still fits.
 * Checking "are we past the deadline" alone would let one final slow chunk run
 * well past it.
 */
export function shouldContinue(
  now: number,
  deadlineAt: number,
  framesDone: number,
  msPerFrameSoFar: number,
  chunkSize: number
): boolean {
  if (framesDone < MIN_USABLE_FRAMES) return true; // Never return unusable data.
  if (msPerFrameSoFar <= 0) return now < deadlineAt;
  return now + msPerFrameSoFar * chunkSize <= deadlineAt;
}
