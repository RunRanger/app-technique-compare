import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { CollectionScreen } from '@/screens/CollectionScreen';
import { CompareScreen } from '@/screens/CompareScreen';
import { GalleryScreen } from '@/screens/GalleryScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { RecordPreviewScreen } from '@/screens/RecordPreviewScreen';
import { RecordScreen } from '@/screens/RecordScreen';
import { SyncScreen } from '@/screens/SyncScreen';
import { colors } from '@/theme';

import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { fontSize: 16, fontWeight: '600' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
        // Back-navigation preserves the session store, which is what makes the
        // "replace video 2, keep video 1" workflow work without extra plumbing.
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Technique Compare' }} />
      <Stack.Screen
        name="Collection"
        component={CollectionScreen}
        options={{ title: 'My collection' }}
      />
      <Stack.Screen name="Gallery" component={GalleryScreen} options={{ title: 'Choose a video' }} />
      <Stack.Screen name="Record" component={RecordScreen} options={{ title: 'Record' }} />
      <Stack.Screen
        name="RecordPreview"
        component={RecordPreviewScreen}
        options={{ title: 'Review', headerBackVisible: false }}
      />
      <Stack.Screen name="Sync" component={SyncScreen} options={{ title: 'Sync clips' }} />
      <Stack.Screen name="Compare" component={CompareScreen} options={{ title: 'Compare' }} />
    </Stack.Navigator>
  );
}
