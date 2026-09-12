import { bestLag, correlationAtLag } from '@/services/sync/correlation';
import { normalize } from '@/services/sync/signal';

/** A single smooth bump — a stand-in for one jump. */
function bump(length: number, center: number, width = 4): number[] {
  return Array.from({ length }, (_, i) => Math.exp(-((i - center) ** 2) / (2 * width ** 2)));
}

describe('correlationAtLag', () => {
  it('returns 1 for identical signals at zero lag', () => {
    const a = bump(40, 20);
    expect(correlationAtLag(a, a, 0)).toBeCloseTo(1, 6);
  });

  it('returns -1 for inverted signals', () => {
    const a = bump(40, 20);
    const b = a.map((v) => -v);
    expect(correlationAtLag(a, b, 0)).toBeCloseTo(-1, 6);
  });

  it('is undefined (null) when a side is flat over the overlap', () => {
    expect(correlationAtLag(bump(40, 20), new Array(40).fill(3), 0)).toBeNull();
  });

  it('refuses lags that leave too little overlap', () => {
    expect(correlationAtLag(bump(10, 5), bump(10, 5), 9)).toBeNull();
  });

  it('is unaffected by scale and offset of either input', () => {
    const a = bump(40, 20);
    const b = a.map((v) => v * 13 + 4);
    expect(correlationAtLag(a, b, 0)).toBeCloseTo(1, 6);
  });
});

describe('bestLag', () => {
  it('finds a known positive lag', () => {
    // b's feature sits 7 samples later within b than a's does within a.
    const a = bump(60, 20);
    const b = bump(60, 27);
    const result = bestLag(a, b);
    expect(result.lagSamples).toBeCloseTo(7, 1);
    expect(result.score).toBeGreaterThan(0.95);
  });

  it('finds a known negative lag', () => {
    const result = bestLag(bump(60, 30), bump(60, 22));
    expect(result.lagSamples).toBeCloseTo(-8, 1);
  });

  it('recovers sub-sample lag via parabolic refinement', () => {
    // Shift by 5.5 samples: the true optimum lies between two integer lags.
    const a = bump(80, 30, 6);
    const b = Array.from({ length: 80 }, (_, i) =>
      Math.exp(-((i - 35.5) ** 2) / (2 * 6 ** 2))
    );
    const result = bestLag(a, b);
    expect(result.lagSamples).toBeGreaterThan(5.1);
    expect(result.lagSamples).toBeLessThan(5.9);
    // Strictly non-integer — proves refinement actually ran.
    expect(Number.isInteger(result.lagSamples)).toBe(false);
  });

  it('reports high distinctness for a single clear peak', () => {
    const result = bestLag(bump(80, 30, 5), bump(80, 38, 5));
    expect(result.distinctness).toBeGreaterThan(0.3);
  });

  it('reports low distinctness for a repetitive signal', () => {
    // A pure sine repeats, so many lags fit almost equally well.
    const sine = (phase: number) =>
      Array.from({ length: 80 }, (_, i) => Math.sin((i + phase) * 0.6));
    const result = bestLag(normalize(sine(0)), normalize(sine(5)));
    expect(result.distinctness).toBeLessThan(0.2);
  });

  it('honours the maximum lag bound', () => {
    const result = bestLag(bump(60, 10), bump(60, 50), 5);
    expect(Math.abs(result.lagSamples)).toBeLessThanOrEqual(5.5);
  });

  it('degrades to a zero, zero-confidence answer when no lag is evaluable', () => {
    const result = bestLag([1, 2], [1, 2]);
    expect(result).toEqual({ lagSamples: 0, score: 0, distinctness: 0 });
  });

  it('is antisymmetric: swapping the inputs negates the lag', () => {
    const a = bump(60, 20);
    const b = bump(60, 29);
    expect(bestLag(a, b).lagSamples).toBeCloseTo(-bestLag(b, a).lagSamples, 1);
  });
});
