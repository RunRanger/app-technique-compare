import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { colors, radii, spacing } from '@/theme';

interface CardProps {
  children: ReactNode;
  onPress?: () => void;
  /** Left accent stripe — used to tie a card to a clip's identity colour. */
  accent?: string;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

export function Card({ children, onPress, accent, style, accessibilityLabel }: CardProps) {
  const content = (
    <View style={[styles.card, accent ? { borderLeftColor: accent, borderLeftWidth: 3 } : null, style]}>
      {children}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => (pressed ? styles.pressed : undefined)}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  pressed: { opacity: 0.75 },
});
