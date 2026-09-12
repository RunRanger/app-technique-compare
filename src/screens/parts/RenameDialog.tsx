/**
 * Naming dialog, used when saving to the collection and when renaming.
 *
 * A modal rather than `Alert.prompt`, which exists only on iOS.
 */

import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, TextInput, View } from 'react-native';

import { Button, Text } from '@/components/ui';
import { colors, radii, spacing, typography } from '@/theme';

interface RenameDialogProps {
  visible: boolean;
  title: string;
  initialValue: string;
  placeholder?: string;
  submitLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function RenameDialog({
  visible,
  title,
  initialValue,
  placeholder = 'e.g. Vault — comp 2025',
  submitLabel = 'Save',
  onSubmit,
  onCancel,
}: RenameDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [wasVisible, setWasVisible] = useState(visible);

  // Reset whenever the dialog reopens, so it never shows the previous subject.
  // Adjusted during render rather than in an effect: React re-renders this
  // component before painting, so the field never flashes the stale value.
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setValue(initialValue);
  }

  const trimmed = value.trim();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.dialog}>
          <Text variant="heading">{title}</Text>
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            maxLength={80}
            onSubmitEditing={() => trimmed && onSubmit(trimmed)}
          />
          <View style={styles.actions}>
            <Button label="Cancel" variant="ghost" onPress={onCancel} style={styles.action} />
            <Button
              label={submitLabel}
              onPress={() => onSubmit(trimmed)}
              disabled={trimmed.length === 0}
              style={styles.action}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  input: {
    ...typography.body,
    color: colors.text,
    backgroundColor: colors.background,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 48,
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
});
