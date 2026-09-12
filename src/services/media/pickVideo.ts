/**
 * Picking a video through the **system** picker.
 *
 * Uses `expo-image-picker`, which presents the platform's own UI —
 * `PHPickerViewController` on iOS, the system photo picker on Android — rather
 * than a grid this app draws itself. Two real advantages beyond looking native:
 *
 *  - On iOS 14+ `PHPickerViewController` runs out of process, so **no photo
 *    library permission is required at all** to let the user choose a clip.
 *    Nothing is prompted, and the app still only ever sees what was picked.
 *  - The user gets the search, albums, Recents and Favourites they already know.
 *
 * Two options are non-negotiable for this app: `Passthrough` and `Current` stop
 * the picker from re-encoding the clip on the way out. A transcode would rewrite
 * the frame rate, and frame-accurate comparison depends on the frame rate being
 * the one the camera actually recorded.
 *
 * Choosing `Passthrough` forces a third: it is the one preset that will not pull
 * an iCloud-only asset down on its own, so `shouldDownloadFromNetwork` has to be
 * set or the picker fails on any clip the device has offloaded.
 */

import * as ImagePicker from 'expo-image-picker';

import type { ResolvedClip, VideoRef } from '@/types';

export interface PickVideoResult {
  clip: ResolvedClip;
  /**
   * True when the pick is backed by a persistent MediaLibrary asset id, so it
   * can be stored in the collection and survive a restart. False when the
   * platform only handed over a sandboxed copy — see the note below.
   */
  persistent: boolean;
}

/**
 * Opens the system video picker. Resolves `null` if the user cancels.
 */
export async function pickVideoFromLibrary(): Promise<PickVideoResult | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    allowsMultipleSelection: false,
    allowsEditing: false,
    quality: 1,
    // Hand back the original file rather than a re-encoded one, so the frame
    // rate and resolution survive the trip.
    videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    // Required *because* of Passthrough: that preset otherwise refuses assets
    // that live only in iCloud, and with "Optimize iPhone Storage" on that is
    // most older footage. Other presets download automatically; Passthrough
    // does not, so it has to be asked for explicitly.
    shouldDownloadFromNetwork: true,
  });

  if (result.canceled) return null;

  const asset = result.assets?.[0];
  if (!asset) return null;

  // Prefer the persistent asset id: it survives restarts and means the app is
  // referencing the library entry, not a copy of it. `assetId` is absent on some
  // platforms and picker paths, in which case the URI is a sandboxed copy the
  // picker made — usable now, but not something to persist.
  const ref: VideoRef = asset.assetId
    ? { kind: 'mediaLibrary', id: asset.assetId }
    : { kind: 'file', id: asset.uri };

  return {
    persistent: ref.kind === 'mediaLibrary',
    clip: {
      ref,
      uri: asset.uri,
      name: cleanName(asset.fileName) ?? 'Video',
      meta: {
        // The picker reports duration in milliseconds.
        durationSeconds: asset.duration != null ? asset.duration / 1000 : null,
        width: asset.width ?? null,
        height: asset.height ?? null,
        // Not reported here; the player reads the real value from the video
        // track on load, and until then callers fall back to DEFAULT_FPS.
        fps: null,
      },
    },
  };
}

/** Trims the extension so collection entries read as names, not filenames. */
function cleanName(fileName: string | null | undefined): string | null {
  if (!fileName) return null;
  const withoutExtension = fileName.replace(/\.[^./\\]+$/, '');
  return withoutExtension.trim() || fileName;
}
