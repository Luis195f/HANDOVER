// src/screens/LoginScreen.tsx
import React, { useMemo } from 'react';
import { View, Text, Pressable, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { login } from '@/src/security/auth';
import { UNITS_BY_ID } from '@/src/config/units';
import type { RootStackParamList } from '@/src/navigation/types';

type Nav = ReturnType<typeof useNavigation<import('@react-navigation/native-stack').NativeStackNavigationProp<RootStackParamList>>>

export default function LoginScreen() {
  const navigation = useNavigation() as Nav;

  // Todos los slugs de unidad disponibles en la app (demo con acceso total)
  const ALL_UNITS = useMemo(() => Object.keys(UNITS_BY_ID), []);

  const onLogin = async () => {
    try {
      await login({
        user: { id: 'nurse-1', name: 'Demo Nurse' },
        units: ALL_UNITS,          // acceso total para la demo
        allowedUnits: ALL_UNITS,   // redundante pero explícito
        token: 'mock-token',
      });

      // Ir a la lista (el Stack inicia ahí, pero navegamos por claridad)
      navigation.reset({
        index: 0,
        routes: [{ name: 'PatientList' }],
      });
    } catch (err: any) {
      Alert.alert('Error al iniciar', err?.message ?? String(err));
    }
  };

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 24,
      }}
    >
      <Text style={{ fontSize: 22, fontWeight: '600' }}>Acceder</Text>

      <Pressable
        onPress={onLogin}
        style={({ pressed }) => ({
          backgroundColor: pressed ? '#2a6af1' : '#2979ff',
          paddingHorizontal: 18,
          paddingVertical: 12,
          borderRadius: 12,
          elevation: 2,
        })}
      >
        <Text style={{ color: 'white', fontSize: 16, fontWeight: '600' }}>
          Entrar (demo, acceso a todas las unidades)
        </Text>
      </Pressable>

      <Text style={{ opacity: 0.7, textAlign: 'center' }}>
        Se otorga acceso a todas las unidades para evitar el diálogo “Sin acceso
        a la unidad” durante la demo.
      </Text>
    </View>
  );
}
