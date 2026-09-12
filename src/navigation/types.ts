import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { ClipSlot } from '@/types';

export type RootStackParamList = {
  /**
   * Root. The saved collection, where clips are selected into the two
   * comparison slots, plus the entry points for new material.
   */
  Collection: undefined;
  /**
   * Live capture. `slot` pins the recording to a specific slot; omitted, it
   * lands in the next free one like any other selection.
   */
  Record: { slot?: ClipSlot } | undefined;
  /** Review a fresh recording: retake, use, or save to the collection. */
  RecordPreview: { slot?: ClipSlot; uri: string };
  /** Align the two clips before comparing. */
  Sync: undefined;
  /** Synchronized playback with the three visualization modes. */
  Compare: undefined;
};

export type RootScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;

// Teaches React Navigation's untyped global helpers (`useNavigation` without a
// generic, the `Link` component) about this app's routes.
declare global {
  namespace ReactNavigation {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface RootParamList extends RootStackParamList {}
  }
}
