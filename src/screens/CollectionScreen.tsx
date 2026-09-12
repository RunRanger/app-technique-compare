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

import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, Screen, Text } from '@/components/ui';
import type { RootScreenProps } from '@/navigation/types';
import { formatTimecode } from '@/playback/timeline';
import {
  ClipUnavailableError,
  deletePersistedClip,
  persistClipForCollection,
  pickVideoFromLibrary,
  resolveClip,
} from '@/services/media';
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
  const setClip = useSessionStore((state) => state.setClip);
  const clearSlot = useSessionStore((state) => state.clearSlot);
  const swapClips = useSessionStore((state) => state.swapClips);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [addingToCollection, setAddingToCollection] = useState(false);
  const [pickingSlot, setPickingSlot] = useState<ClipSlot | null>(null);
  const [renaming, setRenaming] = useState<CollectionItem | null>(null);
  const listRef = useRef<FlatList<CollectionItem>>(null);

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
        assignToNextSlot({ ...clip, mirrored: item.mirrored });
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
   * Grows the collection. The pick is stored and named, but no slot changes —
   * this is for building up a library of reference clips, not for setting up the
   * comparison in front of you.
   *
   * `persistClipForCollection` is what makes storing reliable. A pick backed by
   * a MediaLibrary asset id is kept as a reference with nothing copied; a pick
   * that only produced a sandboxed cache copy is relocated to app storage first,
   * because a cache path is reclaimable and would leave a dead entry behind.
   */
  const addToLibraryCollection = useCallback(async () => {
    setAddingToCollection(true);
    try {
      const picked = await pickVideoFromLibrary();
      if (!picked) return;

      if (items.some((item) => item.ref.id === picked.clip.ref.id)) {
        Alert.alert('Already in your collection', `"${picked.clip.name}" is already saved.`);
        return;
      }

      const persisted = await persistClipForCollection(picked.clip, picked.persistent);
      addToCollection({
        name: persisted.name,
        ref: persisted.ref,
        meta: persisted.meta,
      });

      // New entries go to the top, and the button that triggered this sits at the
      // bottom of the list — so bring the result into view rather than leaving
      // the user to wonder whether anything happened.
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    } catch (error) {
      Alert.alert(
        'Could not add the video',
        error instanceof Error ? error.message : String(error)
      );
    } finally {
      setAddingToCollection(false);
    }
  }, [addToCollection, items]);

  /**
   * Fills one slot straight from the device library, without touching the
   * collection — the path for a one-off comparison against something you are not
   * going to keep.
   *
   * A pick with no asset id is a cache copy here, which is fine: session clips
   * are not persisted either way, and anything worth keeping goes in through
   * "Add to collection" instead.
   */
  const pickForSlot = useCallback(
    async (slot: ClipSlot) => {
      setPickingSlot(slot);
      try {
        const picked = await pickVideoFromLibrary();
        if (!picked) return;

        // If it happens to be a collection entry already, carry its name and
        // mirror setting rather than showing a bare filename.
        const existing = items.find((item) => item.ref.id === picked.clip.ref.id);
        setClip(slot, {
          ...picked.clip,
          name: existing?.name ?? picked.clip.name,
          collectionItemId: existing?.id,
          mirrored: existing?.mirrored,
        });
      } catch (error) {
        Alert.alert(
          'Could not open the picker',
          error instanceof Error ? error.message : String(error)
        );
      } finally {
        setPickingSlot(null);
      }
    },
    [items, setClip]
  );

  const confirmDelete = useCallback(
    (item: CollectionItem) => {
      Alert.alert(
        'Remove from collection?',
        item.ref.kind === 'mediaLibrary'
          ? `"${item.name}" will be removed from the collection. The video stays in your library.`
          : `"${item.name}" was stored by this app, so removing it deletes the video.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => {
              // Frees the file only if this app relocated it into its own
              // storage; library assets and cache paths are left alone.
              deletePersistedClip(item.ref);
              remove(item.id);
            },
          },
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
        ref={listRef}
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <Card style={styles.emptyCard}>
            <Text variant="heading">Your collection is empty</Text>
            <Text variant="caption" muted style={styles.emptyBody}>
              Save the clips you compare against again and again — a model routine, a personal
              best, a coach&apos;s demo. Videos are referenced, never copied.
            </Text>
          </Card>
        }
        ListFooterComponent={
          <View style={styles.footer}>
            <Button
              label="Add to collection"
              icon="＋"
              variant="secondary"
              block
              loading={addingToCollection}
              onPress={() => void addToLibraryCollection()}
            />
            <Button
              label="Record a new clip"
              icon="●"
              variant="ghost"
              block
              onPress={() => navigation.navigate('Record')}
            />
          </View>
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
                    {item.mirrored ? '  ⇋ mirrored' : ''}
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

      {/* Fixed: picking the two clips for the comparison at hand, straight from
          the device library and without adding anything to the collection. */}
      <View style={styles.bottomBar}>
        <Button
          label={reference ? 'Replace video 1' : 'Pick video 1'}
          icon="▣"
          variant="secondary"
          loading={pickingSlot === 'reference'}
          onPress={() => void pickForSlot('reference')}
          style={styles.bottomButton}
        />
        <Button
          label={comparison ? 'Replace video 2' : 'Pick video 2'}
          icon="▣"
          variant="secondary"
          loading={pickingSlot === 'comparison'}
          onPress={() => void pickForSlot('comparison')}
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
  footer: { gap: spacing.xs, paddingTop: spacing.sm },
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
