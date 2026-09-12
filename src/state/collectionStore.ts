/**
 * The user's saved reference clips.
 *
 * Persisted to AsyncStorage. Only ids and user-supplied names are stored — no
 * video bytes are ever copied, so a collection of a hundred clips costs a few
 * kilobytes.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { CollectionItem, VideoMeta, VideoRef } from '@/types';

export interface CollectionState {
  items: CollectionItem[];
  /** False until AsyncStorage has been read, so the UI can avoid a flash of "empty". */
  hydrated: boolean;
  add: (input: { name: string; ref: VideoRef; meta: VideoMeta; note?: string }) => CollectionItem;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  updateMeta: (id: string, meta: Partial<VideoMeta>) => void;
  get: (id: string) => CollectionItem | undefined;
}

let idCounter = 0;
/** Monotonic within a session, prefixed by time — good enough for a local list. */
const makeId = (): string => `clip_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

export const useCollectionStore = create<CollectionState>()(
  persist(
    (set, get) => ({
      items: [],
      hydrated: false,

      add: ({ name, ref, meta, note }) => {
        const item: CollectionItem = {
          id: makeId(),
          name: name.trim() || 'Untitled clip',
          ref,
          meta,
          note,
          createdAt: Date.now(),
        };
        set((state) => ({ items: [item, ...state.items] }));
        return item;
      },

      rename: (id, name) =>
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id ? { ...item, name: name.trim() || item.name } : item
          ),
        })),

      remove: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),

      updateMeta: (id, meta) =>
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id ? { ...item, meta: { ...item.meta, ...meta } } : item
          ),
        })),

      get: (id) => get().items.find((item) => item.id === id),
    }),
    {
      name: 'technique-compare.collection.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ items: state.items }) as unknown as CollectionState,
      // Runs after AsyncStorage has been read. Referencing the store here is safe
      // because the callback fires strictly after `create` has returned.
      onRehydrateStorage: () => () => {
        useCollectionStore.setState({ hydrated: true });
      },
    }
  )
);
