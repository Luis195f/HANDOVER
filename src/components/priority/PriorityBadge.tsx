import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTranslation } from '@/src/i18n';
import type { PriorityLevel } from '@/src/lib/priority';
import { useThemeTokens } from '@/src/theme';

const LEVEL_LABEL_KEYS: Record<PriorityLevel, string> = {
  critical: 'patientList.priorityCritical',
  high: 'patientList.priorityHigh',
  medium: 'patientList.priorityMedium',
  low: 'patientList.priorityLow',
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
  const { t } = useTranslation();
  const tone = getPriorityColors(level, colors.success);
  const label = t(LEVEL_LABEL_KEYS[level]);

  return (
    <View
      accessibilityLabel={label}
      style={[
        styles.badge,
        {
          backgroundColor: tone.backgroundColor,
          borderColor: tone.borderColor,
        },
      ]}
      testID={testID}
    >
      <Text style={[styles.label, { color: tone.textColor }]}>{label}</Text>
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
