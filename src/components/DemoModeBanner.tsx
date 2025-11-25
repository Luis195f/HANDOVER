import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

// BEGIN HANDOVER: DEMO_MODE
interface Props {
  visible: boolean;
  onExit?: () => void;
}

export function DemoModeBanner({ visible, onExit }: Props) {
  if (!visible) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.label} accessibilityLabel="Modo demo activo">
        Modo demo – datos ficticios
      </Text>
      {onExit ? (
        <Pressable onPress={onExit} accessibilityRole="button" accessibilityLabel="Salir del modo demo">
          <Text style={styles.exit}>Salir del modo demo</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#102a43',
    paddingVertical: 8,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    color: '#f0f4f8',
    fontWeight: '600',
  },
  exit: {
    color: '#9fb3c8',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
// END HANDOVER: DEMO_MODE
