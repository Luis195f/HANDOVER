import React from 'react';
import { LayoutAnimation, Platform, Pressable, StyleSheet, Text, UIManager, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import { useThemeTokens } from '../../theme';

interface CollapsibleSectionProps {
  title: string;
  isCollapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  isCollapsed,
  onToggle,
  children,
}) => {
  const { colors, fontSizes, spacing, radius } = useThemeTokens();
  const titleLabel = typeof title === 'string' ? title.trim() : '';
  const safeTitle = titleLabel || 'Sección';

  React.useEffect(() => {
    if (Platform.OS === 'android') {
      if (UIManager.setLayoutAnimationEnabledExperimental) {
        UIManager.setLayoutAnimationEnabledExperimental(true);
      } else {
        console.warn('[handover-ui] UI_COLLAPSIBLE_ANIMATION_DISABLED_ANDROID', {
          component: 'CollapsibleSection',
        });
      }
    }
  }, []);

  if (!titleLabel) {
    console.warn('[handover-ui] UI_A11Y_MISSING_LABEL', { component: 'CollapsibleSection' });
  }

  const handleToggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onToggle();
  };

  return (
    <View style={[styles.container, { borderRadius: radius.sm, borderColor: colors.border, backgroundColor: colors.background }]}>
      <Pressable
        onPress={handleToggle}
        style={[
          styles.header,
          {
            minHeight: 44,
            paddingVertical: spacing.md,
            paddingHorizontal: spacing.lg,
            borderRadius: radius.sm,
            borderColor: colors.border,
            backgroundColor: colors.surface,
          },
        ]}
        accessible
        accessibilityRole="button"
        accessibilityLabel={`Sección ${safeTitle}. ${isCollapsed ? 'Contraída' : 'Expandida'}.`}
        accessibilityHint="Doble toque para expandir o contraer"
        accessibilityState={{ expanded: !isCollapsed }}
      >
        <Text style={[styles.title, { color: colors.text, fontSize: fontSizes.lg }]}>{title}</Text>
        <MaterialIcons
          name={isCollapsed ? 'expand-more' : 'expand-less'}
          size={20}
          color={colors.primary}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </Pressable>
      {!isCollapsed && (
        <View
          style={[
            styles.content,
            { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, paddingTop: spacing.xs },
          ]}
        >
          {children}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
  },
  title: {
    fontWeight: '600',
  },
  content: {
    gap: 12,
  },
});
