import {
  ANALYSIS_BUDGET_MS,
  MIN_USABLE_FRAMES,
  perClipDeadline,
  planSampling,
  shouldContinue,
} from '@/services/pose/budget';

describe('planSampling', () => {
  it('samples the window at the requested rate', () => {
    const plan = planSampling(0, 3, 8, 100);
    expect(plan.times.length).toBe(25);
    expect(plan.times[0]).toBeCloseTo(0);
    expect(plan.times[24]).toBeCloseTo(3);
    expect(plan.sampleFps).toBeCloseTo(8, 6);
  });

  it('spaces samples evenly', () => {
    const plan = planSampling(1, 4, 8, 100);
    for (let i = 1; i < plan.times.length; i++) {
      expect(plan.times[i]! - plan.times[i - 1]!).toBeCloseTo(1 / 8, 6);
    }
  });

  it('caps the frame count and reports the rate it actually achieved', () => {
    const plan = planSampling(0, 10, 30, 20);
    expect(plan.times.length).toBe(20);
    // Reporting the nominal 30 fps here would make every downstream time wrong.
    expect(plan.sampleFps).toBeLessThan(30);
    expect(plan.sampleFps).toBeCloseTo(19 / 10, 6);
  });

  it('keeps the reported rate consistent with the spacing it produced', () => {
    const plan = planSampling(0, 10, 30, 20);
    const step = plan.times[1]! - plan.times[0]!;
    expect(1 / step).toBeCloseTo(plan.sampleFps, 6);
  });

  it('still returns one sample for a zero-length window', () => {
    const plan = planSampling(2, 2, 8, 50);
    expect(plan.times).toEqual([2]);
  });

  it('never exceeds the cap', () => {
    expect(planSampling(0, 60, 30, 12).times.length).toBe(12);
  });
});

describe('perClipDeadline', () => {
  it('splits the budget between clips and leaves room for overhead', () => {
    const start = 1_000_000;
    const deadline = perClipDeadline(start, 2);
    const perClip = deadline - start;
    expect(perClip).toBeGreaterThan(0);
    // Two clips plus overhead must fit inside the overall budget.
    expect(perClip * 2).toBeLessThanOrEqual(ANALYSIS_BUDGET_MS);
  });
});

describe('shouldContinue', () => {
  const deadline = 10_000;

  it('keeps going until there is enough data to be usable at all', () => {
    // Well past the deadline, but stopping here would return nothing usable.
    expect(shouldContinue(99_999, deadline, 2, 500, 4)).toBe(true);
  });

  it('stops once the next chunk would not fit', () => {
    // 20 frames done, 100ms each, 4 more would land at 9800 — fits.
    expect(shouldContinue(9_400, deadline, 20, 100, 4)).toBe(true);
    // Same rate but starting later would overshoot.
    expect(shouldContinue(9_700, deadline, 20, 100, 4)).toBe(false);
  });

  it('does not let one slow final chunk run past the deadline', () => {
    // Just inside the deadline, but each frame costs 400ms.
    expect(shouldContinue(9_900, deadline, 20, 400, 4)).toBe(false);
  });

  it('falls back to a plain deadline check before any timing is known', () => {
    expect(shouldContinue(9_000, deadline, 20, 0, 4)).toBe(true);
    expect(shouldContinue(10_500, deadline, 20, 0, 4)).toBe(false);
  });

  it('respects the documented minimum', () => {
    expect(shouldContinue(99_999, deadline, MIN_USABLE_FRAMES - 1, 999, 4)).toBe(true);
    expect(shouldContinue(99_999, deadline, MIN_USABLE_FRAMES, 999, 4)).toBe(false);
  });
});
