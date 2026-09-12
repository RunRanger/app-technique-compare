/**
 * Thin wrapper over `expo-media-library`'s asset API.
 *
 * The rule this module exists to enforce: **we store ids, never copies.**
 * A MediaLibrary asset id is stable across app launches on both platforms, while
 * the playable URI behind it is not (on iOS it is derived from a `PHAsset` and
 * can change or need re-resolving). So everything persisted holds an id, and the
 * URI is fetched on demand right before playback.
 */

import * as MediaLibrary from 'expo-media-library';
import { Platform } from 'react-native';

import type { VideoMeta, VideoRef } from '@/types';

export interface GalleryVideo {
  /** Persistent asset id. */
  id: string;
  filename: string;
  /** Seconds, or `null` when the platform did not report it. */
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  createdAt: number | null;
}

export type MediaPermissionState = 'granted' | 'limited' | 'denied' | 'undetermined';

/**
 * Requests read access. `'limited'` (iOS selected-photos mode) is deliberately
 * treated as usable rather than as a failure — the user can still pick from what
 * they granted, and `presentPermissionsPicker` lets them extend it later.
 */
export async function ensureMediaPermission(): Promise<MediaPermissionState> {
  const current = await MediaLibrary.getPermissionsAsync(false, ['video']);
  if (current.granted) return current.accessPrivileges === 'limited' ? 'limited' : 'granted';
  if (!current.canAskAgain) return 'denied';

  const requested = await MediaLibrary.requestPermissionsAsync(false, ['video']);
  if (requested.granted) return requested.accessPrivileges === 'limited' ? 'limited' : 'granted';
  return requested.canAskAgain ? 'undetermined' : 'denied';
}

/** Requests write access, needed before saving a recording. */
export async function ensureMediaWritePermission(): Promise<boolean> {
  const current = await MediaLibrary.getPermissionsAsync(true, ['video']);
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await MediaLibrary.requestPermissionsAsync(true, ['video'])).granted;
}

/** iOS only: lets the user widen a limited-access selection. */
export async function presentLimitedAccessPicker(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  await MediaLibrary.presentPermissionsPicker(['video']);
}

/**
 * Lists device videos, newest first.
 *
 * Uses `exeForMetadata`, which returns the fields we need in one native call —
 * the per-asset accessors would mean a round trip per field per asset and make
 * a gallery of a few hundred clips unusably slow.
 */
export async function listGalleryVideos(limit = 120, offset = 0): Promise<GalleryVideo[]> {
  const query = new MediaLibrary.Query()
    .eq(MediaLibrary.AssetField.MEDIA_TYPE, MediaLibrary.MediaType.VIDEO)
    .orderBy({ key: MediaLibrary.AssetField.CREATION_TIME, ascending: false })
    .limit(limit)
    .offset(offset);

  const metadata = await query.exeForMetadata();

  return metadata.map((item) => ({
    id: item.id,
    filename: item.filename ?? 'Untitled',
    durationSeconds: item.duration,
    width: item.width,
    height: item.height,
    createdAt: item.creationTime,
  }));
}

/**
 * Resolves a persistent asset id to something a player can open, right now.
 * Throws if the asset has been deleted from the device since it was saved.
 */
export async function resolveAssetUri(assetId: string): Promise<{ uri: string; meta: VideoMeta; filename: string }> {
  const asset = new MediaLibrary.Asset(assetId);
  const info = await asset.getInfo();
  return {
    uri: info.uri,
    filename: info.filename,
    meta: {
      durationSeconds: info.duration,
      width: info.width,
      height: info.height,
      fps: null, // Not exposed by the media library; read from the player instead.
    },
  };
}

/**
 * Saves a freshly recorded file into the user's library and returns a persistent
 * reference to it.
 *
 * This is the one place a file is written, and it writes to the *library*, not
 * to app storage — so the recording lives where the user expects it and the app
 * keeps only the id.
 */
export async function saveRecordingToLibrary(
  fileUri: string,
  albumName?: string
): Promise<{ ref: VideoRef; meta: VideoMeta; filename: string }> {
  const asset = await MediaLibrary.Asset.create(fileUri);

  if (albumName) {
    // Best-effort: album placement is a nicety, and on Android it can require
    // permissions the user declined. Failing here must not lose the recording.
    try {
      const existing = await MediaLibrary.Album.get(albumName);
      if (existing) {
        await existing.add(asset);
      } else {
        await MediaLibrary.Album.create(albumName, [asset], false);
      }
    } catch (error) {
      console.warn('[mediaLibrary] could not add asset to album', error);
    }
  }

  const info = await asset.getInfo();
  return {
    ref: { kind: 'mediaLibrary', id: asset.id },
    filename: info.filename,
    meta: {
      durationSeconds: info.duration,
      width: info.width,
      height: info.height,
      fps: null,
    },
  };
}

/** Whether an asset id still points at something on the device. */
export async function assetExists(assetId: string): Promise<boolean> {
  try {
    await new MediaLibrary.Asset(assetId).getInfo();
    return true;
  } catch {
    return false;
  }
}
