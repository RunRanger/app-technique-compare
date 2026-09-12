/**
 * Review a fresh recording: retake, use it now, or save it to the collection.
 *
 * "Use for comparison" works on the temporary file directly — a comparison you
 * are about to throw away should not force a write to the user's library.
 * "Save to collection" is the deliberate act that copies it into the library and
 * stores a persistent id.
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

import { Button, Screen, Text } from '@/components/ui';
import type { RootScreenProps } from '@/navigation/types';
import {
  discardTemporaryRecording,
  ensureMediaWritePermission,
  saveRecordingToLibrary,
} from '@/services/media';
import { useCollectionStore } from '@/state/collectionStore';
import { useSessionStore } from '@/state/sessionStore';
import { colors, radii, spacing } from '@/theme';
import { EMPTY_META, type VideoMeta } from '@/types';

import { RenameDialog } from './parts/RenameDialog';

const ALBUM_NAME = 'Technique Compare';

export function RecordPreviewScreen({ navigation, route }: RootScreenProps<'RecordPreview'>) {
  const { slot, uri } = route.params;

  const setClip = useSessionStore((state) => state.setClip);
  const addToCollection = useCollectionStore((state) => state.add);

  const [meta, setMeta] = useState<VideoMeta>(EMPTY_META);
  const [naming, setNaming] = useState(false);
  const [saving, setSaving] = useState(false);

  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
    instance.muted = false;
    instance.play();
  });

  // Pick up duration and frame rate for the session and the collection entry.
  useEffect(() => {
    const subscription = player.addListener('sourceLoad', (payload) => {
      const track = payload.availableVideoTracks?.[0] ?? null;
      setMeta({
        durationSeconds: payload.duration ?? null,
        fps: track?.frameRate ?? null,
        width: track?.size?.width ?? null,
        height: track?.size?.height ?? null,
      });
    });
    return () => subscription.remove();
  }, [player]);

  const retake = useCallback(() => {
    void discardTemporaryRecording(uri);
    navigation.replace('Record', { slot });
  }, [navigation, slot, uri]);

  const useForComparison = useCallback(() => {
    setClip(slot, {
      ref: { kind: 'file', id: uri },
      uri,
      name: 'Recording',
      meta,
    });
    navigation.navigate('Home');
  }, [meta, navigation, setClip, slot, uri]);

  const saveToCollection = useCallback(
    async (name: string) => {
      setNaming(false);
      setSaving(true);
      try {
        if (!(await ensureMediaWritePermission())) {
          Alert.alert(
            'Permission needed',
            'Saving to your collection stores the video in your library, which needs permission.'
          );
          return;
        }

        const saved = await saveRecordingToLibrary(uri, ALBUM_NAME);
        const mergedMeta: VideoMeta = {
          // The library reports dimensions and duration; only the player knows fps.
          ...saved.meta,
          fps: meta.fps ?? saved.meta.fps,
        };

        const item = addToCollection({ name, ref: saved.ref, meta: mergedMeta });
        setClip(slot, {
          ref: saved.ref,
          uri,
          name: item.name,
          meta: mergedMeta,
          collectionItemId: item.id,
        });
        navigation.navigate('Home');
      } catch (error) {
        Alert.alert('Could not save', String(error));
      } finally {
        setSaving(false);
      }
    },
    [addToCollection, meta.fps, navigation, setClip, slot, uri]
  );

  return (
    <Screen>
      <View style={styles.stage}>
        <VideoView
          player={player}
          style={styles.video}
          contentFit="contain"
          nativeControls
          allowsPictureInPicture={false}
        />
      </View>

      <View style={styles.info}>
        <Text variant="heading">How does it look?</Text>
        <Text variant="caption" muted>
          {describeMeta(meta)}
        </Text>
      </View>

      <View style={styles.actions}>
        <Button
          label="Save to collection"
          icon="★"
          block
          loading={saving}
          onPress={() => setNaming(true)}
        />
        <Button label="Use for comparison" variant="secondary" block onPress={useForComparison} />
        <Button label="Retake" variant="ghost" block onPress={retake} />
      </View>

      <RenameDialog
        visible={naming}
        title="Name this clip"
        initialValue=""
        submitLabel="Save"
        onCancel={() => setNaming(false)}
        onSubmit={(name) => void saveToCollection(name)}
      />
    </Screen>
  );
}

function describeMeta(meta: VideoMeta): string {
  const parts: string[] = [];
  if (meta.durationSeconds != null) parts.push(`${meta.durationSeconds.toFixed(1)} s`);
  if (meta.width && meta.height) parts.push(`${meta.width}×${meta.height}`);
  if (meta.fps) parts.push(`${Math.round(meta.fps)} fps`);
  return parts.length > 0 ? parts.join(' · ') : 'Reading video details…';
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    marginVertical: spacing.lg,
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: colors.border,
  },
  video: { flex: 1 },
  info: { gap: spacing.xs, paddingBottom: spacing.lg },
  actions: { gap: spacing.sm, paddingBottom: spacing.lg },
});
