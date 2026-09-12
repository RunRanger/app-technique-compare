/**
 * Mode 1 — side by side.
 *
 * Splits along the *long* axis of the available space: columns in landscape,
 * rows in portrait. That is driven by the measured container, not by the device
 * orientation, so the layout is also right on a tablet in split view.
 */

import { StyleSheet, View } from 'react-native';
import type { VideoPlayer } from 'expo-video';

import { VideoSurface } from '@/components/VideoSurface';
import { Text } from '@/components/ui';
import { colors, radii, spacing } from '@/theme';
import type { ResolvedClip } from '@/types';

import type { CompareModeProps } from './types';

interface SideBySideViewProps extends CompareModeProps {
  /** True when the container is wider than it is tall. */
  isWide: boolean;
}

export function SideBySideView({
  reference,
  comparison,
  referencePlayer,
  comparisonPlayer,
  mirrorReference,
  mirrorComparison,
  isWide,
}: SideBySideViewProps) {
  return (
    <View style={[styles.container, isWide ? styles.row : styles.column]}>
      <Pane
        clip={reference}
        player={referencePlayer}
        mirrored={mirrorReference}
        accent={colors.reference}
        badge="1"
      />
      <Pane
        clip={comparison}
        player={comparisonPlayer}
        mirrored={mirrorComparison}
        accent={colors.comparison}
        badge="2"
      />
    </View>
  );
}

function Pane({
  clip,
  player,
  mirrored,
  accent,
  badge,
}: {
  clip: ResolvedClip;
  player: VideoPlayer;
  mirrored: boolean;
  accent: string;
  badge: string;
}) {
  return (
    <View style={[styles.pane, { borderColor: accent }]}>
      <VideoSurface player={player} mirrored={mirrored} contentFit="contain" style={styles.fill} />
      <View style={[styles.badge, { backgroundColor: accent }]}>
        <Text variant="caption" color="#04121F" style={styles.badgeText}>
          {badge}
        </Text>
      </View>
      <View style={styles.caption} pointerEvents="none">
        <Text variant="caption" numberOfLines={1}>
          {clip.name}
          {mirrored ? '  ⇋' : ''}
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
