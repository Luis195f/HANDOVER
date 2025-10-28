// src/screens/LoginScreen.tsx
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { login, getSession } from '@/src/security/auth';
import { UNITS_BY_ID } from '@/src/config/units';

export default function LoginScreen() {
  const navigation = useNavigation<any>();

  const onPress = async () => {
    const ALL_UNITS = Object.keys(UNITS_BY_ID); // slugs válidos
    await login({
      user: { id: 'nurse-1', name: 'Demo Nurse', allowedUnits: ALL_UNITS },
      units: ALL_UNITS, // acceso total para demo
      token: 'mock-token',
    });

    const s = await getSession();
    console.log('[dev] session', s?.units, s?.user?.allowedUnits);
    (globalThis as any).__NURSEOS_SESSION_CACHE = s;

    navigation.reset({
      index: 0,
      routes: [{ name: 'PatientList' }],
    });
  };

  return (
    <View style={{ flex: 1, padding: 16, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 20, fontWeight: '600', marginBottom: 12 }}>Handover Pro</Text>
      <Pressable
        onPress={onPress}
        style={{ backgroundColor: '#1677ff', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 }}
      >
        <Text style={{ color: 'white', fontWeight: '600' }}>Entrar (demo)</Text>
      </Pressable>
    </View>
  );
}
