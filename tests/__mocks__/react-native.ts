// tests/__mocks__/react-native.ts
// Mock simplificado y estable de react-native para Vitest en entorno Node.

import React from 'react';

export type ViewStyle = Record<string, unknown>;
export type TextStyle = Record<string, unknown>;
export type ImageStyle = Record<string, unknown>;

type Style = ViewStyle | TextStyle | ImageStyle;
type StyleProp = Style | Style[] | null | undefined;

// -----------------------------------------------------------------------------
// StyleSheet
// -----------------------------------------------------------------------------
export const StyleSheet = {
  create<T extends Record<string, Style | StyleProp>>(styles: T): T {
    return styles;
  },
  flatten(input?: StyleProp | StyleProp[]): Style | undefined {
    if (!input) return undefined;
    const arr = Array.isArray(input) ? input : [input];
    return Object.assign({}, ...arr.filter(Boolean));
  },
};

// -----------------------------------------------------------------------------
// Platform
// -----------------------------------------------------------------------------
export const Platform = {
  OS: 'ios' as const,
  select<T>(configs: { ios?: T; android?: T; default?: T }): T | undefined {
    return configs.ios ?? configs.default;
  },
};

// -----------------------------------------------------------------------------
// Dimensions + useWindowDimensions
// -----------------------------------------------------------------------------
export const Dimensions = {
  get: (_dim: 'window' | 'screen') => ({
    width: 1024,
    height: 768,
    scale: 2,
    fontScale: 2,
  }),
};

// Hook que usa HandoverForm: debe ser una función
export function useWindowDimensions() {
  return Dimensions.get('window');
}

// -----------------------------------------------------------------------------
// Utilidades varias
// -----------------------------------------------------------------------------
export const Alert = {
  alert: (...args: unknown[]) => {
    // eslint-disable-next-line no-console
    console.warn('Alert.alert called with:', ...args);
  },
};

export const useColorScheme = () => 'light' as const;

// -----------------------------------------------------------------------------
// Props base
// -----------------------------------------------------------------------------
export type RNProps = {
  children?: React.ReactNode;
  style?: StyleProp;
  onPress?: () => void;
  onLayout?: () => void;
  testID?: string;
};

// Factoría de componentes "primitivos"
function createPrimitive(name: string) {
  const Comp: React.FC<RNProps> = ({ children, ...props }) =>
    React.createElement(name, props, children);
  Comp.displayName = name;
  return Comp;
}

// -----------------------------------------------------------------------------
// Componentes básicos
// -----------------------------------------------------------------------------
export const View = createPrimitive('View');
export const Text = createPrimitive('Text');
export const ScrollView = createPrimitive('ScrollView');
export const SafeAreaView = createPrimitive('SafeAreaView');
export const ActivityIndicator = createPrimitive('ActivityIndicator');
export interface ModalProps extends RNProps {
  visible?: boolean;
  onRequestClose?: () => void;
  transparent?: boolean;
  animationType?: 'none' | 'slide' | 'fade';
}

export const Modal: React.FC<ModalProps> = ({ visible = true, children, ...props }) =>
  visible ? React.createElement('Modal', props, children) : null;

// -----------------------------------------------------------------------------
// TextInput
// -----------------------------------------------------------------------------
export interface TextInputProps extends RNProps {
  value?: string;
  onChangeText?: (text: string) => void;
  secureTextEntry?: boolean;
  placeholder?: string;
}

export const TextInput: React.FC<TextInputProps> = ({
  value = '',
  onChangeText,
  ...props
}) =>
  React.createElement('TextInput', {
    ...props,
    value,
    onChange: (event: any) =>
      onChangeText?.(event?.target?.value ?? ''),
  });
TextInput.displayName = 'TextInput';

// -----------------------------------------------------------------------------
// Pressable
// -----------------------------------------------------------------------------
export const Pressable: React.FC<RNProps> = ({
  children,
  onPress,
  ...props
}) =>
  React.createElement('Pressable', { ...props, onClick: onPress }, children);
Pressable.displayName = 'Pressable';

// -----------------------------------------------------------------------------
// Switch
// -----------------------------------------------------------------------------
export interface SwitchProps extends RNProps {
  value?: boolean;
  onValueChange?: (value: boolean) => void;
}

export const Switch: React.FC<SwitchProps> = ({
  value = false,
  onValueChange,
  ...props
}) =>
  React.createElement('Switch', {
    ...props,
    value,
    onValueChange,
    onChange: () => onValueChange?.(!value),
  });
Switch.displayName = 'Switch';

// -----------------------------------------------------------------------------
// Button
// -----------------------------------------------------------------------------
export interface ButtonProps extends RNProps {
  title?: string;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  title,
  onPress,
  ...props
}) =>
  React.createElement(
    'Button',
    { ...props, onClick: onPress },
    children ?? title ?? null,
  );
Button.displayName = 'Button';

// -----------------------------------------------------------------------------
// FlatList
// -----------------------------------------------------------------------------
export interface FlatListProps<Item> extends RNProps {
  data: Item[];
  renderItem: (info: { item: Item; index: number }) => React.ReactElement | null;
  keyExtractor?: (item: Item, index: number) => string;
}

export function FlatList<Item>({
  data,
  renderItem,
  keyExtractor,
  ...props
}: FlatListProps<Item>) {
  const children = data.map((item, index) => {
    const key = keyExtractor ? keyExtractor(item, index) : String(index);
    const element = renderItem({ item, index });
    return element ? React.cloneElement(element, { key }) : null;
  });

  return React.createElement('FlatList', props, children);
}
FlatList.displayName = 'FlatList';

// -----------------------------------------------------------------------------
// Default export (para import * as ReactNative / import RN from 'react-native')
// -----------------------------------------------------------------------------
const ReactNative = {
  StyleSheet,
  Platform,
  Dimensions,
  useWindowDimensions,
  View,
  Text,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
  Modal,
  TextInput,
  Pressable,
  FlatList,
  Switch,
  Button,
  Alert,
  useColorScheme,
};

export default ReactNative;
