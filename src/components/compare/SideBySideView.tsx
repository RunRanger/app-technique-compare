/**
 * Mode 1 — side by side.
 *
 * Splits along the *long* axis of the available space: columns in landscape,
 * rows in portrait. That is driven by the measured container, not by the device
 * orientation, so the layout is also right on a tablet in split view.
 */

import { StyleSheet, View } from 'react-native';

import { VideoSurface } from '@/components/VideoSurface';
import { Text } from '@/components/ui';
import { colors, radii, spacing } from '@/theme';
import type { ResolvedClip, VideoMeta } from '@/types';
import type { VideoPlayer } from 'expo-video';

interface SideBySideViewProps {
  reference: ResolvedClip;
  comparison: ResolvedClip;
  onReferencePlayer: (player: VideoPlayer) => void;
  onComparisonPlayer: (player: VideoPlayer) => void;
  onReferenceMeta: (meta: Partial<VideoMeta>) => void;
  onComparisonMeta: (meta: Partial<VideoMeta>) => void;
  /** True when the container is wider than it is tall. */
  isWide: boolean;
}

export function SideBySideView({
  reference,
  comparison,
  onReferencePlayer,
  onComparisonPlayer,
  onReferenceMeta,
  onComparisonMeta,
  isWide,
}: SideBySideViewProps) {
  return (
    <View style={[styles.container, isWide ? styles.row : styles.column]}>
      <Pane
        clip={reference}
        accent={colors.reference}
        badge="1"
        onPlayer={onReferencePlayer}
        onMeta={onReferenceMeta}
      />
      <Pane
        clip={comparison}
        accent={colors.comparison}
        badge="2"
        onPlayer={onComparisonPlayer}
        onMeta={onComparisonMeta}
      />
    </View>
  );
}

function Pane({
  clip,
  accent,
  badge,
  onPlayer,
  onMeta,
}: {
  clip: ResolvedClip;
  accent: string;
  badge: string;
  onPlayer: (player: VideoPlayer) => void;
  onMeta: (meta: Partial<VideoMeta>) => void;
}) {
  return (
    <View style={[styles.pane, { borderColor: accent }]}>
      <VideoSurface
        uri={clip.uri}
        onPlayerReady={onPlayer}
        onMetadata={onMeta}
        contentFit="contain"
        style={styles.fill}
      />
      <View style={[styles.badge, { backgroundColor: accent }]}>
        <Text variant="caption" color="#04121F" style={styles.badgeText}>
          {badge}
        </Text>
      </View>
      <View style={styles.caption} pointerEvents="none">
        <Text variant="caption" numberOfLines={1}>
          {clip.name}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  container: { flex: 1, gap: spacing.sm },
  row: { flexDirection: 'row' },
  column: { flexDirection: 'column' },
  pane: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  badge: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    width: 22,
    height: 22,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontWeight: '700' },
  caption: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.overlay,
  },
});
