/**
 * The Size tab: bring both athletes to the same apparent size.
 *
 * Apparent size is a camera artefact — how far away the phone was — and it makes
 * two otherwise identical shapes hard to compare. Correcting it is display-only:
 * nothing about the video, the timeline or the alignment changes.
 *
 * One clip is adjusted at a time. Zoom alone is rarely enough, because scaling
 * about the centre pushes an athlete who is not centred out of frame, so panning
 * sits right next to it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';

import { Button, Card, Text } from '@/components/ui';
import { analyzeWindow, poseRegistry } from '@/services/pose';
import { computeAutoScale, type AutoScaleResult } from '@/services/sync';
import { useSessionStore } from '@/state/sessionStore';
import { colors, radii, spacing } from '@/theme';
import {
  CLIP_OFFSET_LIMIT,
  CLIP_SCALE_MAX,
  CLIP_SCALE_MIN,
  type ClipSlot,
  type ResolvedClip,
} from '@/types';

interface SizePanelProps {
  reference: ResolvedClip;
  comparison: ResolvedClip;
  previewTime: number;
  onError: (message: string) => void;
}

export function SizePanel({ reference, comparison, previewTime, onError }: SizePanelProps) {
  const referenceView = useSessionStore((state) => state.referenceView);
  const comparisonView = useSessionStore((state) => state.comparisonView);
  const setClipView = useSessionStore((state) => state.setClipView);
  const resetClipView = useSessionStore((state) => state.resetClipView);

  const [slot, setSlot] = useState<ClipSlot>('comparison');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<AutoScaleResult | null>(null);
  const [simulated, setSimulated] = useState<boolean | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    let cancelled = false;
    void poseRegistry.isSimulated().then((value) => {
      if (!cancelled) setSimulated(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const view = slot === 'reference' ? referenceView : comparisonView;

  /**
   * Measures both athletes and applies the correction to video 2, which is the
   * slot that changes between comparisons — video 1 is the constant to match.
   */
  const matchSizes = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setProgress(0);

    try {
      const analysis = await analyzeWindow(
        { uri: reference.uri, sourceId: reference.ref.id, durationSeconds: reference.meta.durationSeconds },
        { uri: comparison.uri, sourceId: comparison.ref.id, durationSeconds: comparison.meta.durationSeconds },
        previewTime,
        setProgress,
        controller.signal
      );
      if (controller.signal.aborted) return;

      const scale = computeAutoScale(analysis.reference, analysis.comparison);
      setResult(scale);

      if (scale.confidence > 0) {
        setClipView('comparison', { scale: comparisonView.scale * scale.scale });
        setSlot('comparison');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return;
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [comparison, comparisonView.scale, onError, previewTime, reference, setClipView]);

  return (
    <Card style={styles.card}>
      <View style={styles.slotRow}>
        <Button
          label="Video 1"
          variant={slot === 'reference' ? 'primary' : 'secondary'}
          onPress={() => setSlot('reference')}
          style={styles.slotButton}
        />
        <Button
          label="Video 2"
          variant={slot === 'comparison' ? 'primary' : 'secondary'}
          onPress={() => setSlot('comparison')}
          style={styles.slotButton}
        />
      </View>

      <ControlRow
        label="Zoom"
        value={`${view.scale.toFixed(2)}×`}
        min={CLIP_SCALE_MIN}
        max={CLIP_SCALE_MAX}
        current={view.scale}
        accent={slot === 'reference' ? colors.reference : colors.comparison}
        onChange={(scale) => setClipView(slot, { scale })}
      />
      <ControlRow
        label="Left / right"
        value={formatOffsetLabel(view.offsetX)}
        min={-CLIP_OFFSET_LIMIT}
        max={CLIP_OFFSET_LIMIT}
        current={view.offsetX}
        accent={colors.textMuted}
        onChange={(offsetX) => setClipView(slot, { offsetX })}
      />
      <ControlRow
        label="Up / down"
        value={formatOffsetLabel(view.offsetY)}
        min={-CLIP_OFFSET_LIMIT}
        max={CLIP_OFFSET_LIMIT}
        current={view.offsetY}
        accent={colors.textMuted}
        onChange={(offsetY) => setClipView(slot, { offsetY })}
      />

      <View style={styles.actions}>
        <Button
          label="Reset"
          variant="ghost"
          onPress={() => resetClipView(slot)}
          style={styles.action}
        />
        {running ? (
          <View style={styles.progress}>
            <ActivityIndicator color={colors.accent} />
            <Text variant="caption" muted>
              Measuring… {Math.round(progress * 100)}%
            </Text>
          </View>
        ) : (
          <Button
            label="Match automatically"
            icon="◎"
            onPress={() => void matchSizes()}
            style={styles.action}
          />
        )}
      </View>

      {result ? (
        <View style={styles.result}>
          <Text variant="caption" muted style={styles.resultText}>
            {result.explanation}
          </Text>
          {result.confidence > 0 ? (
            <Text variant="caption" faint>
              Measured over {Math.min(result.referenceSamples, result.comparisonSamples)} tracked
              frames · {Math.round(result.confidence * 100)}% confidence
            </Text>
          ) : null}
        </View>
      ) : null}

      {simulated ? (
        <Text variant="caption" faint style={styles.notice}>
          No pose model is active, so automatic matching runs on simulated landmarks. Use the
          sliders above instead.
        </Text>
      ) : null}
    </Card>
  );
}

function ControlRow({
  label,
  value,
  min,
  max,
  current,
  accent,
  onChange,
}: {
  label: string;
  value: string;
  min: number;
  max: number;
  current: number;
  accent: string;
  onChange: (value: number) => void;
}) {
  return (
    <View style={styles.control}>
      <View style={styles.controlHeader}>
        <Text variant="caption" muted>
          {label}
        </Text>
        <Text variant="mono" muted>
          {value}
        </Text>
      </View>
      <Slider
        style={styles.slider}
        minimumValue={min}
        maximumValue={max}
        value={current}
        onValueChange={onChange}
        minimumTrackTintColor={accent}
        maximumTrackTintColor={colors.border}
        thumbTintColor={accent}
        accessibilityLabel={label}
      />
    </View>
  );
}

/** Pan is a fraction of the surface; percent reads better than "0.12". */
const formatOffsetLabel = (value: number): string =>
  `${value >= 0 ? '+' : '−'}${Math.abs(Math.round(value * 100))}%`;

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  slotRow: { flexDirection: 'row', gap: spacing.sm },
  slotButton: { flex: 1 },
  control: { gap: 2 },
  controlHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  slider: { width: '100%', height: 36 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  action: { flex: 1 },
  progress: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  result: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resultText: { lineHeight: 18 },
  notice: { lineHeight: 16 },
});
