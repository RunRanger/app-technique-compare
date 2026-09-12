/**
 * Drift-correction policy for two independently-decoding players.
 *
 * Two `AVPlayer`/`ExoPlayer` instances started in the same JS tick do not stay
 * locked together: they decode independently and drift by tens of milliseconds
 * over a few seconds. Correcting on every tick would be worse than the drift —
 * each correction is a seek, and seeks stutter. So corrections are gated:
 * only when the error is visible, and never more often than a cooldown allows.
 *
 * Pure decision logic, no player objects, so the policy is unit-testable.
 */

export interface DriftDecision {
  /** Whether to seek the comparison player back into alignment. */
  correct: boolean;
  /** Where to seek it, when `correct` is true. */
  targetTime: number;
  /** Signed error, in seconds. Positive: the comparison clip is ahead. */
  driftSeconds: number;
}

export interface DriftPolicy {
  /**
   * Ignore drift below this. Set to roughly one frame: correcting sub-frame
   * error is invisible to the viewer and costs a stutter.
   */
  toleranceSeconds: number;
  /** Minimum wall-clock gap between corrections, in milliseconds. */
  cooldownMs: number;
  /**
   * Beyond this, something has gone properly wrong (a stall, a buffer underrun)
   * and a hard resync is warranted even mid-cooldown.
   */
  hardResyncSeconds: number;
}

export const DEFAULT_DRIFT_POLICY: DriftPolicy = {
  // ~1.5 frames at 30 fps: tight enough that no one sees it, loose enough to
  // avoid chasing decoder jitter.
  toleranceSeconds: 0.05,
  cooldownMs: 600,
  hardResyncSeconds: 0.35,
};

/**
 * Decides whether the comparison player needs a corrective seek.
 *
 * @param referenceTime   where the reference player actually is
 * @param comparisonTime  where the comparison player actually is
 * @param offsetSeconds   the alignment being maintained
 * @param msSinceCorrection wall-clock time since the last correction
 */
export function evaluateDrift(
  referenceTime: number,
  comparisonTime: number,
  offsetSeconds: number,
  msSinceCorrection: number,
  policy: DriftPolicy = DEFAULT_DRIFT_POLICY
): DriftDecision {
  const expected = referenceTime + offsetSeconds;
  const driftSeconds = comparisonTime - expected;
  const magnitude = Math.abs(driftSeconds);

  if (magnitude < policy.toleranceSeconds) {
    return { correct: false, targetTime: expected, driftSeconds };
  }

  const hard = magnitude >= policy.hardResyncSeconds;
  const cooledDown = msSinceCorrection >= policy.cooldownMs;

  return { correct: hard || cooledDown, targetTime: expected, driftSeconds };
}

/**
 * Seek precision profile.
 *
 * Exact seeking (zero tolerance) is what frame-by-frame review needs, but it is
 * far too slow to run on every sample of a slider drag. So the app switches
 * profiles: loose and fast while the finger is down, exact the moment it lifts.
 */
export interface SeekProfile {
  toleranceBefore: number;
  toleranceAfter: number;
  scrubbingModeEnabled: boolean;
}

/** Frame-accurate. Used for stepping, and as the final seek after a scrub. */
export const EXACT_SEEK: SeekProfile = {
  toleranceBefore: 0,
  toleranceAfter: 0,
  scrubbingModeEnabled: false,
};

/** Fast and approximate. Used only while a drag is in progress. */
export const SCRUB_SEEK: SeekProfile = {
  toleranceBefore: 0.1,
  toleranceAfter: 0.1,
  scrubbingModeEnabled: true,
};
