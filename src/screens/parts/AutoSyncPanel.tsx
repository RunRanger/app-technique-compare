/**
 * Auto-sync UI over the pose pipeline.
 *
 * Two deliberate choices:
 *
 *  - Analysis runs on a *window* around the preview position, not the whole
 *    clip. Pose estimation is the expensive step, and a few seconds around the
 *    movement is both faster and more accurate than the full clip, which may
 *    contain a walk-up, a second attempt, or someone else's turn.
 *
 *  - The result is presented with its confidence and the reasoning behind it,
 *    and only applied when the user accepts it. An alignment silently set by a
 *    model the user cannot inspect is worse than no alignment.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Button, Card, Text } from '@/components/ui';
import { analyzeWindow, poseRegistry, WINDOW_HALF_SPAN } from '@/services/pose';
import { computeAutoSync, SIGNAL_CHANNELS, type AutoSyncResult, type SignalChannel } from '@/services/sync';
import { useSessionStore } from '@/state/sessionStore';
import { colors, radii, spacing } from '@/theme';
import type { VideoPlayer } from 'expo-video';

import type { ResolvedClip } from '@/types';

interface AutoSyncPanelProps {
  reference: ResolvedClip;
  comparison: ResolvedClip;
  /** The screen's live players, reused so the assets are not opened twice. */
  referencePlayer?: VideoPlayer;
  comparisonPlayer?: VideoPlayer;
  previewTime: number;
  onOffsetSuggested: (offsetSeconds: number) => void;
  onError: (message: string) => void;
}

export function AutoSyncPanel({
  reference,
  comparison,
  referencePlayer,
  comparisonPlayer,
  previewTime,
  onOffsetSuggested,
  onError,
}: AutoSyncPanelProps) {
  const lastAutoSync = useSessionStore((state) => state.lastAutoSync);
  const setAutoSyncResult = useSessionStore((state) => state.setAutoSyncResult);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [channel, setChannel] = useState<SignalChannel>('hipHeight');
  const [simulated, setSimulated] = useState<boolean | null>(null);
  const [estimatorName, setEstimatorName] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [isSimulated, active] = await Promise.all([
        poseRegistry.isSimulated(),
        poseRegistry.getActive(),
      ]);
      if (cancelled) return;
      setSimulated(isSimulated);
      setEstimatorName(active?.displayName ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Abandon an in-flight analysis if the user navigates away.
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setProgress(0);

    try {
      const analysis = await analyzeWindow(
        {
          uri: reference.uri,
          sourceId: reference.ref.id,
          durationSeconds: reference.meta.durationSeconds,
          player: referencePlayer,
        },
        {
          uri: comparison.uri,
          sourceId: comparison.ref.id,
          durationSeconds: comparison.meta.durationSeconds,
          player: comparisonPlayer,
        },
        previewTime,
        setProgress,
        controller.signal
      );
      if (controller.signal.aborted) return;

      const result = computeAutoSync(analysis.reference, analysis.comparison, {
        channel,
        maxOffsetSeconds: Math.max(2, WINDOW_HALF_SPAN * 2),
      });
      setAutoSyncResult(result);
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return;
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }, [
    channel,
    comparison,
    comparisonPlayer,
    onError,
    previewTime,
    reference,
    referencePlayer,
    setAutoSyncResult,
  ]);

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text variant="label">Auto-sync</Text>
        {estimatorName ? (
          <Text variant="caption" faint numberOfLines={1} style={styles.estimator}>
            {estimatorName}
          </Text>
        ) : null}
      </View>

      <Text variant="caption" faint>
        Finds the athlete&apos;s body in both clips and lines up the movement.
      </Text>

      <View style={styles.channels}>
        {SIGNAL_CHANNELS.map((option) => {
          const active = option.key === channel;
          return (
            <Button
              key={option.key}
              label={option.label}
              variant={active ? 'primary' : 'secondary'}
              onPress={() => setChannel(option.key)}
              style={styles.channelButton}
            />
          );
        })}
      </View>

      {running ? (
        <View style={styles.progress}>
          <ActivityIndicator color={colors.accent} />
          <Text variant="caption" muted>
            Analysing… {Math.round(progress * 100)}%
          </Text>
        </View>
      ) : (
        <Button label="Analyse movement" icon="◎" block onPress={() => void run()} />
      )}

      {lastAutoSync ? <ResultBlock result={lastAutoSync} onApply={onOffsetSuggested} /> : null}

      {simulated ? (
        <View style={styles.notice}>
          <Text variant="caption" faint style={styles.noticeText}>
            No pose model is installed in this build, so auto-sync runs on simulated landmarks. The
            full pipeline is real — see the README for how to plug in MediaPipe or TF-Lite.
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

function ResultBlock({
  result,
  onApply,
}: {
  result: AutoSyncResult;
  onApply: (offsetSeconds: number) => void;
}) {
  const confidencePercent = Math.round(result.confidence * 100);
  const tone =
    result.confidence >= 0.7 ? colors.success : result.confidence >= 0.4 ? colors.comparison : colors.danger;

  return (
    <View style={styles.result}>
      <View style={styles.resultHeader}>
        <Text variant="mono" color={tone}>
          {result.offsetSeconds >= 0 ? '+' : '−'}
          {Math.abs(result.offsetSeconds).toFixed(3)} s
        </Text>
        <Text variant="caption" color={tone}>
          {confidencePercent}% confidence
        </Text>
      </View>

      <Text variant="caption" muted style={styles.explanation}>
        {result.explanation}
      </Text>

      {result.method !== 'none' ? (
        <Button label="Use this offset" variant="secondary" block onPress={() => onApply(result.offsetSeconds)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  estimator: { flexShrink: 1, textAlign: 'right' },
  channels: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  channelButton: { flexGrow: 1, flexBasis: '46%', paddingHorizontal: spacing.xs, minHeight: 42 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  result: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resultHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  explanation: { lineHeight: 18 },
  notice: { paddingTop: spacing.xs },
  noticeText: { lineHeight: 16 },
});
