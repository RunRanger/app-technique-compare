/**
 * Entry point: pick the two clips, then compare.
 *
 * Both slots offer the same three sources, but the reference slot leads with the
 * saved collection (that is what a collection is *for*) while the comparison
 * slot leads with the gallery and the camera.
 */

import { useCallback } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { Button, Card, Screen, Text } from '@/components/ui';
import type { RootScreenProps } from '@/navigation/types';
import { useSessionStore } from '@/state/sessionStore';
import { colors, radii, spacing } from '@/theme';
import { formatTimecode } from '@/playback/timeline';
import type { ClipSlot, ResolvedClip } from '@/types';

export function HomeScreen({ navigation }: RootScreenProps<'Home'>) {
  const reference = useSessionStore((state) => state.reference);
  const comparison = useSessionStore((state) => state.comparison);
  const clearSlot = useSessionStore((state) => state.clearSlot);
  const swapClips = useSessionStore((state) => state.swapClips);

  const bothReady = reference != null && comparison != null;

  const confirmClear = useCallback(
    (slot: ClipSlot) => {
      Alert.alert('Remove video?', 'This only clears the selection — the video itself is untouched.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => clearSlot(slot) },
      ]);
    },
    [clearSlot]
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text variant="title">Technique Compare</Text>
          <Text variant="caption" muted>
            Line up two clips frame by frame.
          </Text>
        </View>

        <SlotCard
          slot="reference"
          title="Video 1 · Reference"
          accent={colors.reference}
          clip={reference}
          onClear={() => confirmClear('reference')}
          actions={[
            { label: 'From collection', icon: '★', onPress: () => navigation.navigate('Collection', { slot: 'reference' }) },
            { label: 'Record', icon: '●', onPress: () => navigation.navigate('Record', { slot: 'reference' }) },
            { label: 'Gallery', icon: '▣', onPress: () => navigation.navigate('Gallery', { slot: 'reference' }) },
          ]}
        />

        <SlotCard
          slot="comparison"
          title="Video 2 · Comparison"
          accent={colors.comparison}
          clip={comparison}
          onClear={() => confirmClear('comparison')}
          actions={[
            { label: 'Record', icon: '●', onPress: () => navigation.navigate('Record', { slot: 'comparison' }) },
            { label: 'Gallery', icon: '▣', onPress: () => navigation.navigate('Gallery', { slot: 'comparison' }) },
            { label: 'From collection', icon: '★', onPress: () => navigation.navigate('Collection', { slot: 'comparison' }) },
          ]}
        />

        {bothReady ? (
          <View style={styles.actions}>
            <Button label="Sync & compare" icon="⇄" block onPress={() => navigation.navigate('Sync')} />
            <Button label="Swap 1 and 2" variant="ghost" block onPress={swapClips} />
          </View>
        ) : (
          <Text variant="caption" faint style={styles.hint}>
            Choose both videos to continue.
          </Text>
        )}

        <Card style={styles.noteCard}>
          <Text variant="label" muted>
            Your videos stay where they are
          </Text>
          <Text variant="caption" faint style={styles.noteBody}>
            The app saves a reference to each video, never a copy — so a collection of a hundred
            clips takes up almost no space.
          </Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}

interface SlotAction {
  label: string;
  icon: string;
  onPress: () => void;
}

function SlotCard({
  title,
  accent,
  clip,
  actions,
  onClear,
}: {
  slot: ClipSlot;
  title: string;
  accent: string;
  clip: ResolvedClip | null;
  actions: SlotAction[];
  onClear: () => void;
}) {
  return (
    <Card accent={accent} style={styles.slotCard}>
      <View style={styles.slotHeader}>
        <Text variant="label" color={accent}>
          {title}
        </Text>
        {clip ? (
          <Text variant="caption" muted onPress={onClear} suppressHighlighting>
            Clear
          </Text>
        ) : null}
      </View>

      {clip ? (
        <View style={styles.selection}>
          <Text variant="heading" numberOfLines={1}>
            {clip.name}
          </Text>
          <Text variant="caption" muted>
            {describeClip(clip)}
          </Text>
        </View>
      ) : (
        <Text variant="caption" faint style={styles.empty}>
          Nothing selected yet
        </Text>
      )}

      <View style={styles.slotActions}>
        {actions.map((action) => (
          <Button
            key={action.label}
            label={action.label}
            icon={action.icon}
            variant={clip ? 'ghost' : 'secondary'}
            onPress={action.onPress}
            style={styles.slotButton}
          />
        ))}
      </View>
    </Card>
  );
}

function describeClip(clip: ResolvedClip): string {
  const parts: string[] = [];
  if (clip.meta.durationSeconds != null) parts.push(formatTimecode(clip.meta.durationSeconds));
  if (clip.meta.width && clip.meta.height) parts.push(`${clip.meta.width}×${clip.meta.height}`);
  if (clip.meta.fps) parts.push(`${Math.round(clip.meta.fps)} fps`);
  return parts.length > 0 ? parts.join(' · ') : 'Ready';
}

const styles = StyleSheet.create({
  content: { paddingVertical: spacing.lg, gap: spacing.lg },
  header: { gap: spacing.xs },
  slotCard: { gap: spacing.md },
  slotHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selection: { gap: spacing.xs },
  empty: { paddingVertical: spacing.sm },
  slotActions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  slotButton: { flexGrow: 1, flexBasis: 0, minWidth: 96, paddingHorizontal: spacing.sm },
  actions: { gap: spacing.sm },
  hint: { textAlign: 'center', paddingVertical: spacing.sm },
  noteCard: { backgroundColor: colors.surface, borderRadius: radii.md, gap: spacing.xs },
  noteBody: { lineHeight: 18 },
});
