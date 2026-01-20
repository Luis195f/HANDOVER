import React from 'react';
import { LayoutAnimation, Platform, Pressable, StyleSheet, Text, UIManager, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

import { useThemeTokens } from '../../theme';

// Enable performance logs by setting EXPO_PUBLIC_OBSERVABILITY_DEBUG=true (or in dev mode).
const isPerfObsEnabled = () => {
  const dev = typeof __DEV__ !== 'undefined' && __DEV__;
  const flag = process.env.EXPO_PUBLIC_OBSERVABILITY_DEBUG === 'true';
  return dev || flag;
};

type PerfObsCode =
  | 'PERF001_LAZY_FIRST_MOUNT'
  | 'PERF002_LAZY_SKIP_RENDER_COLLAPSED'
  | 'PERF003_HEAVY_UNMOUNT_ON_COLLAPSE'
  | 'PERF004_HEAVY_REMOUNT_ON_EXPAND'
  | 'PERF005_A11Y_WARN_GATED'
  | 'PERF006_ANDROID_ANIM_WARN_GATED';

const perfWarn = (code: PerfObsCode, meta?: Record<string, string | number | boolean>) => {
  if (!isPerfObsEnabled()) return;
  console.warn(`[HNDV][WARN][${code}]`, meta);
};

interface CollapsibleSectionProps {
  title: string;
  isCollapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  lazy?: boolean;
  unmountOnCollapse?: boolean;
  sectionKey?: string;
}

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  isCollapsed,
  onToggle,
  children,
  lazy = false,
  unmountOnCollapse = false,
  sectionKey,
}) => {
  const { colors, fontSizes, spacing, radius } = useThemeTokens();
  const titleLabel = typeof title === 'string' ? title.trim() : '';
  const safeTitle = titleLabel || 'Sección';
  const [hasEverOpened, setHasEverOpened] = React.useState(!isCollapsed);
  const initialCollapsedRef = React.useRef(isCollapsed);
  const previousCollapsedRef = React.useRef(isCollapsed);

  React.useEffect(() => {
    if (Platform.OS === 'android') {
      if (UIManager.setLayoutAnimationEnabledExperimental) {
        UIManager.setLayoutAnimationEnabledExperimental(true);
      } else {
        if (isPerfObsEnabled()) {
          perfWarn('PERF006_ANDROID_ANIM_WARN_GATED', { sectionKey: sectionKey ?? 'unknown' });
        }
      }
    }
  }, [sectionKey]);

  if (!titleLabel) {
    if (isPerfObsEnabled()) {
      perfWarn('PERF005_A11Y_WARN_GATED', { sectionKey: sectionKey ?? 'unknown' });
    }
  }

  React.useEffect(() => {
    if (lazy && initialCollapsedRef.current) {
      perfWarn('PERF002_LAZY_SKIP_RENDER_COLLAPSED', { sectionKey: sectionKey ?? 'unknown', lazy: true });
    }
  }, [lazy, sectionKey]);

  React.useEffect(() => {
    if (lazy && !isCollapsed && !hasEverOpened) {
      setHasEverOpened(true);
      perfWarn('PERF001_LAZY_FIRST_MOUNT', { sectionKey: sectionKey ?? 'unknown' });
    }
  }, [hasEverOpened, isCollapsed, lazy, sectionKey]);

  React.useEffect(() => {
    if (!unmountOnCollapse || previousCollapsedRef.current === isCollapsed) {
      previousCollapsedRef.current = isCollapsed;
      return;
    }

    if (isCollapsed) {
      perfWarn('PERF003_HEAVY_UNMOUNT_ON_COLLAPSE', { sectionKey: sectionKey ?? 'unknown' });
    } else {
      perfWarn('PERF004_HEAVY_REMOUNT_ON_EXPAND', { sectionKey: sectionKey ?? 'unknown' });
    }

    previousCollapsedRef.current = isCollapsed;
  }, [isCollapsed, sectionKey, unmountOnCollapse]);

  const handleToggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onToggle();
  };

  const shouldRenderChildren = unmountOnCollapse
    ? !isCollapsed
    : lazy
      ? hasEverOpened || !isCollapsed
      : !isCollapsed;

  const showContent = !isCollapsed;

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
      {shouldRenderChildren && (
        <View
          style={[
            styles.content,
            { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, paddingTop: spacing.xs },
            !showContent && styles.contentCollapsed,
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
  contentCollapsed: {
    height: 0,
    opacity: 0,
    paddingTop: 0,
    paddingBottom: 0,
    paddingHorizontal: 0,
    overflow: 'hidden',
  },
});
