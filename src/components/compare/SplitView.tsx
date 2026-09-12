/**
 * Mode 3 — split screen with a draggable divider.
 *
 * The comparison clip is stacked over the reference clip and clipped to the
 * region right of the divider, so the two halves form one continuous frame.
 *
 * The clip is done by wrapping the upper surface in a fixed-width `overflow:
 * hidden` container while the surface *inside* keeps the full stage width. That
 * matters: sizing the video itself to the revealed width would re-letterbox it
 * as the divider moves, and the two halves would no longer line up.
 *
 * Dragging uses `PanResponder` rather than a gesture library — it is a single
 * one-finger drag, and keeping the dependency out means one less thing to
 * configure in a bare workflow.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import type { VideoPlayer } from 'expo-video';

import { VideoSurface } from '@/components/VideoSurface';
import { Text } from '@/components/ui';
import { colors, radii, spacing } from '@/theme';
import type { ResolvedClip, VideoMeta } from '@/types';

interface SplitViewProps {
  reference: ResolvedClip;
  comparison: ResolvedClip;
  /** Divider position, 0..1 across the stage. */
  position: number;
  onPositionChange: (value: number) => void;
  onReferencePlayer: (player: VideoPlayer) => void;
  onComparisonPlayer: (player: VideoPlayer) => void;
  onReferenceMeta: (meta: Partial<VideoMeta>) => void;
  onComparisonMeta: (meta: Partial<VideoMeta>) => void;
}

const HANDLE_SIZE = 44;

export function SplitView({
  reference,
  comparison,
  position,
  onPositionChange,
  onReferencePlayer,
  onComparisonPlayer,
  onReferenceMeta,
  onComparisonMeta,
}: SplitViewProps) {
  const [stageWidth, setStageWidth] = useState(0);

  // Read by the pan responder, which is created once and must not close over
  // a stale width or a stale starting position.
  const widthRef = useRef(0);
  const positionRef = useRef(position);
  const dragStart = useRef(position);
  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  const handleLayout = (event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    widthRef.current = width;
    setStageWidth(width);
  };

  // `panHandlers` are spread onto the divider in this same render, so the
  // responder has to be built during render — this is React Native's own
  // documented PanResponder idiom. The refs it closes over are only ever read
  // later, from gesture callbacks, never during the render itself.
  const panResponder = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          dragStart.current = positionRef.current;
        },
        onPanResponderMove: (_event, gesture) => {
          const width = widthRef.current;
          if (width <= 0) return;
          const next = dragStart.current + gesture.dx / width;
          onPositionChange(Math.max(0, Math.min(1, next)));
        },
      }),
    [onPositionChange]
  );

  const revealWidth = stageWidth * position;

  return (
    <View style={styles.container}>
      <View style={styles.stage} onLayout={handleLayout}>
        {/* Base layer: the reference clip, full stage. */}
        <VideoSurface
          uri={reference.uri}
          onPlayerReady={onReferencePlayer}
          onMetadata={onReferenceMeta}
          contentFit="contain"
          style={styles.fill}
          overlapping
        />

        {/* Upper layer: clipped to the revealed strip, but laid out full width
            so the image itself does not shift as the divider moves. */}
        {stageWidth > 0 ? (
          <View style={[styles.clip, { width: revealWidth }]} pointerEvents="none">
            <View style={{ width: stageWidth, height: '100%' }}>
              <VideoSurface
                uri={comparison.uri}
                onPlayerReady={onComparisonPlayer}
                onMetadata={onComparisonMeta}
                contentFit="contain"
                style={styles.fill}
                overlapping
              />
            </View>
          </View>
        ) : (
          // Mount the second player even before layout, so both players exist
          // and the transport can drive them from the first frame.
          <View style={styles.hidden} pointerEvents="none">
            <VideoSurface
              uri={comparison.uri}
              onPlayerReady={onComparisonPlayer}
              onMetadata={onComparisonMeta}
              contentFit="contain"
              style={styles.fill}
              overlapping
            />
          </View>
        )}

        {stageWidth > 0 ? (
          <View
            style={[styles.divider, { left: revealWidth - 1 }]}
            {...panResponder.panHandlers}
            accessibilityRole="adjustable"
            accessibilityLabel="Split divider"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(position * 100) }}
          >
            <View style={styles.dividerLine} />
            <View style={styles.handle}>
              <Text style={styles.handleIcon}>◀▶</Text>
            </View>
          </View>
        ) : null}

        <View style={[styles.tag, styles.tagLeft]} pointerEvents="none">
          <Text variant="caption" color={colors.comparison} numberOfLines={1}>
            {comparison.name}
          </Text>
        </View>
        <View style={[styles.tag, styles.tagRight]} pointerEvents="none">
          <Text variant="caption" color={colors.reference} numberOfLines={1}>
            {reference.name}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  container: { flex: 1 },
  stage: {
    flex: 1,
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: colors.border,
  },
  clip: { position: 'absolute', top: 0, bottom: 0, left: 0, overflow: 'hidden' },
  hidden: { position: 'absolute', width: 0, height: 0, overflow: 'hidden' },
  divider: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: HANDLE_SIZE,
    marginLeft: -HANDLE_SIZE / 2 + 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dividerLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: colors.text,
    opacity: 0.9,
  },
  handle: {
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  handleIcon: { fontSize: 12, color: colors.text },
  tag: {
    position: 'absolute',
    bottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
    backgroundColor: colors.overlay,
    maxWidth: '45%',
  },
  tagLeft: { left: spacing.sm },
  tagRight: { right: spacing.sm },
});
