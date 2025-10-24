// @ts-nocheck
// src/components/Chip.tsx
import React from "react";
import {
  Pressable,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
  useColorScheme,
} from "react-native";

type Props = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
  textStyle?: TextStyle;
  disabled?: boolean;
  testID?: string;
};

const tokens = {
  light: {
    bg: "#E5E7EB",            // slate-200
    text: "#111827",          // gray-900
    border: "#CBD5E1",        // slate-300
    bgSelected: "#2563EB",    // blue-600
    textSelected: "#FFFFFF",  // white
  },
  dark: {
    bg: "#334155",            // slate-700
    text: "#E5E7EB",          // slate-200
    border: "#475569",        // slate-600
    bgSelected: "#1D4ED8",    // blue-700
    textSelected: "#FFFFFF",  // white
  },
};

export default function Chip({
  label,
  selected = false,
  onPress,
  style,
  textStyle,
  disabled,
  testID,
}: Props) {
  const scheme = useColorScheme();
  const pal = scheme === "dark" ? tokens.dark : tokens.light;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      onPress={disabled ? undefined : onPress}
      android_ripple={{ color: scheme === "dark" ? "#1E40AF" : "#93C5FD", borderless: false }}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: selected ? pal.bgSelected : pal.bg,
          borderColor: pal.border,
          opacity: pressed ? 0.9 : 1,
        },
        style,
      ]}
      testID={testID}
    >
      <Text
        style={[
          styles.text,
          { color: selected ? pal.textSelected : pal.text },
          textStyle,
        ]}
        numberOfLines={1}
        allowFontScaling
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingHorizontal: 12,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: "flex-start",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
    marginBottom: 8,
  },
  text: {
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
});
