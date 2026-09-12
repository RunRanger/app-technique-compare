/**
 * Device video picker, backed by the media library.
 *
 * Pages through assets rather than loading the whole library, and keeps only the
 * asset id — picking a clip resolves a URI on demand.
 */

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, StyleSheet, View } from 'react-native';

import { Button, Card, Screen, Text } from '@/components/ui';
import type { RootScreenProps } from '@/navigation/types';
import { formatTimecode } from '@/playback/timeline';
import {
  ensureMediaPermission,
  listGalleryVideos,
  presentLimitedAccessPicker,
  resolveClip,
  type GalleryVideo,
  type MediaPermissionState,
} from '@/services/media';
import { useSessionStore } from '@/state/sessionStore';
import { colors, radii, spacing } from '@/theme';

const PAGE_SIZE = 60;

export function GalleryScreen({ navigation, route }: RootScreenProps<'Gallery'>) {
  const { slot } = route.params;
  const setClip = useSessionStore((state) => state.setClip);

  const [permission, setPermission] = useState<MediaPermissionState | null>(null);
  const [videos, setVideos] = useState<GalleryVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);

  const load = useCallback(async (offset: number) => {
    const page = await listGalleryVideos(PAGE_SIZE, offset);
    setExhausted(page.length < PAGE_SIZE);
    setVideos((current) => (offset === 0 ? page : [...current, ...page]));
  }, []);

  const requestAndLoad = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      try {
        const state = await ensureMediaPermission();
        if (isCancelled()) return;
        setPermission(state);
        if (state === 'granted' || state === 'limited') {
          await load(0);
        }
      } catch (error) {
        if (!isCancelled()) Alert.alert('Could not read your library', String(error));
      } finally {
        if (!isCancelled()) setLoading(false);
      }
    },
    [load]
  );

  // `loading` starts true, so the first pass needs no synchronous state write.
  // The cancellation flag keeps a popped screen from setting state late.
  useEffect(() => {
    let cancelled = false;
    // The state writes inside `requestAndLoad` all happen after an `await`, so
    // they are never synchronous with this effect. The rule cannot see across
    // the async boundary and reports them as if they were.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void requestAndLoad(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [requestAndLoad]);

  /** Retry from the permission screen, where a spinner does need re-showing. */
  const retry = useCallback(() => {
    setLoading(true);
    void requestAndLoad();
  }, [requestAndLoad]);

  const loadMore = useCallback(async () => {
    if (loadingMore || exhausted || loading) return;
    setLoadingMore(true);
    try {
      await load(videos.length);
    } catch {
      // A failed page is not worth an alert; the user can pull to retry.
    } finally {
      setLoadingMore(false);
    }
  }, [exhausted, load, loading, loadingMore, videos.length]);

  const select = useCallback(
    async (video: GalleryVideo) => {
      setSelectingId(video.id);
      try {
        const clip = await resolveClip(
          { kind: 'mediaLibrary', id: video.id },
          {
            name: video.filename,
            meta: {
              durationSeconds: video.durationSeconds,
              width: video.width,
              height: video.height,
              fps: null,
            },
          }
        );
        setClip(slot, clip);
        navigation.navigate('Home');
      } catch (error) {
        Alert.alert('Could not open this video', String(error));
      } finally {
        setSelectingId(null);
      }
    },
    [navigation, setClip, slot]
  );

  if (loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
          <Text variant="caption" muted>
            Reading your library…
          </Text>
        </View>
      </Screen>
    );
  }

  if (permission === 'denied' || permission === 'undetermined') {
    return (
      <Screen>
        <Card style={styles.permissionCard}>
          <Text variant="heading">Library access needed</Text>
          <Text variant="caption" muted style={styles.permissionBody}>
            Technique Compare needs permission to read videos so you can pick one to compare. It
            only reads — nothing is copied or uploaded.
          </Text>
          <Button label="Try again" onPress={retry} />
          <Button
            label="Record instead"
            variant="secondary"
            onPress={() => navigation.replace('Record', { slot })}
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={videos}
        keyExtractor={(item) => item.id}
        numColumns={2}
        columnWrapperStyle={styles.column}
        contentContainerStyle={styles.list}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          permission === 'limited' ? (
            <Card style={styles.limitedCard}>
              <Text variant="caption" muted>
                You have given access to selected videos only.
              </Text>
              <Button
                label="Choose more videos"
                variant="ghost"
                onPress={() => void presentLimitedAccessPicker().then(retry)}
              />
            </Card>
          ) : null
        }
        ListEmptyComponent={
          <Card style={styles.permissionCard}>
            <Text variant="heading">No videos found</Text>
            <Text variant="caption" muted>
              Record a clip to get started.
            </Text>
            <Button label="Record" icon="●" onPress={() => navigation.replace('Record', { slot })} />
          </Card>
        }
        ListFooterComponent={
          loadingMore ? <ActivityIndicator style={styles.footer} color={colors.accent} /> : null
        }
        renderItem={({ item }) => (
          <Card
            style={styles.tile}
            onPress={() => void select(item)}
            accessibilityLabel={`Use ${item.filename}`}
          >
            <View style={styles.thumb}>
              {selectingId === item.id ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <Text style={styles.thumbIcon}>▶</Text>
              )}
              {item.durationSeconds != null ? (
                <View style={styles.duration}>
                  <Text variant="caption">{formatTimecode(item.durationSeconds)}</Text>
                </View>
              ) : null}
            </View>
            <Text variant="caption" numberOfLines={1}>
              {item.filename}
            </Text>
          </Card>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  list: { paddingVertical: spacing.lg, gap: spacing.md },
  column: { gap: spacing.md },
  tile: { flex: 1, padding: spacing.sm, gap: spacing.sm },
  thumb: {
    aspectRatio: 1,
    borderRadius: radii.sm,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbIcon: { fontSize: 24, color: colors.textFaint },
  duration: {
    position: 'absolute',
    right: spacing.xs,
    bottom: spacing.xs,
    backgroundColor: colors.overlay,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.sm,
  },
  permissionCard: { gap: spacing.md, marginTop: spacing.xl },
  permissionBody: { lineHeight: 19 },
  limitedCard: { gap: spacing.sm, marginBottom: spacing.md },
  footer: { paddingVertical: spacing.lg },
});
