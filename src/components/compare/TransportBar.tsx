/**
 * The master transport: timeline scrubber, play/pause, and frame steppers.
 *
 * The slider is the only writer of its own `value` while a drag is in progress,
 * which is what keeps dragging smooth — feeding a ticker-driven value back into
 * a slider mid-gesture makes the thumb fight the finger.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';

import { Text } from '@/components/ui';
import type { SyncedPlayback } from '@/playback/useSyncedPlayback';
import { colors, radii, spacing } from '@/theme';

import { Timecode } from './Timecode';

interface TransportBarProps {
  transport: SyncedPlayback;
  /** Rendered to the right of the steppers — e.g. a speed control. */
  accessory?: React.ReactNode;
}

export function TransportBar({ transport, accessory }: TransportBarProps) {
  const [isPlaying, setIsPlaying] = useState(() => transport.isPlaying());
  const [sliderValue, setSliderValue] = useState(() => transport.getTime());
  const dragging = useRef(false);

  useEffect(() => transport.subscribePlaying(setIsPlaying), [transport]);

  // Follow the playhead, except while the user is dragging the thumb.
  useEffect(
    () =>
      transport.subscribeTime((time) => {
        if (!dragging.current) setSliderValue(time);
      }),
    [transport]
  );

  const handleSlidingStart = useCallback(() => {
    dragging.current = true;
    transport.beginScrub();
  }, [transport]);

  const handleValueChange = useCallback(
    (value: number) => {
      setSliderValue(value);
      // Only seek while dragging; the slider also emits on programmatic updates.
      if (dragging.current) transport.seekTo(value);
    },
    [transport]
  );

  const handleSlidingComplete = useCallback(
    (value: number) => {
      dragging.current = false;
      transport.seekTo(value, { exact: true });
      transport.endScrub();
    },
    [transport]
  );

  const step = useCallback(
    (frames: number) => {
      transport.stepFrames(frames);
      setSliderValue(transport.getTime());
      void Haptics.selectionAsync();
    },
    [transport]
  );

  const { timeline } = transport;

  return (
    <View style={styles.container}>
      <Slider
        style={styles.slider}
        minimumValue={timeline.start}
        maximumValue={timeline.end}
        value={sliderValue}
        onSlidingStart={handleSlidingStart}
        onValueChange={handleValueChange}
        onSlidingComplete={handleSlidingComplete}
        minimumTrackTintColor={colors.accent}
        maximumTrackTintColor={colors.border}
        thumbTintColor={colors.accent}
        accessibilityLabel="Comparison timeline"
      />

      <View style={styles.row}>
        <StepButton label="−10" onPress={() => step(-10)} accessibilityLabel="Back 10 frames" />
        <StepButton label="−1" onPress={() => step(-1)} accessibilityLabel="Back one frame" />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? 'Pause both videos' : 'Play both videos'}
          onPress={() => {
            transport.toggle();
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }}
          style={({ pressed }) => [styles.playButton, pressed && styles.pressed]}
        >
          <Text style={styles.playIcon}>{isPlaying ? '❚❚' : '▶'}</Text>
        </Pressable>

        <StepButton label="+1" onPress={() => step(1)} accessibilityLabel="Forward one frame" />
        <StepButton label="+10" onPress={() => step(10)} accessibilityLabel="Forward 10 frames" />
      </View>

      <View style={styles.footer}>
        <Timecode transport={transport} />
        {accessory}
      </View>
    </View>
  );
}

function StepButton({
  label,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.stepButton, pressed && styles.pressed]}
    >
      <Text variant="mono">{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.sm, paddingVertical: spacing.sm },
  slider: { width: '100%', height: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  stepButton: {
    minWidth: 52,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  playButton: {
    width: 64,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    backgroundColor: colors.accent,
  },
  playIcon: { fontSize: 18, color: '#04121F', fontWeight: '700' },
  pressed: { opacity: 0.7 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 24,
  },
});
