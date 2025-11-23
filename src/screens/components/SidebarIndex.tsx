import React, { useCallback } from 'react';
import { Pressable, ScrollView as RNScrollView, StyleSheet, Text, View } from 'react-native';
import type { ScrollView } from 'react-native';

export interface SectionInfo {
  key: string;
  title: string;
}

interface SidebarIndexProps {
  sectionsInfo: readonly SectionInfo[];
  sectionPositions: Partial<Record<string, number>>;
  scrollRef: React.RefObject<ScrollView>;
  activeSection?: string | null;
  isTablet: boolean;
  onSelect: (key: string) => void;
}

export const SidebarIndex: React.FC<SidebarIndexProps> = ({
  sectionsInfo,
  sectionPositions,
  scrollRef,
  activeSection,
  isTablet,
  onSelect,
}) => {
  const handlePress = useCallback(
    (key: string) => {
      const y = sectionPositions[key];
      onSelect(key);
      if (typeof y !== 'number') return;

      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ y, animated: true });
      });
    },
    [onSelect, scrollRef, sectionPositions],
  );

  if (isTablet) {
    return (
      <View style={styles.sidebarContainer} pointerEvents="box-none">
        <View style={styles.sidebarInner}>
          {sectionsInfo.map(({ key, title }) => {
            const isActive = activeSection === key;
            return (
              <Pressable
                key={key}
                onPress={() => handlePress(key)}
                style={[styles.sidebarItem, isActive && styles.sidebarItemActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
              >
                <Text style={[styles.sidebarText, isActive && styles.sidebarTextActive]}>{title}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  }

  return (
    <RNScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipsContainer}
      style={styles.chipsWrapper}
    >
      {sectionsInfo.map(({ key, title }) => {
        const isActive = activeSection === key;
        return (
          <Pressable
            key={key}
            onPress={() => handlePress(key)}
            style={[styles.chip, isActive && styles.chipActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
          >
            <Text style={[styles.chipText, isActive && styles.chipTextActive]}>{title}</Text>
          </Pressable>
        );
      })}
    </RNScrollView>
  );
};

const styles = StyleSheet.create({
  sidebarContainer: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 104,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  sidebarInner: {
    backgroundColor: '#F8FAFF',
    borderColor: '#CBD5F5',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 8,
    gap: 4,
  },
  sidebarItem: {
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  sidebarItemActive: {
    backgroundColor: '#E0E7FF',
    borderColor: '#2563EB',
    borderWidth: 1,
  },
  sidebarText: {
    fontSize: 14,
    color: '#4B5563',
    textAlign: 'center',
  },
  sidebarTextActive: {
    color: '#2563EB',
    fontWeight: '700',
  },
  chipsWrapper: {
    marginBottom: 12,
  },
  chipsContainer: {
    paddingHorizontal: 8,
    gap: 8,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#F8FAFF',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#CBD5F5',
    marginRight: 8,
  },
  chipActive: {
    backgroundColor: '#E0E7FF',
    borderColor: '#2563EB',
  },
  chipText: {
    color: '#4B5563',
    fontSize: 14,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#2563EB',
  },
});

