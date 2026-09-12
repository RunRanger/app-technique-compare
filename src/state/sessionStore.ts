/**
 * The current comparison session: which two clips, how they are aligned, and
 * how they are being displayed.
 *
 * Deliberately *not* persisted — a session is transient. What persists is the
 * collection (see `collectionStore`) and the per-pair offsets below, which are
 * worth remembering: re-syncing the same two clips by hand every time would be
 * tedious.
 *
 * Playhead position lives outside this store, in the playback controller, so
 * that 60 Hz time updates never re-render the component tree.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { ClipSlot, CompareMode, ResolvedClip, VideoMeta } from '@/types';
import type { AutoSyncResult } from '@/services/sync/autoSync';

export interface SessionState {
  reference: ResolvedClip | null;
  comparison: ResolvedClip | null;
  /** Seconds to add to reference time to reach the matching comparison moment. */
  offsetSeconds: number;
  /** Result of the last auto-sync run, kept so the UI can explain the number. */
  lastAutoSync: AutoSyncResult | null;
  mode: CompareMode;
  /** Overlay blend, 0 = only reference visible, 1 = only comparison. */
  overlayOpacity: number;
  /** Split divider position, 0..1 across the frame. */
  splitPosition: number;
  /** Mute during comparison — two soundtracks at once is rarely wanted. */
  muted: boolean;
  playbackRate: number;
  mirrorReference: boolean;
  mirrorComparison: boolean;

  setClip: (slot: ClipSlot, clip: ResolvedClip | null) => void;
  /**
   * Assigns a clip without the caller naming a slot: reference first, then
   * comparison. With both taken it replaces the comparison clip, which is the
   * common case — you keep the model you are comparing against and cycle
   * through attempts. Returns the slot it used.
   */
  assignToNextSlot: (clip: ResolvedClip) => ClipSlot;
  /** Which slot, if any, currently holds this clip reference. */
  slotOf: (refId: string) => ClipSlot | null;
  clearSlot: (slot: ClipSlot) => void;
  swapClips: () => void;
  setOffset: (offsetSeconds: number) => void;
  nudgeOffset: (deltaSeconds: number) => void;
  setAutoSyncResult: (result: AutoSyncResult | null) => void;
  setMode: (mode: CompareMode) => void;
  setOverlayOpacity: (value: number) => void;
  setSplitPosition: (value: number) => void;
  setMuted: (muted: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  setMirrored: (slot: ClipSlot, mirrored: boolean) => void;
  toggleMirrored: (slot: ClipSlot) => void;
  /** Records fps/duration once the player reports them. */
  updateClipMeta: (slot: ClipSlot, meta: Partial<VideoMeta>) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  reference: null,
  comparison: null,
  offsetSeconds: 0,
  lastAutoSync: null,
  mode: 'sideBySide',
  overlayOpacity: 0.5,
  splitPosition: 0.5,
  muted: true,
  playbackRate: 1,
  mirrorReference: false,
  mirrorComparison: false,

  setClip: (slot, clip) =>
    set(() =>
      slot === 'reference'
        ? { reference: clip, lastAutoSync: null, mirrorReference: clip?.mirrored ?? false }
        : { comparison: clip, lastAutoSync: null, mirrorComparison: clip?.mirrored ?? false }
    ),

  assignToNextSlot: (clip) => {
    const { reference } = get();
    const slot: ClipSlot = reference == null ? 'reference' : 'comparison';
    set(
      slot === 'reference'
        ? { reference: clip, lastAutoSync: null, mirrorReference: clip.mirrored ?? false }
        : { comparison: clip, lastAutoSync: null, mirrorComparison: clip.mirrored ?? false }
    );
    return slot;
  },

  slotOf: (refId) => {
    const { reference, comparison } = get();
    if (reference?.ref.id === refId) return 'reference';
    if (comparison?.ref.id === refId) return 'comparison';
    return null;
  },

  clearSlot: (slot) =>
    set(() =>
      slot === 'reference'
        ? { reference: null, offsetSeconds: 0, lastAutoSync: null }
        : { comparison: null, offsetSeconds: 0, lastAutoSync: null }
    ),

  swapClips: () => {
    const { reference, comparison, offsetSeconds, mirrorReference, mirrorComparison } = get();
    set({
      reference: comparison,
      comparison: reference,
      // Swapping the clips inverts the meaning of the offset.
      offsetSeconds: -offsetSeconds,
      // Mirroring belongs to the clip, so it travels with it.
      mirrorReference: mirrorComparison,
      mirrorComparison: mirrorReference,
      lastAutoSync: null,
    });
  },

  setOffset: (offsetSeconds) => set({ offsetSeconds }),
  nudgeOffset: (deltaSeconds) => set((state) => ({ offsetSeconds: state.offsetSeconds + deltaSeconds })),
  setAutoSyncResult: (lastAutoSync) => set({ lastAutoSync }),
  setMode: (mode) => set({ mode }),
  setOverlayOpacity: (overlayOpacity) => set({ overlayOpacity: clamp01(overlayOpacity) }),
  setSplitPosition: (splitPosition) => set({ splitPosition: clamp01(splitPosition) }),
  setMuted: (muted) => set({ muted }),
  setPlaybackRate: (playbackRate) => set({ playbackRate }),

  setMirrored: (slot, mirrored) =>
    set(slot === 'reference' ? { mirrorReference: mirrored } : { mirrorComparison: mirrored }),

  toggleMirrored: (slot) =>
    set((state) =>
      slot === 'reference'
        ? { mirrorReference: !state.mirrorReference }
        : { mirrorComparison: !state.mirrorComparison }
    ),

  updateClipMeta: (slot, meta) =>
    set((state) => {
      const clip = slot === 'reference' ? state.reference : state.comparison;
      if (!clip) return {};
      const updated: ResolvedClip = { ...clip, meta: { ...clip.meta, ...meta } };
      return slot === 'reference' ? { reference: updated } : { comparison: updated };
    }),

  reset: () =>
    set({
      reference: null,
      comparison: null,
      offsetSeconds: 0,
      lastAutoSync: null,
      mode: 'sideBySide',
    }),
}));

/**
 * Remembered manual alignments, keyed by the pair of clips.
 *
 * Order-independent key, with a sign convention pinned to the sorted order, so
 * the same pair loaded either way round recovers the same alignment.
 */
interface OffsetMemoryState {
  offsets: Record<string, number>;
  remember: (refA: string, refB: string, offsetSeconds: number) => void;
  recall: (refA: string, refB: string) => number | null;
}

const pairKey = (a: string, b: string): { key: string; inverted: boolean } => {
  const inverted = a > b;
  const [first, second] = inverted ? [b, a] : [a, b];
  return { key: `${first}::${second}`, inverted };
};

export const useOffsetMemory = create<OffsetMemoryState>()(
  persist(
    (set, get) => ({
      offsets: {},
      remember: (refA, refB, offsetSeconds) => {
        const { key, inverted } = pairKey(refA, refB);
        set((state) => ({
          offsets: { ...state.offsets, [key]: inverted ? -offsetSeconds : offsetSeconds },
        }));
      },
      recall: (refA, refB) => {
        const { key, inverted } = pairKey(refA, refB);
        const stored = get().offsets[key];
        if (stored == null) return null;
        return inverted ? -stored : stored;
      },
    }),
    {
      name: 'technique-compare.offsets.v1',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
