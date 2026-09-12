import { computeAutoSync } from '@/services/sync/autoSync';
import { MockPoseEstimator } from '@/services/pose/mockEstimator';
import type { PoseFrame, PoseSequence } from '@/services/pose/types';

/**
 * Builds a pose sequence for an athlete whose jump takes off at `takeoffSeconds`.
 * Two such sequences differing only in takeoff time have a ground-truth offset
 * equal to the difference of those times — which is exactly what auto-sync
 * should recover.
 */
function syntheticJump(options: {
  takeoffSeconds: number;
  durationSeconds: number;
  sampleFps: number;
  flightSeconds?: number;
  noise?: number;
  sourceId?: string;
}): PoseSequence {
  const { takeoffSeconds, durationSeconds, sampleFps } = options;
  const flight = options.flightSeconds ?? 0.6;
  const noise = options.noise ?? 0;
  const count = Math.floor(durationSeconds * sampleFps) + 1;

  // Deterministic pseudo-noise so the test cannot flake.
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };

  const frames: PoseFrame[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / sampleFps;
    const landing = takeoffSeconds + flight;
    let rise = 0;
    if (t >= takeoffSeconds && t <= landing) {
      const phase = (t - takeoffSeconds) / flight;
      rise = 4 * phase * (1 - phase) * 0.3;
    }
    const hipY = 0.7 - rise + rand() * noise;
    frames.push({
      timeSeconds: t,
      score: 0.9,
      landmarks: {
        leftHip: { x: 0.45, y: hipY, visibility: 0.9 },
        rightHip: { x: 0.55, y: hipY, visibility: 0.9 },
        leftAnkle: { x: 0.45, y: hipY + 0.22, visibility: 0.9 },
        rightAnkle: { x: 0.55, y: hipY + 0.22, visibility: 0.9 },
      },
    });
  }
  return { sourceId: options.sourceId ?? 'synthetic', sampleFps, frames };
}

describe('computeAutoSync', () => {
  const sampleFps = 15;

  it('recovers a known positive offset to within one video frame', () => {
    const reference = syntheticJump({ takeoffSeconds: 1.0, durationSeconds: 4, sampleFps });
    const comparison = syntheticJump({ takeoffSeconds: 1.8, durationSeconds: 4, sampleFps });

    const result = computeAutoSync(reference, comparison);

    // Ground truth: the comparison athlete takes off 0.8 s later in their clip.
    expect(result.offsetSeconds).toBeCloseTo(0.8, 1);
    // Within one frame at 30 fps.
    expect(Math.abs(result.offsetSeconds - 0.8)).toBeLessThan(1 / 30);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.method).toBe('correlation');
  });

  it('recovers a known negative offset', () => {
    const reference = syntheticJump({ takeoffSeconds: 2.2, durationSeconds: 4, sampleFps });
    const comparison = syntheticJump({ takeoffSeconds: 1.3, durationSeconds: 4, sampleFps });

    const result = computeAutoSync(reference, comparison);
    expect(result.offsetSeconds).toBeCloseTo(-0.9, 1);
  });

  it('returns a near-zero offset for already-aligned clips', () => {
    const reference = syntheticJump({ takeoffSeconds: 1.5, durationSeconds: 4, sampleFps });
    const comparison = syntheticJump({ takeoffSeconds: 1.5, durationSeconds: 4, sampleFps });

    const result = computeAutoSync(reference, comparison);
    expect(Math.abs(result.offsetSeconds)).toBeLessThan(1 / 30);
    expect(result.confidence).toBeGreaterThan(0.6);
  });

  it('still resolves the offset when the athletes differ in flight time', () => {
    const reference = syntheticJump({
      takeoffSeconds: 1.0,
      durationSeconds: 4,
      sampleFps,
      flightSeconds: 0.5,
    });
    const comparison = syntheticJump({
      takeoffSeconds: 1.6,
      durationSeconds: 4,
      sampleFps,
      flightSeconds: 0.75,
    });

    const result = computeAutoSync(reference, comparison);
    // Shapes differ, so tolerance is wider — but it must still find the right region.
    expect(result.offsetSeconds).toBeGreaterThan(0.35);
    expect(result.offsetSeconds).toBeLessThan(0.95);
  });

  it('tolerates landmark noise', () => {
    const reference = syntheticJump({
      takeoffSeconds: 1.0,
      durationSeconds: 4,
      sampleFps,
      noise: 0.02,
    });
    const comparison = syntheticJump({
      takeoffSeconds: 1.7,
      durationSeconds: 4,
      sampleFps,
      noise: 0.02,
    });

    const result = computeAutoSync(reference, comparison);
    expect(result.offsetSeconds).toBeCloseTo(0.7, 1);
  });

  it('respects the maximum offset bound', () => {
    const reference = syntheticJump({ takeoffSeconds: 0.5, durationSeconds: 6, sampleFps });
    const comparison = syntheticJump({ takeoffSeconds: 4.5, durationSeconds: 6, sampleFps });

    const result = computeAutoSync(reference, comparison, { maxOffsetSeconds: 1 });
    expect(Math.abs(result.offsetSeconds)).toBeLessThanOrEqual(1.05);
  });

  it('reports no-confidence rather than a wrong answer for flat clips', () => {
    const flat: PoseSequence = {
      sourceId: 'flat',
      sampleFps,
      frames: Array.from({ length: 60 }, (_, i) => ({
        timeSeconds: i / sampleFps,
        score: 0.9,
        landmarks: {
          leftHip: { x: 0.5, y: 0.7, visibility: 0.9 },
          rightHip: { x: 0.5, y: 0.7, visibility: 0.9 },
        },
      })),
    };

    const result = computeAutoSync(flat, flat);
    expect(result.method).toBe('none');
    expect(result.confidence).toBe(0);
    expect(result.offsetSeconds).toBe(0);
  });

  it('falls back to event alignment when sample rates differ', () => {
    const reference = syntheticJump({ takeoffSeconds: 1.0, durationSeconds: 4, sampleFps: 15 });
    const comparison = syntheticJump({ takeoffSeconds: 1.6, durationSeconds: 4, sampleFps: 20 });

    const result = computeAutoSync(reference, comparison);
    expect(result.method).toBe('event');
    expect(result.offsetSeconds).toBeCloseTo(0.6, 1);
    expect(result.explanation).toMatch(/sample rates differ/i);
  });

  it('works from the ankle channel too', () => {
    const reference = syntheticJump({ takeoffSeconds: 1.0, durationSeconds: 4, sampleFps });
    const comparison = syntheticJump({ takeoffSeconds: 1.5, durationSeconds: 4, sampleFps });

    const result = computeAutoSync(reference, comparison, { channel: 'ankleHeight' });
    expect(result.offsetSeconds).toBeCloseTo(0.5, 1);
  });

  it('always reports which method produced the number', () => {
    const reference = syntheticJump({ takeoffSeconds: 1.0, durationSeconds: 4, sampleFps });
    const comparison = syntheticJump({ takeoffSeconds: 1.4, durationSeconds: 4, sampleFps });

    const result = computeAutoSync(reference, comparison);
    expect(['correlation', 'event', 'none']).toContain(result.method);
    expect(result.explanation.length).toBeGreaterThan(0);
  });
});

describe('end-to-end through the mock estimator', () => {
  it('runs the whole pipeline and produces a usable offset', async () => {
    const estimator = new MockPoseEstimator();
    const base = { startSeconds: 0, endSeconds: 3, sampleFps: 15 };

    const reference = await estimator.estimate({ ...base, uri: 'a.mp4', sourceId: 'clip-a' });
    const comparison = await estimator.estimate({ ...base, uri: 'b.mp4', sourceId: 'clip-b' });

    expect(reference.frames.length).toBeGreaterThan(30);

    const result = computeAutoSync(reference, comparison);
    expect(Number.isFinite(result.offsetSeconds)).toBe(true);
    // Different clip ids produce genuinely different takeoffs, so the pipeline
    // must return a real, non-trivial alignment rather than a degenerate zero.
    expect(result.method).not.toBe('none');
  });

  it('is deterministic for a given clip id', async () => {
    const estimator = new MockPoseEstimator();
    const request = { uri: 'a.mp4', sourceId: 'clip-a', startSeconds: 0, endSeconds: 2, sampleFps: 15 };
    const first = await estimator.estimate(request);
    const second = await estimator.estimate(request);
    expect(first.frames[10]!.landmarks.leftHip!.y).toBeCloseTo(
      second.frames[10]!.landmarks.leftHip!.y,
      12
    );
  });

  it('reports progress up to completion', async () => {
    const estimator = new MockPoseEstimator();
    const fractions: number[] = [];
    await estimator.estimate(
      { uri: 'a.mp4', sourceId: 'clip-a', startSeconds: 0, endSeconds: 1, sampleFps: 10 },
      (progress) => fractions.push(progress.fraction)
    );
    expect(fractions.length).toBeGreaterThan(0);
    expect(fractions[fractions.length - 1]!).toBeCloseTo(1, 6);
  });
});
