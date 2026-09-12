/**
 * Domain types shared across the app.
 *
 * The central persistence rule: we never copy video bytes into app storage.
 * A clip is always referenced by a *stable handle* — a MediaLibrary asset id
 * (persistent across launches on both platforms) or, for a not-yet-saved
 * recording, the temporary capture URI. The playable URI is resolved lazily,
 * because on iOS a `ph://`-backed local URI is not guaranteed to stay valid.
 */

/** Which slot a clip occupies in a comparison. */
export type ClipSlot = 'reference' | 'comparison';

export type VideoRefKind =
  /** Persistent `expo-media-library` asset id. Survives app restarts. */
  | 'mediaLibrary'
  /** A raw file URI — used only for a fresh recording before the user saves it. */
  | 'file';

/**
 * A stable, persistable pointer to a video. Deliberately *not* a playable URI:
 * URIs expire, ids do not.
 */
export interface VideoRef {
  kind: VideoRefKind;
  /** MediaLibrary asset id, or a `file://` URI when `kind === 'file'`. */
  id: string;
}

/** Intrinsic properties of a clip, filled in progressively as they are discovered. */
export interface VideoMeta {
  /** Seconds. `null` until the player or media library reports it. */
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  /**
   * Frames per second. Read from the player's video track when available,
   * otherwise `null` — callers should fall back to {@link DEFAULT_FPS}.
   */
  fps: number | null;
}

export const EMPTY_META: VideoMeta = {
  durationSeconds: null,
  width: null,
  height: null,
  fps: null,
};

/** Frame rate assumed when a clip does not report one. */
export const DEFAULT_FPS = 30;

/** An entry in the user's saved reference collection. */
export interface CollectionItem {
  /** Internal id, independent of the media asset id. */
  id: string;
  /** User-supplied name, e.g. "Yurchenko — comp 2025". */
  name: string;
  ref: VideoRef;
  meta: VideoMeta;
  createdAt: number;
  note?: string;
}

/** A clip that has been resolved to something a player can actually open. */
export interface ResolvedClip {
  ref: VideoRef;
  /** Playable URI, valid for this session. */
  uri: string;
  /** Display name — collection name, filename, or "Recording". */
  name: string;
  meta: VideoMeta;
  /** Set when the clip came from the saved collection. */
  collectionItemId?: string;
}

/** Visualization modes offered in comparison mode. */
export type CompareMode = 'sideBySide' | 'overlay' | 'split';

export const COMPARE_MODES: { key: CompareMode; label: string; icon: string }[] = [
  { key: 'sideBySide', label: 'Side by side', icon: '▤' },
  { key: 'overlay', label: 'Overlay', icon: '◑' },
  { key: 'split', label: 'Split', icon: '◧' },
];
