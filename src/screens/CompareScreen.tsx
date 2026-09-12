/**
 * Synchronized comparison: one transport, three ways to look at the same two
 * clips.
 *
 * This screen owns both players. That is deliberate — see `useClipPlayer`: a
 * player created inside a child view is released when that view unmounts, so
 * switching visualization modes would free the native objects underneath the
 * transport's own effects. Owning them here means a mode switch only swaps which
 * views the players are attached to: nothing is torn down, the playhead does not
 * move, and buffered data is kept.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';

import { OverlayView } from '@/components/compare/OverlayView';
import { SideBySideView } from '@/components/compare/SideBySideView';
import { SplitView } from '@/components/compare/SplitView';
import { TransportBar } from '@/components/compare/TransportBar';
import { Button, Card, Screen, Text } from '@/components/ui';
import type { RootScreenProps } from '@/navigation/types';
import { formatOffset } from '@/playback/timeline';
import { useClipPlayer } from '@/playback/useClipPlayer';
import { useSyncedPlayback } from '@/playback/useSyncedPlayback';
import { pickVideoFromLibrary } from '@/services/media';
import { useSessionStore } from '@/state/sessionStore';
import { colors, radii, spacing } from '@/theme';
import { COMPARE_MODES, DEFAULT_FPS, type VideoMeta } from '@/types';

const PLAYBACK_RATES = [0.25, 0.5, 1] as const;

export function CompareScreen({ navigation }: RootScreenProps<'Compare'>) {
  const reference = useSessionStore((state) => state.reference);
  const comparison = useSessionStore((state) => state.comparison);
  const offsetSeconds = useSessionStore((state) => state.offsetSeconds);
  const mode = useSessionStore((state) => state.mode);
  const setMode = useSessionStore((state) => state.setMode);
  const overlayOpacity = useSessionStore((state) => state.overlayOpacity);
  const setOverlayOpacity = useSessionStore((state) => state.setOverlayOpacity);
  const splitPosition = useSessionStore((state) => state.splitPosition);
  const setSplitPosition = useSessionStore((state) => state.setSplitPosition);
  const playbackRate = useSessionStore((state) => state.playbackRate);
  const setPlaybackRate = useSessionStore((state) => state.setPlaybackRate);
  const muted = useSessionStore((state) => state.muted);
  const setMuted = useSessionStore((state) => state.setMuted);
  const mirrorReference = useSessionStore((state) => state.mirrorReference);
  const mirrorComparison = useSessionStore((state) => state.mirrorComparison);
  const referenceView = useSessionStore((state) => state.referenceView);
  const comparisonView = useSessionStore((state) => state.comparisonView);
  const updateClipMeta = useSessionStore((state) => state.updateClipMeta);
  const setClip = useSessionStore((state) => state.setClip);

  const { width, height } = useWindowDimensions();
  const isWide = width > height;

  const [replacing, setReplacing] = useState(false);

  const handleReferenceMeta = useCallback(
    (meta: Partial<VideoMeta>) => updateClipMeta('reference', meta),
    [updateClipMeta]
  );
  const handleComparisonMeta = useCallback(
    (meta: Partial<VideoMeta>) => updateClipMeta('comparison', meta),
    [updateClipMeta]
  );

  // Created here, once, for the lifetime of the screen. `useClipPlayer` swaps the
  // source when a clip changes, so replacing video 2 does not remount anything.
  const referencePlayer = useClipPlayer({
    uri: reference?.uri ?? null,
    onMetadata: handleReferenceMeta,
  });
  const comparisonPlayer = useClipPlayer({
    uri: comparison?.uri ?? null,
    onMetadata: handleComparisonMeta,
  });

  // Comparison is the one place rotating the device genuinely helps, so the
  // orientation lock is lifted here and restored on the way out.
  useEffect(() => {
    void ScreenOrientation.unlockAsync();
    return () => {
      void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
    };
  }, []);

  const transport = useSyncedPlayback({
    referencePlayer,
    comparisonPlayer,
    referenceDuration: reference?.meta.durationSeconds ?? null,
    comparisonDuration: comparison?.meta.durationSeconds ?? null,
    offsetSeconds,
    fps: reference?.meta.fps ?? comparison?.meta.fps ?? DEFAULT_FPS,
    playbackRate,
    muted,
  });

  /**
   * Replace video 2 without leaving comparison: video 1, the offset and the
   * playhead all stay as they are.
   */
  const replaceComparison = useCallback(async () => {
    transport.pause();
    setReplacing(true);
    try {
      const picked = await pickVideoFromLibrary();
      if (!picked) return;
      setClip('comparison', picked.clip);
    } catch (error) {
      Alert.alert('Could not open the picker', String(error));
    } finally {
      setReplacing(false);
    }
  }, [setClip, transport]);

  if (!reference || !comparison) {
    return (
      <Screen>
        <Card style={styles.missing}>
          <Text variant="heading">Nothing to compare</Text>
          <Button label="Back" onPress={() => navigation.navigate('Collection')} />
        </Card>
      </Screen>
    );
  }

  const modeProps = {
    reference,
    comparison,
    referencePlayer,
    comparisonPlayer,
    mirrorReference,
    mirrorComparison,
    referenceView,
    comparisonView,
  };

  return (
    <Screen bleed edges={isWide ? ['top', 'bottom'] : ['bottom']}>
      <View style={styles.tabs}>
        {COMPARE_MODES.map((option) => {
          const active = option.key === mode;
          return (
            <Pressable
              key={option.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={option.label}
              onPress={() => setMode(option.key)}
              style={({ pressed }) => [
                styles.tab,
                active && styles.tabActive,
                pressed && styles.pressed,
              ]}
            >
              <Text variant="caption" color={active ? colors.text : colors.textMuted}>
                {option.icon}  {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.stage}>
        {mode === 'sideBySide' ? <SideBySideView {...modeProps} isWide={isWide} /> : null}
        {mode === 'overlay' ? (
          <OverlayView
            {...modeProps}
            opacity={overlayOpacity}
            onOpacityChange={setOverlayOpacity}
          />
        ) : null}
        {mode === 'split' ? (
          <SplitView
            {...modeProps}
            position={splitPosition}
            onPositionChange={setSplitPosition}
          />
        ) : null}
      </View>

      <View style={styles.controls}>
        <TransportBar
          transport={transport}
          accessory={
            <Text variant="caption" faint>
              {formatOffset(offsetSeconds, reference.meta.fps ?? DEFAULT_FPS)}
            </Text>
          }
        />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.utilityRow}
        >
          {PLAYBACK_RATES.map((rate) => (
            <Button
              key={rate}
              label={`${rate}×`}
              variant={playbackRate === rate ? 'primary' : 'secondary'}
              onPress={() => setPlaybackRate(rate)}
              style={styles.utilityButton}
            />
          ))}
          <Button
            label={muted ? 'Sound off' : 'Sound on'}
            variant="secondary"
            onPress={() => setMuted(!muted)}
            style={styles.utilityButton}
          />
          <Button
            label="Re-sync"
            variant="secondary"
            onPress={() => navigation.navigate('Sync')}
            style={styles.utilityButton}
          />
          <Button
            label="Replace video 2"
            variant="ghost"
            loading={replacing}
            onPress={() => void replaceComparison()}
            style={styles.utilityButton}
          />
          <Button
            label="Record video 2"
            variant="ghost"
            onPress={() => navigation.navigate('Record', { slot: 'comparison' })}
            style={styles.utilityButton}
          />
        </ScrollView>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: { backgroundColor: colors.accentMuted, borderColor: colors.accent },
  pressed: { opacity: 0.7 },
  stage: { flex: 1, padding: spacing.md },
  controls: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.xs },
  utilityRow: { gap: spacing.sm, paddingVertical: spacing.xs },
  utilityButton: { minHeight: 42, paddingVertical: spacing.sm },
  missing: { gap: spacing.md, marginTop: spacing.xl, marginHorizontal: spacing.lg },
});
