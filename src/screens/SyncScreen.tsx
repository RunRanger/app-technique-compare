/**
 * Alignment step, between choosing clips and comparing them.
 *
 * The layout puts the three things that are always needed above the fold — both
 * clips, their mirror state, and where in the movement you are looking — and
 * tucks the two *ways* of aligning behind tabs. Manual and automatic alignment
 * are alternatives, not a sequence, so showing both at once only made the screen
 * long enough to scroll.
 *
 * As in comparison, this screen owns both players: see `useClipPlayer`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';

import { VideoSurface } from '@/components/VideoSurface';
import { Button, Card, Screen, Text } from '@/components/ui';
import type { RootScreenProps } from '@/navigation/types';
import {
  clampOffset,
  formatOffset,
  formatTimecode,
  frameDuration,
  masterToClipTimes,
  offsetBounds,
} from '@/playback/timeline';
import { useClipPlayer } from '@/playback/useClipPlayer';
import { useCollectionStore } from '@/state/collectionStore';
import { useOffsetMemory, useSessionStore } from '@/state/sessionStore';
import { colors, radii, spacing } from '@/theme';
import { DEFAULT_FPS, type ClipSlot, type ClipView, type VideoMeta } from '@/types';

import { AutoSyncPanel } from './parts/AutoSyncPanel';
import { SizePanel } from './parts/SizePanel';

type SyncTab = 'manual' | 'auto' | 'size';

const TABS: { key: SyncTab; label: string; icon: string }[] = [
  { key: 'manual', label: 'Manual', icon: '⇤⇥' },
  { key: 'auto', label: 'Auto', icon: '◎' },
  { key: 'size', label: 'Size', icon: '⤢' },
];

export function SyncScreen({ navigation }: RootScreenProps<'Sync'>) {
  const reference = useSessionStore((state) => state.reference);
  const comparison = useSessionStore((state) => state.comparison);
  const offsetSeconds = useSessionStore((state) => state.offsetSeconds);
  const setOffset = useSessionStore((state) => state.setOffset);
  const nudgeOffset = useSessionStore((state) => state.nudgeOffset);
  const updateClipMeta = useSessionStore((state) => state.updateClipMeta);
  const mirrorReference = useSessionStore((state) => state.mirrorReference);
  const mirrorComparison = useSessionStore((state) => state.mirrorComparison);
  const referenceView = useSessionStore((state) => state.referenceView);
  const comparisonView = useSessionStore((state) => state.comparisonView);
  const toggleMirrored = useSessionStore((state) => state.toggleMirrored);
  const setCollectionMirrored = useCollectionStore((state) => state.setMirrored);
  const remember = useOffsetMemory((state) => state.remember);
  const recall = useOffsetMemory((state) => state.recall);

  const [tab, setTab] = useState<SyncTab>('manual');
  /** Where in the reference clip the alignment is being judged. */
  const [previewTime, setPreviewTime] = useState(0);

  const referenceDuration = reference?.meta.durationSeconds ?? null;
  const comparisonDuration = comparison?.meta.durationSeconds ?? null;
  const fps = reference?.meta.fps ?? comparison?.meta.fps ?? DEFAULT_FPS;
  const frameStep = frameDuration(fps);

  const handleReferenceMeta = useCallback(
    (meta: Partial<VideoMeta>) => updateClipMeta('reference', meta),
    [updateClipMeta]
  );
  const handleComparisonMeta = useCallback(
    (meta: Partial<VideoMeta>) => updateClipMeta('comparison', meta),
    [updateClipMeta]
  );

  const referencePlayer = useClipPlayer({
    uri: reference?.uri ?? null,
    onMetadata: handleReferenceMeta,
  });
  const comparisonPlayer = useClipPlayer({
    uri: comparison?.uri ?? null,
    onMetadata: handleComparisonMeta,
  });

  const bounds = useMemo(
    () => offsetBounds(referenceDuration, comparisonDuration),
    [referenceDuration, comparisonDuration]
  );

  // Restore a previously dialled-in alignment for this exact pair.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !reference || !comparison) return;
    restored.current = true;
    const previous = recall(reference.ref.id, comparison.ref.id);
    if (previous != null) setOffset(previous);
  }, [comparison, recall, reference, setOffset]);

  /**
   * Paints both players at the current preview point and offset.
   *
   * eslint-disable below: driving a player is property assignment, and a
   * VideoPlayer is a handle to a native object rather than React state. Same
   * situation as `useSyncedPlayback`, documented at the top of that file.
   */
  useEffect(() => {
    const times = masterToClipTimes(
      previewTime,
      offsetSeconds,
      referenceDuration,
      comparisonDuration
    );
    /* eslint-disable react-hooks/immutability */
    referencePlayer.currentTime = times.reference;
    comparisonPlayer.currentTime = times.comparison;
    /* eslint-enable react-hooks/immutability */
  }, [
    previewTime,
    offsetSeconds,
    referenceDuration,
    comparisonDuration,
    referencePlayer,
    comparisonPlayer,
  ]);

  const nudge = useCallback(
    (frames: number) => {
      nudgeOffset(frames * frameStep);
      void Haptics.selectionAsync();
    },
    [frameStep, nudgeOffset]
  );

  /** Mirroring is a property of the clip, so it is also saved on its entry. */
  const handleMirror = useCallback(
    (slot: ClipSlot) => {
      toggleMirrored(slot);
      const clip = slot === 'reference' ? reference : comparison;
      const nowMirrored = !(slot === 'reference' ? mirrorReference : mirrorComparison);
      if (clip?.collectionItemId) setCollectionMirrored(clip.collectionItemId, nowMirrored);
      void Haptics.selectionAsync();
    },
    [comparison, mirrorComparison, mirrorReference, reference, setCollectionMirrored, toggleMirrored]
  );

  const proceed = useCallback(() => {
    if (reference && comparison) {
      remember(reference.ref.id, comparison.ref.id, offsetSeconds);
    }
    navigation.navigate('Compare');
  }, [comparison, navigation, offsetSeconds, reference, remember]);

  if (!reference || !comparison) {
    return (
      <Screen>
        <Card style={styles.missing}>
          <Text variant="heading">Two videos needed</Text>
          <Text variant="caption" muted>
            Go back and choose both a reference and a comparison video.
          </Text>
          <Button label="Back" onPress={() => navigation.navigate('Collection')} />
        </Card>
      </Screen>
    );
  }

  const previewMax = referenceDuration ?? 0;

  return (
    <Screen>
      {/* Always visible: both frames, side by side, at the same moment. */}
      <View style={styles.previewRow}>
        <PreviewPane
          player={referencePlayer}
          label={reference.name}
          badge="1"
          accent={colors.reference}
          mirrored={mirrorReference}
          view={referenceView}
          onToggleMirror={() => handleMirror('reference')}
        />
        <PreviewPane
          player={comparisonPlayer}
          label={comparison.name}
          badge="2"
          accent={colors.comparison}
          mirrored={mirrorComparison}
          view={comparisonView}
          onToggleMirror={() => handleMirror('comparison')}
        />
      </View>

      <View style={styles.positionRow}>
        <Text variant="caption" muted>
          Position
        </Text>
        <Slider
          style={styles.positionSlider}
          minimumValue={0}
          maximumValue={previewMax > 0 ? previewMax : 1}
          value={previewTime}
          onValueChange={setPreviewTime}
          minimumTrackTintColor={colors.accent}
          maximumTrackTintColor={colors.border}
          thumbTintColor={colors.accent}
          accessibilityLabel="Preview position in video 1"
        />
        <Text variant="mono" muted>
          {formatTimecode(previewTime)}
        </Text>
      </View>

      <View style={styles.tabs}>
        {TABS.map((option) => {
          const active = option.key === tab;
          return (
            <Pressable
              key={option.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${option.label} sync`}
              onPress={() => setTab(option.key)}
              style={({ pressed }) => [
                styles.tab,
                active && styles.tabActive,
                pressed && styles.pressed,
              ]}
            >
              <Text variant="label" color={active ? colors.text : colors.textMuted}>
                {option.icon}  {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={styles.tabBody}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {tab === 'manual' ? (
          <Card style={styles.panel}>
            <View style={styles.panelHeader}>
              <Text variant="label">Offset</Text>
              <Text variant="mono" color={colors.accent}>
                {formatOffset(offsetSeconds, fps)}
              </Text>
            </View>
            <Text variant="caption" faint>
              How far video 2 runs ahead of video 1.
            </Text>

            <Slider
              style={styles.slider}
              minimumValue={bounds.min}
              maximumValue={bounds.max}
              value={offsetSeconds}
              onValueChange={(value) =>
                setOffset(clampOffset(value, referenceDuration, comparisonDuration))
              }
              minimumTrackTintColor={colors.comparison}
              maximumTrackTintColor={colors.border}
              thumbTintColor={colors.comparison}
              accessibilityLabel="Offset between video 1 and video 2"
            />

            <View style={styles.stepperRow}>
              <Button label="−10 f" variant="secondary" onPress={() => nudge(-10)} style={styles.stepper} />
              <Button label="−1 f" variant="secondary" onPress={() => nudge(-1)} style={styles.stepper} />
              <Button label="+1 f" variant="secondary" onPress={() => nudge(1)} style={styles.stepper} />
              <Button label="+10 f" variant="secondary" onPress={() => nudge(10)} style={styles.stepper} />
            </View>

            <View style={styles.footerRow}>
              <Button label="Reset" variant="ghost" onPress={() => setOffset(0)} style={styles.stepper} />
              <Text variant="caption" faint style={styles.fpsNote}>
                1 frame ≈ {(frameStep * 1000).toFixed(1)} ms at {Math.round(fps)} fps
              </Text>
            </View>
          </Card>
        ) : null}

        {tab === 'auto' ? (
          <AutoSyncPanel
            reference={reference}
            comparison={comparison}
            referencePlayer={referencePlayer}
            comparisonPlayer={comparisonPlayer}
            previewTime={previewTime}
            onOffsetSuggested={(value) => {
              setOffset(clampOffset(value, referenceDuration, comparisonDuration));
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }}
            onError={(message) => Alert.alert('Auto-sync', message)}
          />
        ) : null}

        {tab === 'size' ? (
          <SizePanel
            reference={reference}
            comparison={comparison}
            referencePlayer={referencePlayer}
            comparisonPlayer={comparisonPlayer}
            previewTime={previewTime}
            onError={(message) => Alert.alert('Match sizes', message)}
          />
        ) : null}
      </ScrollView>

      <View style={styles.cta}>
        <Button label="Compare" icon="⇄" block onPress={proceed} />
      </View>
    </Screen>
  );
}

function PreviewPane({
  player,
  label,
  badge,
  accent,
  mirrored,
  view,
  onToggleMirror,
}: {
  player: React.ComponentProps<typeof VideoSurface>['player'];
  label: string;
  badge: string;
  accent: string;
  mirrored: boolean;
  view: ClipView;
  onToggleMirror: () => void;
}) {
  return (
    <View style={[styles.pane, { borderColor: accent }]}>
      <VideoSurface
        player={player}
        mirrored={mirrored}
        scale={view.scale}
        offsetX={view.offsetX}
        offsetY={view.offsetY}
        contentFit="contain"
        style={styles.fill}
      />

      <View style={[styles.badge, { backgroundColor: accent }]}>
        <Text variant="caption" color="#04121F" style={styles.badgeText}>
          {badge}
        </Text>
      </View>

      <Pressable
        onPress={onToggleMirror}
        accessibilityRole="switch"
        accessibilityState={{ checked: mirrored }}
        accessibilityLabel={`Mirror video ${badge}`}
        hitSlop={6}
        style={({ pressed }) => [
          styles.mirrorButton,
          mirrored && { backgroundColor: accent, borderColor: accent },
          pressed && styles.pressed,
        ]}
      >
        <Text variant="caption" color={mirrored ? '#04121F' : colors.text}>
          ⇋
        </Text>
      </Pressable>

      <View style={styles.paneLabel} pointerEvents="none">
        <Text variant="caption" color={accent} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  previewRow: { flexDirection: 'row', gap: spacing.sm, height: 190, paddingTop: spacing.md },
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
  mirrorButton: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 34,
    height: 34,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paneLabel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.overlay,
  },
  positionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  positionSlider: { flex: 1, height: 40 },
  tabs: { flexDirection: 'row', gap: spacing.xs, paddingTop: spacing.xs },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.accentMuted, borderColor: colors.accent },
  pressed: { opacity: 0.7 },
  tabBody: { paddingTop: spacing.md, paddingBottom: spacing.md },
  panel: { gap: spacing.sm },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  slider: { width: '100%', height: 40 },
  stepperRow: { flexDirection: 'row', gap: spacing.sm },
  stepper: { flex: 1, paddingHorizontal: spacing.xs },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  fpsNote: { flex: 2, textAlign: 'right' },
  cta: { paddingBottom: spacing.md, paddingTop: spacing.xs },
  missing: { gap: spacing.md, marginTop: spacing.xl },
});
