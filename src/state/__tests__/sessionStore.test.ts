import { useOffsetMemory, useSessionStore } from '@/state/sessionStore';
import type { ResolvedClip } from '@/types';

const clip = (id: string): ResolvedClip => ({
  ref: { kind: 'mediaLibrary', id },
  uri: `file:///${id}.mp4`,
  name: id,
  meta: { durationSeconds: 10, width: 1920, height: 1080, fps: 30 },
});

describe('sessionStore', () => {
  beforeEach(() => {
    useSessionStore.getState().reset();
    useSessionStore.setState({ offsetSeconds: 0 });
  });

  it('assigns clips to slots independently', () => {
    const store = useSessionStore.getState();
    store.setClip('reference', clip('a'));
    store.setClip('comparison', clip('b'));
    expect(useSessionStore.getState().reference?.name).toBe('a');
    expect(useSessionStore.getState().comparison?.name).toBe('b');
  });

  it('inverts the offset when clips are swapped', () => {
    const store = useSessionStore.getState();
    store.setClip('reference', clip('a'));
    store.setClip('comparison', clip('b'));
    store.setOffset(1.25);

    useSessionStore.getState().swapClips();

    const next = useSessionStore.getState();
    expect(next.reference?.name).toBe('b');
    expect(next.comparison?.name).toBe('a');
    // Offset means "add to reference time to get comparison time", so swapping negates it.
    expect(next.offsetSeconds).toBeCloseTo(-1.25);
  });

  it('fills video 1 first, then video 2', () => {
    const store = useSessionStore.getState();
    expect(store.assignToNextSlot(clip('a'))).toBe('reference');
    expect(useSessionStore.getState().assignToNextSlot(clip('b'))).toBe('comparison');
    expect(useSessionStore.getState().reference?.name).toBe('a');
    expect(useSessionStore.getState().comparison?.name).toBe('b');
  });

  it('replaces video 2 once both slots are taken, keeping video 1', () => {
    const store = useSessionStore.getState();
    store.assignToNextSlot(clip('a'));
    useSessionStore.getState().assignToNextSlot(clip('b'));

    // The reference is the clip you compare *against*, so it must survive
    // cycling through attempts.
    expect(useSessionStore.getState().assignToNextSlot(clip('c'))).toBe('comparison');
    expect(useSessionStore.getState().reference?.name).toBe('a');
    expect(useSessionStore.getState().comparison?.name).toBe('c');
  });

  it('refills video 1 when it has been cleared', () => {
    const store = useSessionStore.getState();
    store.assignToNextSlot(clip('a'));
    useSessionStore.getState().assignToNextSlot(clip('b'));
    useSessionStore.getState().clearSlot('reference');

    expect(useSessionStore.getState().assignToNextSlot(clip('c'))).toBe('reference');
    expect(useSessionStore.getState().reference?.name).toBe('c');
  });

  it('reports which slot holds a given clip reference', () => {
    const store = useSessionStore.getState();
    store.assignToNextSlot(clip('a'));
    useSessionStore.getState().assignToNextSlot(clip('b'));

    const state = useSessionStore.getState();
    expect(state.slotOf('a')).toBe('reference');
    expect(state.slotOf('b')).toBe('comparison');
    expect(state.slotOf('nope')).toBeNull();
  });

  it('clears the stale auto-sync explanation when a clip changes', () => {
    useSessionStore.setState({
      lastAutoSync: {
        offsetSeconds: 1,
        confidence: 0.9,
        method: 'correlation',
        correlationScore: 0.9,
        referenceEvent: null,
        comparisonEvent: null,
        eventOffsetSeconds: null,
        explanation: 'stale',
      },
    });
    useSessionStore.getState().setClip('comparison', clip('c'));
    expect(useSessionStore.getState().lastAutoSync).toBeNull();
  });

  it('preserves the reference clip when only the comparison slot is cleared', () => {
    const store = useSessionStore.getState();
    store.setClip('reference', clip('a'));
    store.setClip('comparison', clip('b'));
    useSessionStore.getState().clearSlot('comparison');

    // The retake workflow depends on this.
    expect(useSessionStore.getState().reference?.name).toBe('a');
    expect(useSessionStore.getState().comparison).toBeNull();
  });

  it('clamps overlay opacity and split position to 0..1', () => {
    const store = useSessionStore.getState();
    store.setOverlayOpacity(5);
    expect(useSessionStore.getState().overlayOpacity).toBe(1);
    store.setOverlayOpacity(-2);
    expect(useSessionStore.getState().overlayOpacity).toBe(0);
    store.setSplitPosition(9);
    expect(useSessionStore.getState().splitPosition).toBe(1);
  });

  it('accumulates offset nudges', () => {
    const store = useSessionStore.getState();
    store.setOffset(0);
    store.nudgeOffset(1 / 30);
    useSessionStore.getState().nudgeOffset(1 / 30);
    expect(useSessionStore.getState().offsetSeconds).toBeCloseTo(2 / 30, 10);
  });

  it('merges clip metadata discovered later without dropping the clip', () => {
    useSessionStore.getState().setClip('reference', clip('a'));
    useSessionStore.getState().updateClipMeta('reference', { fps: 59.94 });
    const meta = useSessionStore.getState().reference!.meta;
    expect(meta.fps).toBeCloseTo(59.94);
    expect(meta.width).toBe(1920);
  });
});

describe('mirroring', () => {
  beforeEach(() => {
    useSessionStore.getState().reset();
    useSessionStore.setState({ mirrorReference: false, mirrorComparison: false });
  });

  it('toggles each slot independently', () => {
    useSessionStore.getState().toggleMirrored('reference');
    expect(useSessionStore.getState().mirrorReference).toBe(true);
    expect(useSessionStore.getState().mirrorComparison).toBe(false);

    useSessionStore.getState().toggleMirrored('comparison');
    expect(useSessionStore.getState().mirrorComparison).toBe(true);
  });

  it('seeds the flag from the clip, so a mirrored entry comes back mirrored', () => {
    useSessionStore.getState().setClip('reference', { ...clip('a'), mirrored: true });
    expect(useSessionStore.getState().mirrorReference).toBe(true);

    // And a clip without the flag clears it rather than inheriting the last one.
    useSessionStore.getState().setClip('reference', clip('b'));
    expect(useSessionStore.getState().mirrorReference).toBe(false);
  });

  it('seeds the flag through next-slot assignment too', () => {
    useSessionStore.getState().assignToNextSlot({ ...clip('a'), mirrored: true });
    expect(useSessionStore.getState().mirrorReference).toBe(true);
  });

  it('carries the flags along when the clips are swapped', () => {
    useSessionStore.getState().setClip('reference', { ...clip('a'), mirrored: true });
    useSessionStore.getState().setClip('comparison', clip('b'));

    useSessionStore.getState().swapClips();

    // Mirroring belongs to the footage, so it must follow the clip into slot 2.
    const state = useSessionStore.getState();
    expect(state.comparison?.name).toBe('a');
    expect(state.mirrorComparison).toBe(true);
    expect(state.mirrorReference).toBe(false);
  });
});

describe('offset memory', () => {
  beforeEach(() => useOffsetMemory.setState({ offsets: {} }));

  it('recalls an alignment for the same pair', () => {
    useOffsetMemory.getState().remember('a', 'b', 0.5);
    expect(useOffsetMemory.getState().recall('a', 'b')).toBeCloseTo(0.5);
  });

  it('recalls the inverted alignment when the pair is loaded the other way round', () => {
    useOffsetMemory.getState().remember('a', 'b', 0.5);
    // With the roles swapped the same physical alignment is the negated offset.
    expect(useOffsetMemory.getState().recall('b', 'a')).toBeCloseTo(-0.5);
  });

  it('is consistent regardless of which order it was stored in', () => {
    useOffsetMemory.getState().remember('z', 'a', 1.5);
    expect(useOffsetMemory.getState().recall('z', 'a')).toBeCloseTo(1.5);
    expect(useOffsetMemory.getState().recall('a', 'z')).toBeCloseTo(-1.5);
  });

  it('returns null for an unknown pair', () => {
    expect(useOffsetMemory.getState().recall('x', 'y')).toBeNull();
  });
});
