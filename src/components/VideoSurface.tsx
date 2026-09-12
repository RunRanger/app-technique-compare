/**
 * One video surface. Purely presentational: it renders a player it is given and
 * never creates or releases one — see `useClipPlayer` for why that separation
 * matters.
 *
 * Two Android details decide how the visual effects here are applied.
 *
 * `surfaceType` is fixed to `textureView` rather than chosen per mode. The
 * default `SurfaceView` is punched through the view hierarchy: it ignores
 * opacity and transforms entirely, which is why mirroring silently did nothing
 * and a blended overlay came out black. A `TextureView` is an ordinary view and
 * composites normally. It is also the reason the value is a constant — expo-video
 * documents that this prop must not change at runtime, and switching
 * visualization modes would otherwise change it.
 *
 * Opacity and transforms are set on the `VideoView` itself, not on a wrapper.
 * The wrapper only clips and paints the background behind the video, so putting
 * the effects there fades and flips the wrong thing.
 */

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { VideoView, type VideoPlayer } from 'expo-video';

export interface SurfaceTransform {
  /** Horizontal flip, for a routine performed the other way round. */
  mirrored?: boolean;
  /** Uniform zoom. 1 = untouched. */
  scale?: number;
  /** Pan after zooming, as a fraction of the surface size (-0.5 … 0.5). */
  offsetX?: number;
  offsetY?: number;
}

interface VideoSurfaceProps extends SurfaceTransform {
  player: VideoPlayer | null;
  contentFit?: 'contain' | 'cover' | 'fill';
  style?: StyleProp<ViewStyle>;
  nativeControls?: boolean;
  opacity?: number;
  pointerEvents?: 'auto' | 'none';
  /**
   * Set when this surface is stacked over another. Drops the opaque backdrop so
   * whatever sits beneath shows through, and disables the ExoPlayer shutter,
   * which paints an opaque frame until the first render.
   */
  overlapping?: boolean;
}

/**
 * Builds the transform list. Order matters: translate is applied in the
 * surface's own coordinates, so it must come before the flip — otherwise a
 * mirrored clip pans the wrong way and the controls feel inverted.
 */
/**
 * Only the four transforms this app uses. React Native's own `transform` type is
 * a readonly union that also admits a string form, which makes it awkward to
 * build incrementally; naming the small subset keeps this readable and still
 * assigns cleanly to a style.
 */
export type SurfaceTransformEntry =
  | { translateX: number }
  | { translateY: number }
  | { scale: number }
  | { scaleX: number };

export function buildSurfaceTransform({
  mirrored = false,
  scale = 1,
  offsetX = 0,
  offsetY = 0,
}: SurfaceTransform): SurfaceTransformEntry[] {
  const transform: SurfaceTransformEntry[] = [];
  if (offsetX !== 0) transform.push({ translateX: offsetX });
  if (offsetY !== 0) transform.push({ translateY: offsetY });
  if (scale !== 1) transform.push({ scale });
  if (mirrored) transform.push({ scaleX: -1 });
  return transform;
}

export function VideoSurface({
  player,
  contentFit = 'contain',
  style,
  nativeControls = false,
  opacity,
  pointerEvents = 'none',
  mirrored = false,
  scale = 1,
  offsetX = 0,
  offsetY = 0,
  overlapping = false,
}: VideoSurfaceProps) {
  const transform = buildSurfaceTransform({ mirrored, scale, offsetX, offsetY });

  return (
    <View style={[styles.container, overlapping ? styles.transparent : null, style]}>
      <VideoView
        player={player}
        style={[
          styles.fill,
          opacity != null ? { opacity } : null,
          transform.length > 0 ? { transform } : null,
        ]}
        contentFit={contentFit}
        nativeControls={nativeControls}
        pointerEvents={pointerEvents}
        allowsPictureInPicture={false}
        surfaceType="textureView"
        useExoShutter={!overlapping}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#000', overflow: 'hidden' },
  transparent: { backgroundColor: 'transparent' },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
});
