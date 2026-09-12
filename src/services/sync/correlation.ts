/**
 * Normalized cross-correlation for finding the lag between two motion signals.
 *
 * Event matching (apex-to-apex) is fast but brittle: it stakes everything on one
 * point, so a mistracked frame moves the answer. Correlation instead uses the
 * whole shape of the movement, which is what makes it the primary method here,
 * with event matching kept as a cross-check.
 *
 * Signals are compared only over their *overlapping* region at each lag, and
 * each comparison is re-normalized over exactly that region. Skipping that
 * re-normalization is the classic bug: the raw dot product grows with overlap
 * length and the solver then collapses to lag 0 regardless of the data.
 */

export interface CorrelationResult {
  /** Best lag in samples: how far signal B trails signal A. Sub-sample refined. */
  lagSamples: number;
  /** Pearson correlation at the best lag, -1..1. */
  score: number;
  /** How much the best lag stands out from the runners-up, 0..1. */
  distinctness: number;
}

/** Minimum overlap before a lag is considered at all. */
const MIN_OVERLAP_SAMPLES = 4;

/**
 * Finds the lag maximising the correlation between `a` and `b`.
 *
 * A positive result means `b`'s features occur *later* within `b` than `a`'s do
 * within `a`, so `b` must be advanced to line up with `a`.
 */
export function bestLag(a: number[], b: number[], maxLagSamples?: number): CorrelationResult {
  const maxLag =
    maxLagSamples ?? Math.max(1, Math.min(a.length, b.length) - MIN_OVERLAP_SAMPLES);

  const scores: { lag: number; score: number }[] = [];
  let best = { lag: 0, score: -Infinity };

  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const score = correlationAtLag(a, b, lag);
    if (score == null) continue;
    scores.push({ lag, score });
    if (score > best.score) best = { lag, score };
  }

  if (scores.length === 0 || best.score === -Infinity) {
    return { lagSamples: 0, score: 0, distinctness: 0 };
  }

  // Refine between samples using the correlation curve around the peak.
  const curve = new Map(scores.map((s) => [s.lag, s.score]));
  const previous = curve.get(best.lag - 1);
  const next = curve.get(best.lag + 1);
  let refinedLag = best.lag;
  if (previous != null && next != null) {
    const denominator = previous - 2 * best.score + next;
    if (Math.abs(denominator) > 1e-12) {
      const delta = (0.5 * (previous - next)) / denominator;
      refinedLag = best.lag + Math.max(-0.5, Math.min(0.5, delta));
    }
  }

  return {
    lagSamples: refinedLag,
    score: best.score,
    distinctness: computeDistinctness(scores, best.lag, best.score),
  };
}

/**
 * Pearson correlation over the region where the signals overlap at `lag`.
 * Returns `null` when the overlap is too small to mean anything.
 */
export function correlationAtLag(a: number[], b: number[], lag: number): number | null {
  // Pair a[i] with b[i + lag].
  const start = Math.max(0, -lag);
  const end = Math.min(a.length, b.length - lag);
  const overlap = end - start;
  if (overlap < MIN_OVERLAP_SAMPLES) return null;

  let sumA = 0;
  let sumB = 0;
  for (let i = start; i < end; i++) {
    sumA += a[i]!;
    sumB += b[i + lag]!;
  }
  const meanA = sumA / overlap;
  const meanB = sumB / overlap;

  let covariance = 0;
  let varianceA = 0;
  let varianceB = 0;
  for (let i = start; i < end; i++) {
    const da = a[i]! - meanA;
    const db = b[i + lag]! - meanB;
    covariance += da * db;
    varianceA += da * da;
    varianceB += db * db;
  }

  const denominator = Math.sqrt(varianceA * varianceB);
  // One side is flat over this window: correlation is undefined, not zero.
  if (denominator < 1e-12) return null;
  return covariance / denominator;
}

/**
 * How isolated the winning peak is. A movement with a single clear takeoff gives
 * a sharp peak; a repetitive one (running strides) gives several near-equal
 * peaks, and a low value here tells the UI not to trust the result blindly.
 *
 * Only lags outside a small exclusion window around the winner count as rivals.
 */
function computeDistinctness(
  scores: { lag: number; score: number }[],
  bestLagValue: number,
  bestScore: number
): number {
  const exclusion = Math.max(2, Math.round(scores.length * 0.05));
  let runnerUp = -Infinity;
  for (const { lag, score } of scores) {
    if (Math.abs(lag - bestLagValue) <= exclusion) continue;
    if (score > runnerUp) runnerUp = score;
  }
  if (runnerUp === -Infinity) return 1;
  if (bestScore <= 0) return 0;
  return Math.max(0, Math.min(1, (bestScore - runnerUp) / Math.abs(bestScore)));
}
