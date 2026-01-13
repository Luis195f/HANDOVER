import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { useThemeTokens } from '../theme';

type BotonPrimarioProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
  accessibilityLabel?: string;
};

const UI_LOG_TAG = '[handover-ui]';

export default function BotonPrimario({
  label,
  onPress,
  disabled = false,
  testID,
  accessibilityLabel,
}: BotonPrimarioProps) {
  const { colors, fontSizes, radius } = useThemeTokens();
  const isValidLabel = typeof label === 'string' && label.trim().length > 0;

  if (!isValidLabel) {
    console.warn(`${UI_LOG_TAG} UI_A11Y_MISSING_LABEL`, { component: 'BotonPrimario' });
  }

  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: colors.primary, borderRadius: radius.sm },
        pressed && styles.buttonPressed,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text style={[styles.label, { fontSize: fontSizes.base }]}>{label}</Text>
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
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  label: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
