/**
 * Mode 2 — overlay / blend.
 *
 * The comparison clip is drawn on top of the reference clip with an adjustable
 * opacity, from 0% (reference only) to 100% (comparison only). Both surfaces are
 * marked `overlapping`, which switches Android to a TextureView — a SurfaceView
 * ignores opacity entirely and would render as an opaque rectangle.
 */

import { StyleSheet, View } from 'react-native';
import Slider from '@react-native-community/slider';
import type { VideoPlayer } from 'expo-video';

import { VideoSurface } from '@/components/VideoSurface';
import { Text } from '@/components/ui';
import { colors, radii, spacing } from '@/theme';
import type { ResolvedClip, VideoMeta } from '@/types';

interface OverlayViewProps {
  reference: ResolvedClip;
  comparison: ResolvedClip;
  opacity: number;
  onOpacityChange: (value: number) => void;
  onReferencePlayer: (player: VideoPlayer) => void;
  onComparisonPlayer: (player: VideoPlayer) => void;
  onReferenceMeta: (meta: Partial<VideoMeta>) => void;
  onComparisonMeta: (meta: Partial<VideoMeta>) => void;
}

export function OverlayView({
  reference,
  comparison,
  opacity,
  onOpacityChange,
  onReferencePlayer,
  onComparisonPlayer,
  onReferenceMeta,
  onComparisonMeta,
}: OverlayViewProps) {
  return (
    <View style={styles.container}>
      <View style={styles.stage}>
        <VideoSurface
          uri={reference.uri}
          onPlayerReady={onReferencePlayer}
          onMetadata={onReferenceMeta}
          contentFit="contain"
          style={styles.fill}
          overlapping
        />
        <VideoSurface
          uri={comparison.uri}
          onPlayerReady={onComparisonPlayer}
          onMetadata={onComparisonMeta}
          contentFit="contain"
          style={styles.fill}
          opacity={opacity}
          overlapping
        />
      </View>

      <View style={styles.controls}>
        <View style={styles.legend}>
          <Legend color={colors.reference} label={reference.name} />
          <Text variant="mono" muted>
            {Math.round(opacity * 100)}%
          </Text>
          <Legend color={colors.comparison} label={comparison.name} alignEnd />
        </View>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={1}
          value={opacity}
          onValueChange={onOpacityChange}
          minimumTrackTintColor={colors.reference}
          maximumTrackTintColor={colors.comparison}
          thumbTintColor={colors.text}
          accessibilityLabel="Blend between video 1 and video 2"
        />
      </View>
    </View>
  );
}

function Legend({
  color,
  label,
  alignEnd = false,
}: {
  color: string;
  label: string;
  alignEnd?: boolean;
}) {
  return (
    <View style={[styles.legendItem, alignEnd && styles.legendItemEnd]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text variant="caption" muted numberOfLines={1} style={styles.legendLabel}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  container: { flex: 1, gap: spacing.sm },
  stage: {
    flex: 1,
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: colors.border,
  },
  controls: { gap: spacing.xs },
  legend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flex: 1 },
  legendItemEnd: { justifyContent: 'flex-end' },
  legendLabel: { flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: radii.pill },
  slider: { width: '100%', height: 40 },
});
