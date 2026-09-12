import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme';

interface ScreenProps {
  children: ReactNode;
  /** Remove horizontal padding — for full-bleed video surfaces. */
  bleed?: boolean;
  edges?: readonly Edge[];
  style?: ViewStyle;
}

export function Screen({ children, bleed = false, edges = ['top', 'bottom'], style }: ScreenProps) {
  return (
    <SafeAreaView style={styles.safe} edges={edges}>
      <View style={[styles.body, !bleed && styles.padded, style]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1 },
  padded: { paddingHorizontal: spacing.lg },
});
