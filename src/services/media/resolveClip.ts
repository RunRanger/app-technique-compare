/**
 * Resolving a persisted {@link VideoRef} into a playable {@link ResolvedClip}.
 *
 * Kept separate from the MediaLibrary wrapper so the rest of the app never has
 * to care which kind of reference it holds.
 */

import { File } from 'expo-file-system';

import { EMPTY_META, type ResolvedClip, type VideoMeta, type VideoRef } from '@/types';

import { resolveAssetUri } from './mediaLibrary';

export class ClipUnavailableError extends Error {
  constructor(
    public readonly ref: VideoRef,
    message: string
  ) {
    super(message);
    this.name = 'ClipUnavailableError';
  }
}

export async function resolveClip(
  ref: VideoRef,
  options: { name?: string; meta?: VideoMeta; collectionItemId?: string } = {}
): Promise<ResolvedClip> {
  if (ref.kind === 'mediaLibrary') {
    try {
      const { uri, meta, filename } = await resolveAssetUri(ref.id);
      return {
        ref,
        uri,
        name: options.name ?? filename,
        // Prefer freshly read metadata, but keep any fps we learned earlier —
        // the media library never reports it.
        meta: { ...meta, fps: options.meta?.fps ?? meta.fps },
        collectionItemId: options.collectionItemId,
      };
    } catch {
      throw new ClipUnavailableError(
        ref,
        'This video is no longer in your library. It may have been deleted or moved to iCloud.'
      );
    }
  }

  // A raw file: only ever an unsaved recording in the cache directory.
  const file = new File(ref.id);
  if (!file.exists) {
    throw new ClipUnavailableError(ref, 'This recording is no longer available.');
  }
  return {
    ref,
    uri: ref.id,
    name: options.name ?? 'Recording',
    meta: options.meta ?? EMPTY_META,
    collectionItemId: options.collectionItemId,
  };
}

/** Deletes a temporary recording that the user chose not to keep. */
export async function discardTemporaryRecording(uri: string): Promise<void> {
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch (error) {
    // A leftover file in the cache directory is harmless — the OS reclaims it.
    console.warn('[resolveClip] could not delete temporary recording', error);
  }
}
