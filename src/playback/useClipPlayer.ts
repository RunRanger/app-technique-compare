/**
 * Creates the `VideoPlayer` for one clip, and reports the metadata only the
 * player knows.
 *
 * **This hook must be called by the component that drives the player, not by
 * the one that displays it.** `useVideoPlayer` is built on
 * `useReleasingSharedObject`: the player is released when the component that
 * called it unmounts. Creating it in a child view and handing it up to a parent
 * therefore hands the parent a reference it does not control — when the child
 * unmounts (switching visualization modes, say) the native object is freed while
 * the parent's effects still hold it, and the next property write fails with
 * "Cannot use shared object that was already released".
 *
 * Owning the player at the screen level also means switching modes no longer
 * tears players down and rebuilds them, so playback position and buffered data
 * survive the switch for free.
 */

import { useEffect, useRef } from 'react';
import { useVideoPlayer, type VideoPlayer } from 'expo-video';

import type { VideoMeta } from '@/types';

export interface ClipPlayerOptions {
  /** Playable URI, or `null` before a clip is chosen. */
  uri: string | null;
  /** Called once the source loads and duration/frame rate are known. */
  onMetadata?: (meta: Partial<VideoMeta>) => void;
  muted?: boolean;
}

export function useClipPlayer({ uri, onMetadata, muted = true }: ClipPlayerOptions): VideoPlayer {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    instance.muted = muted;
    instance.timeUpdateEventInterval = 0;
    // Frame-exact by default; the transport loosens this while scrubbing.
    instance.seekTolerance = { toleranceBefore: 0, toleranceAfter: 0 };
  });

  const onMetadataRef = useRef(onMetadata);
  useEffect(() => {
    onMetadataRef.current = onMetadata;
  }, [onMetadata]);

  // `sourceLoad` is the one event where duration and the video track's real
  // frame rate both become available.
  useEffect(() => {
    const subscription = player.addListener('sourceLoad', (payload) => {
      const track = payload.availableVideoTracks?.[0] ?? null;
      onMetadataRef.current?.({
        durationSeconds: payload.duration ?? null,
        fps: track?.frameRate ?? null,
        width: track?.size?.width ?? null,
        height: track?.size?.height ?? null,
      });
    });
    return () => subscription.remove();
  }, [player]);

  // Fallback for sources that report a duration without a usable track list.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (player.duration > 0) {
        onMetadataRef.current?.({ durationSeconds: player.duration });
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [player]);

  return player;
}
