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
  /**
   * Whether this clip should be shown flipped horizontally. Stored per entry
   * because it is a property of the footage — a routine performed the other way
   * round, or a camera behind the athlete — not of a single comparison.
   */
  mirrored?: boolean;
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
  /** Show the image flipped horizontally. */
  mirrored?: boolean;
}

/**
 * How one clip is framed inside its surface.
 *
 * Two athletes filmed from different distances look like different-sized people
 * even when perfectly synchronized, which makes shapes hard to compare. Zooming
 * one clip to match the other is a display-only correction: it never touches the
 * decoded video, the timeline, or the alignment.
 */
export interface ClipView {
  /** Uniform zoom. 1 = untouched. */
  scale: number;
  /** Pan after zooming, as a fraction of the surface size. */
  offsetX: number;
  offsetY: number;
}

export const DEFAULT_CLIP_VIEW: ClipView = { scale: 1, offsetX: 0, offsetY: 0 };

/** Zoom limits. Beyond these the image is either unusably soft or pointless. */
export const CLIP_SCALE_MIN = 0.4;
export const CLIP_SCALE_MAX = 3;
/** Pan limits, as a fraction of the surface size. */
export const CLIP_OFFSET_LIMIT = 0.5;

export function clampClipView(view: ClipView): ClipView {
  const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
  return {
    scale: clamp(view.scale, CLIP_SCALE_MIN, CLIP_SCALE_MAX),
    offsetX: clamp(view.offsetX, -CLIP_OFFSET_LIMIT, CLIP_OFFSET_LIMIT),
    offsetY: clamp(view.offsetY, -CLIP_OFFSET_LIMIT, CLIP_OFFSET_LIMIT),
  };
}

/** Visualization modes offered in comparison mode. */
export type CompareMode = 'sideBySide' | 'overlay' | 'split';

export const COMPARE_MODES: { key: CompareMode; label: string; icon: string }[] = [
  { key: 'sideBySide', label: 'Side by side', icon: '▤' },
  { key: 'overlay', label: 'Overlay', icon: '◑' },
  { key: 'split', label: 'Split', icon: '◧' },
];
