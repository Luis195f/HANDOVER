import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useThemeTokens } from '../theme';

export type SectionCardProps = {
  title: string;
  children: React.ReactNode;
  accessibilityLabel?: string;
};

export function SectionCard({ title, children, accessibilityLabel }: SectionCardProps) {
  const { colors, fontSizes, radius, spacing } = useThemeTokens();

  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md }]}
      accessibilityRole="summary"
      accessibilityLabel={accessibilityLabel ?? title}
    >
      <Text
        accessibilityRole="header"
        allowFontScaling
        style={[styles.title, { color: colors.text, fontSize: fontSizes.lg }]}
      >
        {title}
      </Text>
      <View style={{ marginTop: spacing.sm }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
  },
  title: {
    fontWeight: '600',
  },
});
