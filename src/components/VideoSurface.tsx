/**
 * One video surface. Purely presentational: it renders a player it is given and
 * never creates or releases one — see `useClipPlayer` for why that separation
 * matters.
 */

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { VideoView, type VideoPlayer } from 'expo-video';

interface VideoSurfaceProps {
  player: VideoPlayer | null;
  contentFit?: 'contain' | 'cover' | 'fill';
  style?: StyleProp<ViewStyle>;
  nativeControls?: boolean;
  opacity?: number;
  pointerEvents?: 'auto' | 'none';
  /**
   * Flips the image horizontally, for comparing a routine performed the other
   * way round. A CSS-style transform on the surface, so it costs nothing and
   * does not touch the decoded frames.
   */
  mirrored?: boolean;
  /**
   * Set for the overlay and split modes. On Android the default `SurfaceView`
   * is punched through the view hierarchy: it ignores opacity and cannot be
   * z-ordered against another video, so stacked surfaces must use a
   * `TextureView` instead. It costs some power, hence not the default.
   */
  overlapping?: boolean;
}

export function VideoSurface({
  player,
  contentFit = 'contain',
  style,
  nativeControls = false,
  opacity,
  pointerEvents = 'none',
  mirrored = false,
  overlapping = false,
}: VideoSurfaceProps) {
  return (
    <View
      style={[
        styles.container,
        style,
        opacity != null ? { opacity } : null,
        mirrored ? styles.mirrored : null,
      ]}
    >
      <VideoView
        player={player}
        style={styles.fill}
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
  container: { backgroundColor: '#000', overflow: 'hidden' },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  mirrored: { transform: [{ scaleX: -1 }] },
});
