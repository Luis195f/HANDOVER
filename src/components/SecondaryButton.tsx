import React from 'react';
import { Pressable, StyleSheet, Text, ViewStyle } from 'react-native';

import { useThemeTokens } from '../theme';

export type SecondaryButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: ViewStyle;
};

export function SecondaryButton({
  label,
  onPress,
  disabled = false,
  testID,
  accessibilityLabel,
  accessibilityHint,
  style,
}: SecondaryButtonProps) {
  const { colors, fontSizes, radius } = useThemeTokens();

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        {
          borderColor: colors.border,
          borderRadius: radius.sm,
          backgroundColor: colors.surface,
        },
        pressed && styles.buttonPressed,
        disabled && styles.buttonDisabled,
        style,
      ]}
    >
      <Text allowFontScaling style={[styles.label, { fontSize: fontSizes.base, color: colors.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  label: {
    fontWeight: '600',
  },
});
