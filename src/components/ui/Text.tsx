import { Text as RNText, StyleSheet, type TextProps as RNTextProps } from 'react-native';

import { colors, typography } from '@/theme';

type Variant = keyof typeof typography;

interface TextProps extends RNTextProps {
  variant?: Variant;
  muted?: boolean;
  faint?: boolean;
  color?: string;
}

export function Text({ variant = 'body', muted, faint, color, style, ...rest }: TextProps) {
  return (
    <RNText
      {...rest}
      style={[
        styles.base,
        typography[variant] as object,
        muted && { color: colors.textMuted },
        faint && { color: colors.textFaint },
        color ? { color } : null,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: { color: colors.text },
});
