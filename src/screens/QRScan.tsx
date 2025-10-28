// src/screens/QRScan.tsx
import React, { useState } from 'react';
import { Alert, Button, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '@/src/navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'QRScan'>;

export default function QRScan({ navigation, route }: Props) {
  const [value, setValue] = useState('');
  const returnTo = route.params?.returnTo ?? 'HandoverForm';

  const onDone = (id: string) => {
    const trimmed = id.trim();
    if (!trimmed) {
      Alert.alert('Escaneo', 'Ingresa o simula un ID de paciente válido.');
      return;
    }
    // Vuelve a la pantalla objetivo con el patientId
    navigation.navigate(returnTo as any, { patientId: trimmed } as any);
  };

  return (
    <View style={{ flex: 1, padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 18, fontWeight: '600' }}>Escanear código (modo demo)</Text>
      <Text style={{ color: '#666' }}>
        Por ahora sin cámara: pega/escribe el ID del paciente y confirma. (Cámara se puede activar luego.)
      </Text>

      <TextInput
        placeholder="ej: pat-001"
        value={value}
        onChangeText={setValue}
        style={{ borderWidth: 1, borderColor: '#ccc', padding: 12, borderRadius: 8 }}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Button title="Aceptar" onPress={() => onDone(value)} />
      <Button title="Probar con pat-001" onPress={() => onDone('pat-001')} />
    </View>
  );
}
