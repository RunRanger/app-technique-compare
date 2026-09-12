/**
 * In-app capture.
 *
 * Recording writes to the app cache first, not the library — the user gets to
 * review it and decide. Saving happens on the preview screen; discarding deletes
 * the temporary file.
 *
 * The camera defaults to 60 fps-capable 1080p rather than 4K: for motion
 * analysis, temporal resolution beats spatial resolution, and 4K makes seeking
 * noticeably slower on mid-range devices.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions, useMicrophonePermissions, type CameraType } from 'expo-camera';

import { Button, Card, Screen, Text } from '@/components/ui';
import type { RootScreenProps } from '@/navigation/types';
import { colors, radii, spacing } from '@/theme';
import { formatTimecode } from '@/playback/timeline';

/** Keeps a runaway recording from filling the device. */
const MAX_DURATION_SECONDS = 120;

export function RecordScreen({ navigation, route }: RootScreenProps<'Record'>) {
  const { slot } = route.params;

  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] = useMicrophonePermissions();

  const cameraRef = useRef<CameraView>(null);
  const [facing, setFacing] = useState<CameraType>('back');
  const [isRecording, setIsRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [ready, setReady] = useState(false);
  const startedAtRef = useRef(0);

  // Guards the stop path: `recordAsync` resolves when recording ends, so the
  // component may already be unmounting when it does.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!isRecording) return;
    const startedAt = startedAtRef.current;
    const timer = setInterval(() => setElapsed((Date.now() - startedAt) / 1000), 100);
    return () => clearInterval(timer);
  }, [isRecording]);

  const start = useCallback(async () => {
    const camera = cameraRef.current;
    if (!camera || isRecording) return;

    startedAtRef.current = Date.now();
    setElapsed(0);
    setIsRecording(true);
    try {
      // Resolves only once recording stops, either via `stopRecording` or maxDuration.
      const result = await camera.recordAsync({ maxDuration: MAX_DURATION_SECONDS });
      if (!mounted.current) return;
      if (result?.uri) {
        navigation.replace('RecordPreview', { slot, uri: result.uri });
      }
    } catch (error) {
      if (mounted.current) Alert.alert('Recording failed', String(error));
    } finally {
      if (mounted.current) setIsRecording(false);
    }
  }, [isRecording, navigation, slot]);

  const stop = useCallback(() => {
    cameraRef.current?.stopRecording();
  }, []);

  const needsPermission = !cameraPermission?.granted || !microphonePermission?.granted;

  if (needsPermission) {
    return (
      <Screen>
        <Card style={styles.permissionCard}>
          <Text variant="heading">Camera access needed</Text>
          <Text variant="caption" muted style={styles.permissionBody}>
            Recording needs the camera, and the microphone so you keep the audio from the run — a
            coach&apos;s call or the beat of a routine is often part of the timing.
          </Text>
          <Button
            label="Allow access"
            onPress={() => {
              void requestCameraPermission();
              void requestMicrophonePermission();
            }}
          />
          <Button
            label="Pick from gallery instead"
            variant="secondary"
            onPress={() => navigation.replace('Gallery', { slot })}
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen bleed edges={['bottom']}>
      <View style={styles.stage}>
        <CameraView
          ref={cameraRef}
          style={styles.camera}
          facing={facing}
          mode="video"
          videoQuality="1080p"
          videoStabilizationMode="standard"
          onCameraReady={() => setReady(true)}
          onMountError={(event) => Alert.alert('Camera error', event.message)}
        />

        {isRecording ? (
          <View style={styles.recordingBadge}>
            <View style={styles.recordingDot} />
            <Text variant="mono">{formatTimecode(elapsed)}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Switch camera"
          disabled={isRecording}
          onPress={() => setFacing((current) => (current === 'back' ? 'front' : 'back'))}
          style={({ pressed }) => [
            styles.secondaryControl,
            (pressed || isRecording) && styles.dimmed,
          ]}
        >
          <Text style={styles.controlIcon}>⟳</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isRecording ? 'Stop recording' : 'Start recording'}
          accessibilityState={{ busy: isRecording }}
          disabled={!ready}
          onPress={() => (isRecording ? stop() : void start())}
          style={({ pressed }) => [styles.shutter, pressed && styles.dimmed, !ready && styles.dimmed]}
        >
          <View style={isRecording ? styles.shutterStop : styles.shutterIdle} />
        </Pressable>

        <View style={styles.secondaryControl}>
          <Text variant="caption" faint>
            {MAX_DURATION_SECONDS}s
          </Text>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  recordingBadge: {
    position: 'absolute',
    top: spacing.xl,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.overlay,
  },
  recordingDot: { width: 10, height: 10, borderRadius: radii.pill, backgroundColor: colors.danger },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: spacing.lg,
    backgroundColor: colors.background,
  },
  secondaryControl: {
    width: 56,
    height: 56,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlIcon: { fontSize: 22, color: colors.text },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: radii.pill,
    borderWidth: 3,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterIdle: { width: 60, height: 60, borderRadius: radii.pill, backgroundColor: colors.danger },
  shutterStop: { width: 28, height: 28, borderRadius: radii.sm, backgroundColor: colors.danger },
  dimmed: { opacity: 0.5 },
  permissionCard: { gap: spacing.md, marginTop: spacing.xl },
  permissionBody: { lineHeight: 19 },
});
