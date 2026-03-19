import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { PriorityLevel } from '@/src/lib/priority';
import { useThemeTokens } from '@/src/theme';

const LEVEL_LABELS: Record<PriorityLevel, string> = {
  critical: 'Prioridad crítica',
  high: 'Prioridad alta',
  medium: 'Prioridad media',
  low: 'Prioridad baja',
};

function getPriorityColors(level: PriorityLevel, fallbackText: string) {
  switch (level) {
    case 'critical':
      return { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5', textColor: '#991B1B' };
    case 'high':
      return { backgroundColor: '#FFF7ED', borderColor: '#FCD34D', textColor: '#9A3412' };
    case 'medium':
      return { backgroundColor: '#EFF6FF', borderColor: '#93C5FD', textColor: '#1D4ED8' };
    case 'low':
    default:
      return { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0', textColor: fallbackText };
  }
}

export function PriorityBadge({ level, testID }: { level: PriorityLevel; testID?: string }) {
  const { colors } = useThemeTokens();
  const tone = getPriorityColors(level, colors.success);

  return (
    <View
      accessibilityLabel={LEVEL_LABELS[level]}
      style={[
        styles.badge,
        {
          backgroundColor: tone.backgroundColor,
          borderColor: tone.borderColor,
        },
      ]}
      testID={testID}
    >
      <Text style={[styles.label, { color: tone.textColor }]}>{LEVEL_LABELS[level]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
  },
});

export default PriorityBadge;
