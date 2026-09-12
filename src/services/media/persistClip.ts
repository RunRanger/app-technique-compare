/**
 * Making a picked clip persistent enough to store in the collection.
 *
 * The collection's rule is that entries survive a restart. A MediaLibrary asset
 * id satisfies that with no copy at all, and that is the path taken whenever the
 * system picker hands one over.
 *
 * It does not always. On Android the photo picker commonly returns only a
 * sandboxed copy in the cache directory, with no asset id — and the cache is
 * exactly what the OS reclaims under pressure, so saving that path would give
 * the user collection entries that quietly stop working.
 *
 * So for those picks the file is *moved* out of the cache into the app's
 * documents directory. Worth being precise about the cost: the picker has
 * already made that copy, and moving it neither duplicates the bytes again nor
 * adds anything to the user's gallery. It is a rename, and it is the difference
 * between an entry that lasts and one that does not.
 */

import { Directory, File, Paths } from 'expo-file-system';

import type { ResolvedClip } from '@/types';

/** Where relocated picks live. */
const CLIPS_DIRECTORY = 'clips';

let counter = 0;

function uniqueName(extension: string): string {
  const stamp = Date.now().toString(36);
  const seq = (counter++).toString(36);
  return `clip_${stamp}_${seq}${extension ? `.${extension}` : ''}`;
}

/**
 * Returns a clip that is safe to store in the collection, relocating the file
 * first if that is what persistence requires.
 *
 * @param alreadyPersistent whether the clip's ref is a MediaLibrary asset id
 */
export async function persistClipForCollection(
  clip: ResolvedClip,
  alreadyPersistent: boolean
): Promise<ResolvedClip> {
  // Backed by the media library: nothing to do, and nothing copied.
  if (alreadyPersistent) return clip;

  const source = new File(clip.uri);
  if (!source.exists) {
    throw new Error('The picked video is no longer available.');
  }

  const directory = new Directory(Paths.document, CLIPS_DIRECTORY);
  if (!directory.exists) directory.create({ intermediates: true });

  const destination = new File(directory, uniqueName(source.extension.replace(/^\./, '')));
  await source.move(destination);

  return {
    ...clip,
    ref: { kind: 'file', id: destination.uri },
    uri: destination.uri,
  };
}

/** Removes a relocated file when its collection entry is deleted. */
export function deletePersistedClip(ref: { kind: string; id: string }): void {
  // Only ever delete files this module put there. A media library asset belongs
  // to the user, and a cache path is the OS's to manage.
  if (ref.kind !== 'file') return;
  if (!ref.id.includes(`/${CLIPS_DIRECTORY}/`)) return;
  try {
    const file = new File(ref.id);
    if (file.exists) file.delete();
  } catch (error) {
    console.warn('[persistClip] could not delete stored clip', error);
  }
}
