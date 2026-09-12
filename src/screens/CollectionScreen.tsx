/**
 * The app's first screen: the saved collection, and everything you need to get
 * from it into a comparison.
 *
 * Tapping a clip selects it straight away — no intermediate detail screen. The
 * first tap fills video 1, the second fills video 2, and from then on taps
 * replace video 2, which is the pattern that matches how the app is used: you
 * keep a model clip and cycle attempts against it.
 *
 * The two ways to bring in *new* material — the camera and the system picker —
 * live in a fixed bottom bar, so they are reachable no matter how far the list
 * has been scrolled.
 */

import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, Screen, Text } from '@/components/ui';
import type { RootScreenProps } from '@/navigation/types';
import { formatTimecode } from '@/playback/timeline';
import { ClipUnavailableError, pickVideoFromLibrary, resolveClip } from '@/services/media';
import { useCollectionStore } from '@/state/collectionStore';
import { useSessionStore } from '@/state/sessionStore';
import { colors, radii, spacing } from '@/theme';
import type { ClipSlot, CollectionItem, ResolvedClip } from '@/types';

import { RenameDialog } from './parts/RenameDialog';

export function CollectionScreen({ navigation }: RootScreenProps<'Collection'>) {
  const items = useCollectionStore((state) => state.items);
  const hydrated = useCollectionStore((state) => state.hydrated);
  const rename = useCollectionStore((state) => state.rename);
  const remove = useCollectionStore((state) => state.remove);
  const addToCollection = useCollectionStore((state) => state.add);

  const reference = useSessionStore((state) => state.reference);
  const comparison = useSessionStore((state) => state.comparison);
  const assignToNextSlot = useSessionStore((state) => state.assignToNextSlot);
  const clearSlot = useSessionStore((state) => state.clearSlot);
  const swapClips = useSessionStore((state) => state.swapClips);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [renaming, setRenaming] = useState<CollectionItem | null>(null);

  const bothReady = reference != null && comparison != null;

  /** Which slot a collection entry currently occupies, for the list badges. */
  const slotForItem = useCallback(
    (item: CollectionItem): ClipSlot | null => {
      if (reference?.ref.id === item.ref.id) return 'reference';
      if (comparison?.ref.id === item.ref.id) return 'comparison';
      return null;
    },
    [comparison, reference]
  );

  const selectFromCollection = useCallback(
    async (item: CollectionItem) => {
      setBusyId(item.id);
      try {
        const clip = await resolveClip(item.ref, {
          name: item.name,
          meta: item.meta,
          collectionItemId: item.id,
        });
        assignToNextSlot(clip);
      } catch (error) {
        const message =
          error instanceof ClipUnavailableError ? error.message : 'Could not open this video.';
        Alert.alert('Video unavailable', message, [
          { text: 'Keep entry', style: 'cancel' },
          { text: 'Remove from collection', style: 'destructive', onPress: () => remove(item.id) },
        ]);
      } finally {
        setBusyId(null);
      }
    },
    [assignToNextSlot, remove]
  );

  /**
   * System picker. A pick backed by a persistent asset id joins the collection;
   * one that only produced a sandboxed copy is selected for this session but
   * deliberately not saved, since the copy would not survive a restart.
   */
  const addFromLibrary = useCallback(async () => {
    setPicking(true);
    try {
      const picked = await pickVideoFromLibrary();
      if (!picked) return;

      if (!picked.persistent) {
        assignToNextSlot(picked.clip);
        return;
      }

      const existing = items.find((item) => item.ref.id === picked.clip.ref.id);
      if (existing) {
        // Already in the collection — select it rather than adding a duplicate.
        assignToNextSlot({ ...picked.clip, name: existing.name, collectionItemId: existing.id });
        return;
      }

      const item = addToCollection({
        name: picked.clip.name,
        ref: picked.clip.ref,
        meta: picked.clip.meta,
      });
      assignToNextSlot({ ...picked.clip, name: item.name, collectionItemId: item.id });
    } catch (error) {
      Alert.alert('Could not open the picker', String(error));
    } finally {
      setPicking(false);
    }
  }, [addToCollection, assignToNextSlot, items]);

  const confirmDelete = useCallback(
    (item: CollectionItem) => {
      Alert.alert(
        'Remove from collection?',
        `"${item.name}" will be removed from the collection. The video stays in your library.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => remove(item.id) },
        ]
      );
    },
    [remove]
  );

  if (!hydrated) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.slots}>
        <SlotChip
          label="Video 1"
          clip={reference}
          accent={colors.reference}
          onClear={() => clearSlot('reference')}
        />
        <SlotChip
          label="Video 2"
          clip={comparison}
          accent={colors.comparison}
          onClear={() => clearSlot('comparison')}
        />
      </View>

      {bothReady ? (
        <View style={styles.cta}>
          <Button label="Sync & compare" icon="⇄" block onPress={() => navigation.navigate('Sync')} />
          <Pressable onPress={swapClips} accessibilityRole="button" hitSlop={8}>
            <Text variant="caption" muted style={styles.swap}>
              Swap 1 and 2
            </Text>
          </Pressable>
        </View>
      ) : (
        <Text variant="caption" faint style={styles.hint}>
          {reference == null
            ? 'Tap a clip to use it as video 1.'
            : 'Tap another clip to use it as video 2.'}
        </Text>
      )}

      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <Card style={styles.emptyCard}>
            <Text variant="heading">Your collection is empty</Text>
            <Text variant="caption" muted style={styles.emptyBody}>
              Record a clip or add one from your library, and give it a name you will recognise
              later — a model routine, a personal best, a coach&apos;s demo. Videos are referenced,
              never copied.
            </Text>
          </Card>
        }
        renderItem={({ item }) => {
          const slot = slotForItem(item);
          const accent = slot === 'reference' ? colors.reference : colors.comparison;
          return (
            <Card
              accent={slot ? accent : undefined}
              style={[styles.item, slot ? { borderColor: accent } : null]}
              onPress={() => void selectFromCollection(item)}
              accessibilityLabel={
                slot
                  ? `${item.name}, currently video ${slot === 'reference' ? 1 : 2}`
                  : `Select ${item.name}`
              }
            >
              <View style={styles.itemRow}>
                {slot ? (
                  <View style={[styles.badge, { backgroundColor: accent }]}>
                    <Text variant="caption" color="#04121F" style={styles.badgeText}>
                      {slot === 'reference' ? '1' : '2'}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.badgePlaceholder}>
                    <Text style={styles.playGlyph}>▶</Text>
                  </View>
                )}

                <View style={styles.itemText}>
                  <Text variant="heading" numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text variant="caption" muted>
                    {describe(item)}
                  </Text>
                </View>

                {busyId === item.id ? <ActivityIndicator color={colors.accent} /> : null}
              </View>

              <View style={styles.itemActions}>
                <Button
                  label="Rename"
                  variant="ghost"
                  onPress={() => setRenaming(item)}
                  style={styles.itemButton}
                />
                <Button
                  label="Remove"
                  variant="danger"
                  onPress={() => confirmDelete(item)}
                  style={styles.itemButton}
                />
              </View>
            </Card>
          );
        }}
      />

      <View style={styles.bottomBar}>
        <Button
          label="Record"
          icon="●"
          variant="secondary"
          onPress={() => navigation.navigate('Record')}
          style={styles.bottomButton}
        />
        <Button
          label="Add from library"
          icon="▣"
          variant="secondary"
          loading={picking}
          onPress={() => void addFromLibrary()}
          style={styles.bottomButton}
        />
      </View>

      <RenameDialog
        visible={renaming != null}
        initialValue={renaming?.name ?? ''}
        title="Rename clip"
        onCancel={() => setRenaming(null)}
        onSubmit={(name) => {
          if (renaming) rename(renaming.id, name);
          setRenaming(null);
        }}
      />
    </Screen>
  );
}

function SlotChip({
  label,
  clip,
  accent,
  onClear,
}: {
  label: string;
  clip: ResolvedClip | null;
  accent: string;
  onClear: () => void;
}) {
  return (
    <View style={[styles.chip, clip ? { borderColor: accent } : null]}>
      <Text variant="caption" color={clip ? accent : colors.textFaint}>
        {label}
      </Text>
      <Text variant="label" numberOfLines={1} muted={clip == null}>
        {clip?.name ?? 'not set'}
      </Text>
      {clip ? (
        <Pressable
          onPress={onClear}
          accessibilityRole="button"
          accessibilityLabel={`Clear ${label}`}
          hitSlop={10}
          style={styles.chipClear}
        >
          <Text variant="caption" muted>
            ✕
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function describe(item: CollectionItem): string {
  const parts: string[] = [];
  if (item.meta.durationSeconds != null) parts.push(formatTimecode(item.meta.durationSeconds));
  if (item.meta.width && item.meta.height) parts.push(`${item.meta.width}×${item.meta.height}`);
  parts.push(new Date(item.createdAt).toLocaleDateString());
  return parts.join(' · ');
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  slots: { flexDirection: 'row', gap: spacing.sm, paddingTop: spacing.md },
  chip: {
    flex: 1,
    gap: 2,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 64,
    justifyContent: 'center',
  },
  chipClear: { position: 'absolute', top: spacing.xs, right: spacing.xs, padding: spacing.xs },
  cta: { gap: spacing.xs, paddingTop: spacing.md },
  swap: { textAlign: 'center', paddingVertical: spacing.xs },
  hint: { textAlign: 'center', paddingTop: spacing.md },
  list: { paddingVertical: spacing.md, gap: spacing.sm },
  item: { gap: spacing.sm, padding: spacing.md },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  itemText: { flex: 1, gap: 2 },
  badge: {
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontWeight: '700' },
  badgePlaceholder: {
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  playGlyph: { fontSize: 11, color: colors.textFaint },
  itemActions: { flexDirection: 'row', gap: spacing.sm },
  itemButton: { flex: 1, paddingHorizontal: spacing.sm, minHeight: 42 },
  emptyCard: { gap: spacing.sm, marginTop: spacing.lg },
  emptyBody: { lineHeight: 19 },
  bottomBar: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  bottomButton: { flex: 1 },
});
