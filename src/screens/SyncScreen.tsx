/**
 * Alignment step, between choosing clips and comparing them.
 *
 * Both clips are shown live while the offset slider moves, because alignment is
 * a visual judgement — you dial it in by watching the two frames agree, not by
 * reading a number. Auto-sync fills the same slider rather than jumping straight
 * to comparison, so its suggestion is always reviewable and adjustable.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';
import type { VideoPlayer } from 'expo-video';

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
import { useSessionStore, useOffsetMemory } from '@/state/sessionStore';
import { colors, radii, spacing } from '@/theme';
import { DEFAULT_FPS, type ClipSlot, type VideoMeta } from '@/types';

import { AutoSyncPanel } from './parts/AutoSyncPanel';

export function SyncScreen({ navigation }: RootScreenProps<'Sync'>) {
  const reference = useSessionStore((state) => state.reference);
  const comparison = useSessionStore((state) => state.comparison);
  const offsetSeconds = useSessionStore((state) => state.offsetSeconds);
  const setOffset = useSessionStore((state) => state.setOffset);
  const nudgeOffset = useSessionStore((state) => state.nudgeOffset);
  const updateClipMeta = useSessionStore((state) => state.updateClipMeta);
  const remember = useOffsetMemory((state) => state.remember);
  const recall = useOffsetMemory((state) => state.recall);

  const referencePlayer = useRef<VideoPlayer | null>(null);
  const comparisonPlayer = useRef<VideoPlayer | null>(null);

  /** Where in the reference clip we are previewing the alignment. */
  const [previewTime, setPreviewTime] = useState(0);

  const referenceDuration = reference?.meta.durationSeconds ?? null;
  const comparisonDuration = comparison?.meta.durationSeconds ?? null;
  const fps = reference?.meta.fps ?? comparison?.meta.fps ?? DEFAULT_FPS;
  const frameStep = frameDuration(fps);

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

  /** Paints both players at the current preview point and offset. */
  const applyPreview = useCallback(
    (master: number, offset: number) => {
      const times = masterToClipTimes(master, offset, referenceDuration, comparisonDuration);
      if (referencePlayer.current) referencePlayer.current.currentTime = times.reference;
      if (comparisonPlayer.current) comparisonPlayer.current.currentTime = times.comparison;
    },
    [comparisonDuration, referenceDuration]
  );

  useEffect(() => {
    applyPreview(previewTime, offsetSeconds);
  }, [applyPreview, previewTime, offsetSeconds]);

  const handleMeta = useCallback(
    (slot: ClipSlot) => (meta: Partial<VideoMeta>) => updateClipMeta(slot, meta),
    [updateClipMeta]
  );

  const nudge = useCallback(
    (frames: number) => {
      nudgeOffset(frames * frameStep);
      void Haptics.selectionAsync();
    },
    [frameStep, nudgeOffset]
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
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.previewRow}>
          <PreviewPane
            uri={reference.uri}
            label={reference.name}
            accent={colors.reference}
            onPlayer={(player) => {
              referencePlayer.current = player;
              applyPreview(previewTime, offsetSeconds);
            }}
            onMeta={handleMeta('reference')}
          />
          <PreviewPane
            uri={comparison.uri}
            label={comparison.name}
            accent={colors.comparison}
            onPlayer={(player) => {
              comparisonPlayer.current = player;
              applyPreview(previewTime, offsetSeconds);
            }}
            onMeta={handleMeta('comparison')}
          />
        </View>

        <Card style={styles.panel}>
          <View style={styles.panelHeader}>
            <Text variant="label">Preview position</Text>
            <Text variant="mono" muted>
              {formatTimecode(previewTime)}
            </Text>
          </View>
          <Text variant="caption" faint>
            Move to the moment you want to match — a takeoff, a contact, a release.
          </Text>
          <Slider
            style={styles.slider}
            minimumValue={0}
            maximumValue={previewMax > 0 ? previewMax : 1}
            value={previewTime}
            onValueChange={setPreviewTime}
            minimumTrackTintColor={colors.accent}
            maximumTrackTintColor={colors.border}
            thumbTintColor={colors.accent}
            accessibilityLabel="Preview position in video 1"
          />
        </Card>

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
            onValueChange={(value) => setOffset(clampOffset(value, referenceDuration, comparisonDuration))}
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

          <View style={styles.stepperRow}>
            <Button
              label="Reset"
              variant="ghost"
              onPress={() => setOffset(0)}
              style={styles.stepper}
            />
            <Text variant="caption" faint style={styles.fpsNote}>
              1 frame ≈ {(frameStep * 1000).toFixed(1)} ms at {Math.round(fps)} fps
            </Text>
          </View>
        </Card>

        <AutoSyncPanel
          reference={reference}
          comparison={comparison}
          previewTime={previewTime}
          onOffsetSuggested={(value) => {
            setOffset(clampOffset(value, referenceDuration, comparisonDuration));
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }}
          onError={(message) => Alert.alert('Auto-sync', message)}
        />

        <Button label="Compare" icon="⇄" block onPress={proceed} style={styles.cta} />
      </ScrollView>
    </Screen>
  );
}

function PreviewPane({
  uri,
  label,
  accent,
  onPlayer,
  onMeta,
}: {
  uri: string;
  label: string;
  accent: string;
  onPlayer: (player: VideoPlayer) => void;
  onMeta: (meta: Partial<VideoMeta>) => void;
}) {
  return (
    <View style={[styles.pane, { borderColor: accent }]}>
      <VideoSurface
        uri={uri}
        onPlayerReady={onPlayer}
        onMetadata={onMeta}
        contentFit="contain"
        style={styles.paneVideo}
      />
      <View style={styles.paneLabel} pointerEvents="none">
        <Text variant="caption" color={accent} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingVertical: spacing.lg, gap: spacing.md },
  previewRow: { flexDirection: 'row', gap: spacing.sm, height: 200 },
  pane: { flex: 1, borderWidth: 1, borderRadius: radii.md, overflow: 'hidden', backgroundColor: '#000' },
  paneVideo: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  paneLabel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.overlay,
  },
  panel: { gap: spacing.sm },
  panelHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  slider: { width: '100%', height: 40 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepper: { flex: 1, paddingHorizontal: spacing.xs },
  fpsNote: { flex: 2, textAlign: 'right' },
  cta: { marginTop: spacing.sm },
  missing: { gap: spacing.md, marginTop: spacing.xl },
});
