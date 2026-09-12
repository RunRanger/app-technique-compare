/**
 * One video surface, plus the player that drives it.
 *
 * Creating the player here rather than in the screen keeps each surface
 * self-contained, and lets the surface report the metadata that only the player
 * knows — most importantly the real frame rate, which drives frame stepping.
 */

import { useEffect, useRef } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { VideoView, useVideoPlayer, type VideoPlayer } from 'expo-video';

import type { VideoMeta } from '@/types';

interface VideoSurfaceProps {
  uri: string;
  /** Receives the player once it exists, so a parent can drive it. */
  onPlayerReady?: (player: VideoPlayer) => void;
  /** Fires when the source loads and duration/fps become known. */
  onMetadata?: (meta: Partial<VideoMeta>) => void;
  contentFit?: 'contain' | 'cover' | 'fill';
  style?: ViewStyle;
  /** Native controls are off everywhere: the app owns the transport. */
  nativeControls?: boolean;
  opacity?: number;
  pointerEvents?: 'auto' | 'none';
  /**
   * Set for the overlay and split modes. On Android the default `SurfaceView`
   * is punched through the view hierarchy: it ignores opacity and cannot be
   * z-ordered against another video, so stacked surfaces must use a
   * `TextureView` instead. It costs some power, hence not the default.
   */
  overlapping?: boolean;
}

export function VideoSurface({
  uri,
  onPlayerReady,
  onMetadata,
  contentFit = 'contain',
  style,
  nativeControls = false,
  opacity,
  pointerEvents = 'none',
  overlapping = false,
}: VideoSurfaceProps) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    instance.muted = true;
    instance.timeUpdateEventInterval = 0;
    // Default to frame-exact seeking; the transport loosens this while scrubbing.
    instance.seekTolerance = { toleranceBefore: 0, toleranceAfter: 0 };
  });

  const reportedRef = useRef(false);
  // Callbacks are held in refs so the listener effects below do not resubscribe
  // every time a parent re-renders with a fresh closure. Written in an effect,
  // never during render.
  const onPlayerReadyRef = useRef(onPlayerReady);
  const onMetadataRef = useRef(onMetadata);
  useEffect(() => {
    onPlayerReadyRef.current = onPlayerReady;
    onMetadataRef.current = onMetadata;
  }, [onPlayerReady, onMetadata]);

  useEffect(() => {
    onPlayerReadyRef.current?.(player);
  }, [player]);

  // `sourceLoad` is the one place duration and the video track's frame rate
  // both become available.
  useEffect(() => {
    const subscription = player.addListener('sourceLoad', (payload) => {
      const track = payload.availableVideoTracks?.[0] ?? null;
      onMetadataRef.current?.({
        durationSeconds: payload.duration ?? null,
        fps: track?.frameRate ?? null,
        width: track?.size?.width ?? null,
        height: track?.size?.height ?? null,
      });
      reportedRef.current = true;
    });
    return () => subscription.remove();
  }, [player]);

  // Fallback: some sources report a duration without ever firing a usable
  // track list, so pick up whatever the player knows shortly after mount.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (reportedRef.current) return;
      if (player.duration > 0) {
        onMetadataRef.current?.({ durationSeconds: player.duration });
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [player]);

  return (
    <View style={[styles.container, style, opacity != null ? { opacity } : null]}>
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit={contentFit}
        nativeControls={nativeControls}
        pointerEvents={pointerEvents}
        allowsPictureInPicture={false}
        surfaceType={overlapping ? 'textureView' : 'surfaceView'}
        // The shutter paints an opaque frame until the first render, which would
        // hide whatever sits beneath a stacked surface.
        useExoShutter={!overlapping}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#000',
    overflow: 'hidden',
  },
});
