import { bodyLength, computeAutoScale, median, medianBodyLength } from '@/services/sync/autoScale';
import type { PoseFrame, PoseSequence } from '@/services/pose/types';

/**
 * An athlete whose ankle-to-shoulder distance is `size`, positioned at `centerX`.
 * `tuck` shortens the *bounding box* without changing body length, which is the
 * distinction the measure is chosen for.
 */
function athlete(options: {
  size: number;
  centerX?: number;
  centerY?: number;
  visibility?: number;
  timeSeconds?: number;
}): PoseFrame {
  const { size, centerX = 0.5, centerY = 0.5, visibility = 0.9, timeSeconds = 0 } = options;
  const ankleY = centerY + size / 2;
  const shoulderY = centerY - size / 2;
  return {
    timeSeconds,
    score: 0.9,
    landmarks: {
      leftShoulder: { x: centerX - 0.04, y: shoulderY, visibility },
      rightShoulder: { x: centerX + 0.04, y: shoulderY, visibility },
      leftAnkle: { x: centerX - 0.03, y: ankleY, visibility },
      rightAnkle: { x: centerX + 0.03, y: ankleY, visibility },
    },
  };
}

const sequence = (frames: PoseFrame[]): PoseSequence => ({
  sourceId: 'test',
  sampleFps: 15,
  frames,
});

const uniform = (size: number, count = 10, visibility = 0.9): PoseSequence =>
  sequence(
    Array.from({ length: count }, (_, i) =>
      athlete({ size, visibility, timeSeconds: i / 15 })
    )
  );

describe('median', () => {
  it('returns the middle value for odd counts', () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it('averages the two middle values for even counts', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('returns null for an empty list', () => {
    expect(median([])).toBeNull();
  });
});

describe('bodyLength', () => {
  it('measures ankle midpoint to shoulder midpoint', () => {
    expect(bodyLength(athlete({ size: 0.4 }))!).toBeCloseTo(0.4, 6);
  });

  it('is invariant to where the athlete stands in the frame', () => {
    const left = bodyLength(athlete({ size: 0.4, centerX: 0.15 }))!;
    const right = bodyLength(athlete({ size: 0.4, centerX: 0.85 }))!;
    expect(left).toBeCloseTo(right, 6);
  });

  it('ignores landmarks below the visibility threshold', () => {
    expect(bodyLength(athlete({ size: 0.4, visibility: 0.05 }))).toBeNull();
  });

  it('returns null when an endpoint is missing entirely', () => {
    const frame: PoseFrame = {
      timeSeconds: 0,
      score: 0.5,
      landmarks: { leftShoulder: { x: 0.5, y: 0.3, visibility: 0.9 } },
    };
    expect(bodyLength(frame)).toBeNull();
  });

  it('rejects a degenerate measurement too small to divide by', () => {
    expect(bodyLength(athlete({ size: 0.001 }))).toBeNull();
  });
});

describe('medianBodyLength', () => {
  it('reports how many frames contributed', () => {
    const mixed = sequence([
      athlete({ size: 0.4 }),
      athlete({ size: 0.4, visibility: 0.05 }),
      athlete({ size: 0.4 }),
    ]);
    const result = medianBodyLength(mixed);
    expect(result.samples).toBe(2);
    expect(result.length!).toBeCloseTo(0.4, 6);
  });

  it('shrugs off a few badly tracked frames', () => {
    // Two wild outliers among eight good frames must not move the median.
    const frames = [
      ...Array.from({ length: 8 }, () => athlete({ size: 0.4 })),
      athlete({ size: 0.9 }),
      athlete({ size: 0.05 }),
    ];
    expect(medianBodyLength(sequence(frames)).length!).toBeCloseTo(0.4, 2);
  });
});

describe('computeAutoScale', () => {
  it('recovers a known size ratio', () => {
    // The comparison athlete is half the size, so it needs 2x zoom.
    const result = computeAutoScale(uniform(0.4), uniform(0.2));
    expect(result.scale).toBeCloseTo(2, 4);
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('recovers a shrink ratio too', () => {
    const result = computeAutoScale(uniform(0.2), uniform(0.4));
    expect(result.scale).toBeCloseTo(0.5, 4);
  });

  it('returns 1 for athletes already the same size', () => {
    const result = computeAutoScale(uniform(0.35), uniform(0.35));
    expect(result.scale).toBeCloseTo(1, 6);
    expect(result.explanation).toMatch(/already appear the same size/i);
  });

  it('is unaffected by where each athlete stands', () => {
    const left = sequence(
      Array.from({ length: 10 }, () => athlete({ size: 0.4, centerX: 0.2, centerY: 0.3 }))
    );
    const right = sequence(
      Array.from({ length: 10 }, () => athlete({ size: 0.2, centerX: 0.8, centerY: 0.7 }))
    );
    expect(computeAutoScale(left, right).scale).toBeCloseTo(2, 4);
  });

  it('reports no confidence rather than a guess when tracking fails', () => {
    const result = computeAutoScale(uniform(0.4), uniform(0.4, 10, 0.05));
    expect(result.scale).toBe(1);
    expect(result.confidence).toBe(0);
    expect(result.explanation).toMatch(/could not measure/i);
  });

  it('refuses to conclude from too few tracked frames', () => {
    const sparse = sequence([
      athlete({ size: 0.2 }),
      athlete({ size: 0.2, visibility: 0.05 }),
      athlete({ size: 0.2, visibility: 0.05 }),
      athlete({ size: 0.2, visibility: 0.05 }),
    ]);
    const result = computeAutoScale(uniform(0.4), sparse);
    expect(result.scale).toBe(1);
    expect(result.confidence).toBe(0);
    expect(result.explanation).toMatch(/too few/i);
  });

  it('lowers confidence when coverage is partial', () => {
    const patchy = sequence([
      ...Array.from({ length: 4 }, () => athlete({ size: 0.2 })),
      ...Array.from({ length: 16 }, () => athlete({ size: 0.2, visibility: 0.05 })),
    ]);
    const result = computeAutoScale(uniform(0.4, 20), patchy);
    expect(result.scale).toBeCloseTo(2, 4);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('is the inverse of itself when the clips are swapped', () => {
    const forward = computeAutoScale(uniform(0.4), uniform(0.25)).scale;
    const backward = computeAutoScale(uniform(0.25), uniform(0.4)).scale;
    expect(forward * backward).toBeCloseTo(1, 6);
  });
});
