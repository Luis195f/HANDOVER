import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { BarCodeScanner } from 'expo-barcode-scanner';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '@/src/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'QRScan'>;

export default function QRScan({ navigation, route }: Props) {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await BarCodeScanner.requestPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  const extractPatientId = useCallback((payload: string): string | null => {
    try {
      const obj = JSON.parse(payload);
      if (obj?.resourceType === 'Patient' && obj.id) return String(obj.id);
      const ref = obj?.patient?.reference ?? obj?.subject?.reference;
      const matchedRef = typeof ref === 'string' ? ref.match(/Patient\/([\w\-.]+)/) : null;
      if (matchedRef) return matchedRef[1];
    } catch (error) {
      // Ignored: payload is not JSON or parsing failed.
    }

    const match = payload.match(/Patient\/([\w\-.]+)/);
    if (match) return match[1];

    if (/^[A-Za-z0-9.\-]+$/.test(payload)) return payload;
    return null;
  }, []);

  const onScan = ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    const patientId = extractPatientId(data);
    if (!patientId) {
      Alert.alert('QR no válido', 'No se pudo obtener un Patient.id');
      setScanned(false);
      return;
    }
    const target = route.params?.returnTo ?? 'HandoverForm';
    navigation.navigate(target, { patientId, unitId: '', specialtyId: '' });
  };

  if (hasPermission === null) {
    return (
      <View style={styles.center}>
        <Text>Solicitando permiso…</Text>
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View style={styles.center}>
        <Text>Permiso de cámara denegado</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <BarCodeScanner style={styles.scanner} onBarCodeScanned={scanned ? undefined : onScan} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scanner: { flex: 1 },
});
