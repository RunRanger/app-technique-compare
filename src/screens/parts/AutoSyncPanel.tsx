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
import { poseRegistry } from '@/services/pose';
import { computeAutoSync, SIGNAL_CHANNELS, type AutoSyncResult, type SignalChannel } from '@/services/sync';
import { useSessionStore } from '@/state/sessionStore';
import { colors, radii, spacing } from '@/theme';
import type { ResolvedClip } from '@/types';

/** Seconds analysed either side of the preview position. */
const WINDOW_HALF_SPAN = 2;
/** Pose sampling rate. Well above the movement's frequency content, far below video rate. */
const SAMPLE_FPS = 15;

interface AutoSyncPanelProps {
  reference: ResolvedClip;
  comparison: ResolvedClip;
  previewTime: number;
  onOffsetSuggested: (offsetSeconds: number) => void;
  onError: (message: string) => void;
}

export function AutoSyncPanel({
  reference,
  comparison,
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
      const window = (clip: ResolvedClip, center: number) => {
        const duration = clip.meta.durationSeconds ?? center + WINDOW_HALF_SPAN;
        return {
          startSeconds: Math.max(0, center - WINDOW_HALF_SPAN),
          endSeconds: Math.min(duration, center + WINDOW_HALF_SPAN),
        };
      };

      // Both clips are analysed over a window around the same nominal moment.
      // The comparison clip's true event may sit outside it, which is exactly
      // what the offset search is for — hence the generous half-span.
      const referenceWindow = window(reference, previewTime);
      const comparisonWindow = window(comparison, previewTime);

      let referenceProgress = 0;
      let comparisonProgress = 0;
      const report = () => setProgress((referenceProgress + comparisonProgress) / 2);

      const [referenceSequence, comparisonSequence] = await Promise.all([
        poseRegistry.estimate(
          {
            uri: reference.uri,
            sourceId: reference.ref.id,
            sampleFps: SAMPLE_FPS,
            ...referenceWindow,
          },
          (update) => {
            referenceProgress = update.fraction;
            report();
          },
          controller.signal
        ),
        poseRegistry.estimate(
          {
            uri: comparison.uri,
            sourceId: comparison.ref.id,
            sampleFps: SAMPLE_FPS,
            ...comparisonWindow,
          },
          (update) => {
            comparisonProgress = update.fraction;
            report();
          },
          controller.signal
        ),
      ]);

      if (controller.signal.aborted) return;

      const result = computeAutoSync(referenceSequence, comparisonSequence, {
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
  }, [channel, comparison, onError, previewTime, reference, setAutoSyncResult]);

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
