import React from 'react';

type RNProps = { children?: React.ReactNode } & Record<string, any>;

type ComponentFactory = (type: string) => React.FC<RNProps>;

const createPrimitive: ComponentFactory = (type) => {
  const Primitive: React.FC<RNProps> = ({ children, ...props }) =>
    React.createElement(type, props, children);
  Primitive.displayName = type;
  return Primitive;
};

export const Platform = {
  OS: 'test',
  select: (options: Record<string, unknown>) =>
    Object.prototype.hasOwnProperty.call(options, 'test') ? options.test : options.default,
};

export const StyleSheet = { create: <T extends Record<string, unknown>>(styles: T) => styles };

export const View = createPrimitive('View');
export const Text = createPrimitive('Text');
export const ScrollView = createPrimitive('ScrollView');
export const SafeAreaView = createPrimitive('SafeAreaView');
export const ActivityIndicator = createPrimitive('ActivityIndicator');

export const TextInput = React.forwardRef<any, RNProps>(({ onChangeText, ...props }, ref) =>
  React.createElement('TextInput', {
    ...props,
    ref,
    onChangeText,
  }, props.children)
);
TextInput.displayName = 'TextInput';

export const Pressable: React.FC<RNProps> = ({ children, onPress, ...props }) => {
  const resolvedChildren = typeof children === 'function' ? children({ pressed: false }) : children;
  return React.createElement('Pressable', { ...props, onPress }, resolvedChildren);
};
Pressable.displayName = 'Pressable';

export const Button: React.FC<RNProps & { title?: string }> = ({ children, title, onPress, ...props }) =>
  React.createElement('Button', { ...props, title, onPress }, children ?? title ?? null);
Button.displayName = 'Button';

export const Alert = {
  alert: (..._args: unknown[]) => undefined,
};

export const useColorScheme = () => 'light';

const ReactNative = {
  Platform,
  StyleSheet,
  View,
  Text,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
  TextInput,
  Pressable,
  Button,
  Alert,
  useColorScheme,
};

export default ReactNative;
