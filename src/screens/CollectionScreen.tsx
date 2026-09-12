/**
 * The saved reference collection.
 *
 * Entries hold a persistent asset id and a user-chosen name. Resolving one to a
 * playable URI happens on selection, which is also where a clip deleted from the
 * device library is detected and reported.
 */

import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, View } from 'react-native';

import { Button, Card, Screen, Text } from '@/components/ui';
import type { RootScreenProps } from '@/navigation/types';
import { formatTimecode } from '@/playback/timeline';
import { ClipUnavailableError, resolveClip } from '@/services/media';
import { useCollectionStore } from '@/state/collectionStore';
import { useSessionStore } from '@/state/sessionStore';
import { colors, spacing } from '@/theme';
import type { CollectionItem } from '@/types';

import { RenameDialog } from './parts/RenameDialog';

export function CollectionScreen({ navigation, route }: RootScreenProps<'Collection'>) {
  const { slot } = route.params;
  const items = useCollectionStore((state) => state.items);
  const hydrated = useCollectionStore((state) => state.hydrated);
  const rename = useCollectionStore((state) => state.rename);
  const remove = useCollectionStore((state) => state.remove);
  const setClip = useSessionStore((state) => state.setClip);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<CollectionItem | null>(null);

  const select = useCallback(
    async (item: CollectionItem) => {
      setBusyId(item.id);
      try {
        const clip = await resolveClip(item.ref, {
          name: item.name,
          meta: item.meta,
          collectionItemId: item.id,
        });
        setClip(slot, clip);
        navigation.navigate('Home');
      } catch (error) {
        const message =
          error instanceof ClipUnavailableError
            ? error.message
            : 'Could not open this video.';
        Alert.alert('Video unavailable', message, [
          { text: 'Keep entry', style: 'cancel' },
          { text: 'Remove from collection', style: 'destructive', onPress: () => remove(item.id) },
        ]);
      } finally {
        setBusyId(null);
      }
    },
    [navigation, remove, setClip, slot]
  );

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
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <Text variant="caption" muted style={styles.header}>
            {items.length > 0
              ? `${items.length} saved ${items.length === 1 ? 'clip' : 'clips'}`
              : ''}
          </Text>
        }
        ListEmptyComponent={
          <Card style={styles.emptyCard}>
            <Text variant="heading">No saved clips yet</Text>
            <Text variant="caption" muted style={styles.emptyBody}>
              Record a clip or pick one from your gallery, then save it under a name you will
              recognise later — a model routine, a personal best, a coach&apos;s demo.
            </Text>
            <View style={styles.emptyActions}>
              <Button
                label="Record"
                icon="●"
                onPress={() => navigation.navigate('Record', { slot })}
                style={styles.emptyButton}
              />
              <Button
                label="Gallery"
                icon="▣"
                variant="secondary"
                onPress={() => navigation.navigate('Gallery', { slot })}
                style={styles.emptyButton}
              />
            </View>
          </Card>
        }
        renderItem={({ item }) => (
          <Card
            accent={colors.reference}
            style={styles.item}
            onPress={() => void select(item)}
            accessibilityLabel={`Use ${item.name}`}
          >
            <View style={styles.itemRow}>
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
        )}
      />

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

function describe(item: CollectionItem): string {
  const parts: string[] = [];
  if (item.meta.durationSeconds != null) parts.push(formatTimecode(item.meta.durationSeconds));
  if (item.meta.width && item.meta.height) parts.push(`${item.meta.width}×${item.meta.height}`);
  parts.push(new Date(item.createdAt).toLocaleDateString());
  return parts.join(' · ');
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingVertical: spacing.lg, gap: spacing.md },
  header: { paddingBottom: spacing.xs },
  item: { gap: spacing.md },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  itemText: { flex: 1, gap: spacing.xs },
  itemActions: { flexDirection: 'row', gap: spacing.sm },
  itemButton: { flex: 1, paddingHorizontal: spacing.sm },
  emptyCard: { gap: spacing.md, marginTop: spacing.xl },
  emptyBody: { lineHeight: 19 },
  emptyActions: { flexDirection: 'row', gap: spacing.sm },
  emptyButton: { flex: 1 },
});
