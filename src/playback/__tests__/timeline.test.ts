import {
  clampOffset,
  computeTimeline,
  formatOffset,
  formatTimecode,
  frameDuration,
  frameIndexAt,
  masterToClipTimes,
  offsetBounds,
  preservePosition,
  snapToFrame,
} from '@/playback/timeline';

describe('frameDuration', () => {
  it('inverts a valid frame rate', () => {
    expect(frameDuration(30)).toBeCloseTo(1 / 30, 10);
    expect(frameDuration(60)).toBeCloseTo(1 / 60, 10);
    expect(frameDuration(239.76)).toBeCloseTo(1 / 239.76, 10);
  });

  it('falls back to 30 fps for missing or nonsensical values', () => {
    for (const bad of [null, undefined, 0, -5, NaN, Infinity]) {
      expect(frameDuration(bad as number)).toBeCloseTo(1 / 30, 10);
    }
  });
});

describe('snapToFrame', () => {
  it('lands inside the target frame rather than on its boundary', () => {
    const fps = 30;
    const step = 1 / fps;
    const snapped = snapToFrame(step * 4 + 0.001, fps);
    expect(frameIndexAt(snapped, fps)).toBe(4);
    // Strictly inside the frame, so a decoder cannot resolve it to frame 3.
    expect(snapped).toBeGreaterThan(step * 4);
    expect(snapped).toBeLessThan(step * 5);
  });

  it('is idempotent — snapping a snapped time keeps the same frame', () => {
    const fps = 59.94;
    for (const t of [0, 0.2, 1.337, 12.5]) {
      const once = snapToFrame(t, fps);
      const twice = snapToFrame(once, fps);
      expect(frameIndexAt(twice, fps)).toBe(frameIndexAt(once, fps));
    }
  });

  it('never returns a negative time', () => {
    expect(snapToFrame(-3, 30)).toBeGreaterThanOrEqual(0);
  });
});

describe('computeTimeline', () => {
  it('spans the whole clip when durations match and offset is zero', () => {
    const t = computeTimeline(10, 10, 0);
    expect(t).toMatchObject({ start: 0, end: 10, duration: 10, degraded: false });
  });

  it('trims the head when the comparison clip must start early (negative offset)', () => {
    // o = -2: reference t maps to comparison t-2, so t must be >= 2.
    const t = computeTimeline(10, 10, -2);
    expect(t.start).toBeCloseTo(2);
    expect(t.end).toBeCloseTo(10);
    expect(t.degraded).toBe(false);
  });

  it('trims the tail when the comparison clip runs out first (positive offset)', () => {
    const t = computeTimeline(10, 10, 3);
    expect(t.start).toBeCloseTo(0);
    expect(t.end).toBeCloseTo(7);
  });

  it('uses the shorter clip when durations differ', () => {
    const t = computeTimeline(20, 5, 0);
    expect(t.end).toBeCloseTo(5);
  });

  it('degrades gracefully when the offset removes all overlap', () => {
    const t = computeTimeline(10, 10, 50);
    expect(t.degraded).toBe(true);
    expect(t.duration).toBeGreaterThan(0);
  });

  it('treats missing durations as zero without producing NaN', () => {
    const t = computeTimeline(null, null, 0);
    expect(Number.isFinite(t.start)).toBe(true);
    expect(Number.isFinite(t.end)).toBe(true);
    expect(t.duration).toBeGreaterThanOrEqual(0);
  });
});

describe('masterToClipTimes', () => {
  it('applies the offset to the comparison clip only', () => {
    expect(masterToClipTimes(4, 1.5, 10, 10)).toEqual({ reference: 4, comparison: 5.5 });
  });

  it('clamps each clip to its own bounds independently', () => {
    // Comparison clip is short: it holds on its last frame instead of seeking past it.
    expect(masterToClipTimes(9, 2, 10, 6)).toEqual({ reference: 9, comparison: 6 });
    // Negative mapped time holds on the first frame.
    expect(masterToClipTimes(0, -3, 10, 10)).toEqual({ reference: 0, comparison: 0 });
  });

  it('round-trips: every master time inside the timeline maps in-bounds for both clips', () => {
    const dRef = 8;
    const dCmp = 11;
    for (const offset of [-4, -1.5, 0, 0.25, 3, 6]) {
      const tl = computeTimeline(dRef, dCmp, offset);
      if (tl.degraded) continue;
      for (let i = 0; i <= 20; i++) {
        const master = tl.start + (tl.duration * i) / 20;
        const { reference, comparison } = masterToClipTimes(master, offset, dRef, dCmp);
        expect(reference).toBeGreaterThanOrEqual(0);
        expect(reference).toBeLessThanOrEqual(dRef + 1e-9);
        expect(comparison).toBeGreaterThanOrEqual(0);
        expect(comparison).toBeLessThanOrEqual(dCmp + 1e-9);
        // Inside a non-degraded timeline no clamping should be needed at all.
        expect(comparison).toBeCloseTo(master + offset, 9);
      }
    }
  });
});

describe('offsetBounds / clampOffset', () => {
  it('allows shifting either clip fully past the other', () => {
    expect(offsetBounds(10, 4)).toEqual({ min: -10, max: 4 });
  });

  it('clamps out-of-range offsets', () => {
    expect(clampOffset(99, 10, 4)).toBe(4);
    expect(clampOffset(-99, 10, 4)).toBe(-10);
    expect(clampOffset(2, 10, 4)).toBe(2);
  });

  it('stays usable when durations are unknown', () => {
    expect(offsetBounds(null, null)).toEqual({ min: -1, max: 1 });
  });
});

describe('preservePosition', () => {
  it('keeps the playhead inside the new timeline after an offset change', () => {
    const tl = computeTimeline(10, 10, 3); // [0, 7]
    expect(preservePosition(9, tl)).toBeCloseTo(7);
    expect(preservePosition(4, tl)).toBeCloseTo(4);
  });
});

describe('formatting', () => {
  it('formats timecodes with centisecond precision', () => {
    expect(formatTimecode(0)).toBe('00:00.00');
    expect(formatTimecode(63.42)).toBe('01:03.42');
    expect(formatTimecode(NaN)).toBe('--:--.--');
  });

  it('formats offsets in both seconds and frames', () => {
    expect(formatOffset(0.1, 30)).toBe('+0.100 s (+3 f)');
    expect(formatOffset(-0.1, 30)).toBe('−0.100 s (−3 f)');
  });
});
