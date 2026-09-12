import { detectApex, detectLanding, detectTakeoff, parabolicRefine } from '@/services/sync/events';
import type { MotionSignal } from '@/services/sync/signal';

/** Ballistic arc: flat, rise to an apex, fall, flat. */
function jumpSignal(apexIndex: number, flightSamples: number, length: number): number[] {
  const start = apexIndex - flightSamples / 2;
  const end = apexIndex + flightSamples / 2;
  return Array.from({ length }, (_, i) => {
    if (i <= start || i >= end) return 0;
    const phase = (i - start) / flightSamples;
    return 4 * phase * (1 - phase);
  });
}

const asSignal = (values: number[], sampleFps = 10, startSeconds = 0): MotionSignal => ({
  values,
  startSeconds,
  sampleFps,
  coverage: 1,
  channel: 'hipHeight',
});

describe('parabolicRefine', () => {
  it('returns zero for a symmetric peak', () => {
    expect(parabolicRefine([0, 1, 0], 1)).toBeCloseTo(0, 10);
  });

  it('leans toward the taller neighbour', () => {
    expect(parabolicRefine([0, 1, 0.5], 1)).toBeGreaterThan(0);
    expect(parabolicRefine([0.5, 1, 0], 1)).toBeLessThan(0);
  });

  it('stays within half a sample', () => {
    expect(Math.abs(parabolicRefine([0, 1, 0.99], 1))).toBeLessThanOrEqual(0.5);
  });

  it('returns zero at the array edges and on flat input', () => {
    expect(parabolicRefine([1, 2, 3], 0)).toBe(0);
    expect(parabolicRefine([1, 2, 3], 2)).toBe(0);
    expect(parabolicRefine([2, 2, 2], 1)).toBe(0);
  });
});

describe('detectApex', () => {
  it('locates the apex of a jump', () => {
    const apex = detectApex(asSignal(jumpSignal(30, 20, 60)));
    expect(apex).not.toBeNull();
    expect(apex!.index).toBeCloseTo(30, 0);
    expect(apex!.timeSeconds).toBeCloseTo(3, 1);
  });

  it('accounts for the signal start time', () => {
    const apex = detectApex(asSignal(jumpSignal(30, 20, 60), 10, 5));
    expect(apex!.timeSeconds).toBeCloseTo(8, 1);
  });

  it('returns null for a flat signal', () => {
    expect(detectApex(asSignal(new Array(30).fill(0.5)))).toBeNull();
  });

  it('returns null for an empty signal', () => {
    expect(detectApex(asSignal([]))).toBeNull();
  });
});

describe('detectTakeoff', () => {
  it('fires before the apex, on the rising edge', () => {
    const signal = asSignal(jumpSignal(30, 20, 60));
    const takeoff = detectTakeoff(signal)!;
    const apex = detectApex(signal)!;
    expect(takeoff.index).toBeLessThan(apex.index);
    expect(takeoff.index).toBeGreaterThan(18);
  });

  it('returns null when nothing ever rises', () => {
    const falling = Array.from({ length: 30 }, (_, i) => -i);
    expect(detectTakeoff(asSignal(falling))).toBeNull();
  });
});

describe('detectLanding', () => {
  it('fires after the apex, on the falling edge', () => {
    const signal = asSignal(jumpSignal(30, 20, 60));
    const landing = detectLanding(signal)!;
    const apex = detectApex(signal)!;
    expect(landing.index).toBeGreaterThan(apex.index);
  });

  it('returns null when the signal never falls after its peak', () => {
    const rising = Array.from({ length: 30 }, (_, i) => i);
    expect(detectLanding(asSignal(rising))).toBeNull();
  });
});

describe('event timing accuracy', () => {
  it('resolves apex position more precisely than the sample grid', () => {
    // True apex at 30.5 samples: a sample-rounded detector could only say 30 or 31.
    const values = Array.from({ length: 60 }, (_, i) => -((i - 30.5) ** 2));
    const apex = detectApex(asSignal(values), 1)!;
    expect(apex.index).toBeGreaterThan(30.2);
    expect(apex.index).toBeLessThan(30.8);
  });
});
