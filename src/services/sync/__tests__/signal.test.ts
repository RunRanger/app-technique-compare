import { derivative, extractSignal, interpolateGaps, normalize, smooth } from '@/services/sync/signal';
import type { PoseFrame, PoseSequence } from '@/services/pose/types';

function frame(timeSeconds: number, hipY: number, ankleY = hipY + 0.2): PoseFrame {
  return {
    timeSeconds,
    score: 0.9,
    landmarks: {
      leftHip: { x: 0.45, y: hipY, visibility: 0.9 },
      rightHip: { x: 0.55, y: hipY, visibility: 0.9 },
      leftAnkle: { x: 0.45, y: ankleY, visibility: 0.9 },
      rightAnkle: { x: 0.55, y: ankleY, visibility: 0.9 },
    },
  };
}

function sequence(hipYs: number[], sampleFps = 10): PoseSequence {
  return {
    sourceId: 'test',
    sampleFps,
    frames: hipYs.map((y, i) => frame(i / sampleFps, y)),
  };
}

describe('interpolateGaps', () => {
  it('linearly bridges interior gaps', () => {
    expect(interpolateGaps([0, null, null, 3])).toEqual([0, 1, 2, 3]);
  });

  it('holds leading and trailing gaps at the nearest known value', () => {
    expect(interpolateGaps([null, null, 5, 6, null])).toEqual([5, 5, 5, 6, 6]);
  });

  it('returns zeros when nothing is known', () => {
    expect(interpolateGaps([null, null])).toEqual([0, 0]);
  });

  it('passes through a fully known series unchanged', () => {
    expect(interpolateGaps([1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe('extractSignal', () => {
  it('flips pose y so that "up" is positive', () => {
    // Hips move from y=0.8 (low) to y=0.4 (high in frame) => signal must increase.
    const signal = extractSignal(sequence([0.8, 0.6, 0.4]), 'hipHeight');
    expect(signal.values[0]!).toBeLessThan(signal.values[2]!);
    expect(signal.values).toEqual([-0.8, -0.6, -0.4]);
  });

  it('reports coverage when landmarks are missing', () => {
    const seq: PoseSequence = {
      sourceId: 'test',
      sampleFps: 10,
      frames: [
        frame(0, 0.8),
        { timeSeconds: 0.1, score: 0, landmarks: {} },
        frame(0.2, 0.6),
        frame(0.3, 0.5),
      ],
    };
    const signal = extractSignal(seq, 'hipHeight');
    expect(signal.coverage).toBeCloseTo(0.75);
    // The hole is bridged, not left as a spike.
    expect(signal.values[1]!).toBeCloseTo(-0.7);
  });

  it('ignores landmarks below the visibility threshold', () => {
    const seq: PoseSequence = {
      sourceId: 'test',
      sampleFps: 10,
      frames: [
        frame(0, 0.8),
        {
          timeSeconds: 0.1,
          score: 0.1,
          landmarks: {
            leftHip: { x: 0.5, y: 0.1, visibility: 0.05 },
            rightHip: { x: 0.5, y: 0.1, visibility: 0.05 },
          },
        },
        frame(0.2, 0.6),
      ],
    };
    const signal = extractSignal(seq, 'hipHeight');
    expect(signal.coverage).toBeCloseTo(2 / 3);
    // y=0.1 would be a huge spike if the low-visibility point were trusted.
    expect(signal.values[1]!).toBeCloseTo(-0.7);
  });

  it('derives vertical velocity that peaks where height rises fastest', () => {
    const signal = extractSignal(sequence([0.8, 0.8, 0.5, 0.4, 0.4]), 'verticalVelocity');
    let peak = 0;
    for (let i = 1; i < signal.values.length; i++) {
      if (signal.values[i]! > signal.values[peak]!) peak = i;
    }
    expect(peak).toBe(2);
  });

  it('tolerates a single visible side of a bilateral pair', () => {
    const seq: PoseSequence = {
      sourceId: 'test',
      sampleFps: 10,
      frames: [
        { timeSeconds: 0, score: 0.8, landmarks: { leftHip: { x: 0.4, y: 0.7, visibility: 0.9 } } },
      ],
    };
    expect(extractSignal(seq, 'hipHeight').values[0]!).toBeCloseTo(-0.7);
  });
});

describe('smooth', () => {
  it('shrinks the window at the edges instead of padding toward zero', () => {
    const out = smooth([10, 10, 10, 10], 3);
    expect(out).toEqual([10, 10, 10, 10]);
  });

  it('reduces the amplitude of a single-sample spike', () => {
    const out = smooth([0, 0, 9, 0, 0], 3);
    expect(out[2]!).toBeLessThan(9);
    expect(out[2]!).toBeCloseTo(3);
  });

  it('is a no-op for window sizes of 1 or less', () => {
    expect(smooth([1, 5, 2], 1)).toEqual([1, 5, 2]);
  });
});

describe('normalize', () => {
  it('produces zero mean and unit standard deviation', () => {
    const out = normalize([1, 2, 3, 4, 5]);
    const mean = out.reduce((a, b) => a + b, 0) / out.length;
    const sd = Math.sqrt(out.reduce((a, b) => a + (b - mean) ** 2, 0) / out.length);
    expect(mean).toBeCloseTo(0, 10);
    expect(sd).toBeCloseTo(1, 10);
  });

  it('returns zeros for a flat signal rather than dividing by zero', () => {
    expect(normalize([7, 7, 7])).toEqual([0, 0, 0]);
    expect(normalize([]).length).toBe(0);
  });

  it('is invariant to scale and shift — the property correlation relies on', () => {
    const a = normalize([1, 4, 2, 8, 3]);
    const b = normalize([1, 4, 2, 8, 3].map((v) => v * 7 + 100));
    a.forEach((value, i) => expect(value).toBeCloseTo(b[i]!, 10));
  });
});

describe('derivative', () => {
  it('recovers a constant slope', () => {
    const out = derivative([0, 1, 2, 3, 4], 1);
    expect(out[2]!).toBeCloseTo(1);
  });

  it('returns zeros for series shorter than two samples', () => {
    expect(derivative([5], 30)).toEqual([0]);
  });
});
