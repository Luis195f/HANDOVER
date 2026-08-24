import React, { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  DEMO_ACTORS,
  getDemoActorIdentity,
  type DemoActorId,
} from '@/src/demo/fixtures';
import { isDemoActorSwitchEnabled } from '@/src/security/demo-access';
import type { HandoverSession } from '@/src/security/auth-types';

// BEGIN HANDOVER: DEMO_MODE
interface Props {
  session: HandoverSession | null;
  onExit?: () => void;
  onSwitchActor?: (userId: DemoActorId) => Promise<unknown> | void;
}

export function DemoModeBanner({ session, onExit, onSwitchActor }: Props) {
  const [switching, setSwitching] = useState(false);

  if (session?.mode !== 'demo') return null;

  const activeActor = getDemoActorIdentity(session.userId);
  const targetActor = activeActor
    ? DEMO_ACTORS.find((actor) => actor.userId !== activeActor.userId) ?? null
    : null;
  const canSwitch = Boolean(
    activeActor && targetActor && onSwitchActor && isDemoActorSwitchEnabled(session),
  );

  const handleSwitch = async () => {
    if (!canSwitch || !targetActor || !onSwitchActor || switching) return;
    setSwitching(true);
    try {
      await onSwitchActor(targetActor.userId);
    } catch {
      Alert.alert('Cambio de actor demo no disponible', 'La identidad demo activa no pudo cambiarse.');
    } finally {
      setSwitching(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.identity}>
        <Text style={styles.label} accessibilityLabel="Modo demo activo">
          Modo demo - datos ficticios
        </Text>
        <Text style={styles.actor} testID="demo-active-actor">
          Actor activo: {activeActor?.displayName ?? session.displayName ?? session.userId}
        </Text>
      </View>
      {canSwitch ? (
        <Pressable
          onPress={() => void handleSwitch()}
          accessibilityRole="button"
          accessibilityLabel={`Cambiar a ${targetActor?.displayName ?? 'otro actor demo'}`}
          disabled={switching}
          testID="demo-switch-actor"
        >
          {switching ? (
            <ActivityIndicator color="#f0f4f8" />
          ) : (
            <Text style={styles.switchActor}>Cambiar a {targetActor?.displayName}</Text>
          )}
        </Pressable>
      ) : null}
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
    gap: 12,
  },
  identity: { flex: 1 },
  label: {
    color: '#f0f4f8',
    fontWeight: '600',
  },
  actor: {
    color: '#d9e2ec',
    marginTop: 2,
  },
  switchActor: {
    color: '#f0f4f8',
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  exit: {
    color: '#9fb3c8',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
// END HANDOVER: DEMO_MODE
