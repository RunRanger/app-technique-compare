import { DEFAULT_DRIFT_POLICY, evaluateDrift } from '@/playback/syncEngine';

describe('evaluateDrift', () => {
  const policy = DEFAULT_DRIFT_POLICY;

  it('ignores sub-tolerance drift so playback is not needlessly interrupted', () => {
    const decision = evaluateDrift(5, 5.01, 0, 10_000, policy);
    expect(decision.correct).toBe(false);
    expect(decision.driftSeconds).toBeCloseTo(0.01);
  });

  it('measures drift relative to the offset, not to raw time', () => {
    // Offset of 2 s means the comparison player *should* be at 7 when reference is 5.
    const decision = evaluateDrift(5, 7, 2, 10_000, policy);
    expect(decision.driftSeconds).toBeCloseTo(0);
    expect(decision.correct).toBe(false);
  });

  it('corrects visible drift once the cooldown has elapsed', () => {
    const decision = evaluateDrift(5, 5.12, 0, 10_000, policy);
    expect(decision.correct).toBe(true);
    expect(decision.targetTime).toBeCloseTo(5);
  });

  it('holds off on correcting during the cooldown', () => {
    const decision = evaluateDrift(5, 5.12, 0, 100, policy);
    expect(decision.correct).toBe(false);
  });

  it('overrides the cooldown for a large desync', () => {
    // A stall should be fixed immediately, not after another 600 ms of mismatch.
    const decision = evaluateDrift(5, 6.0, 0, 0, policy);
    expect(decision.correct).toBe(true);
  });

  it('reports the sign of the drift', () => {
    expect(evaluateDrift(5, 5.5, 0, 10_000, policy).driftSeconds).toBeGreaterThan(0);
    expect(evaluateDrift(5, 4.5, 0, 10_000, policy).driftSeconds).toBeLessThan(0);
  });

  it('always targets the offset-corrected time', () => {
    const decision = evaluateDrift(3, 9, 1.5, 10_000, policy);
    expect(decision.targetTime).toBeCloseTo(4.5);
  });
});
