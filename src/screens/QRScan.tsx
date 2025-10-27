import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '@/src/navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'QRScan'>;

type ScanResult = { data: string };

export default function QRScan({ navigation, route }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const ensurePermission = async () => {
      if (!permission) {
        if (hasPermission !== null) return;
        const result = await requestPermission();
        if (!cancelled) {
          setHasPermission(result?.granted ?? false);
        }
        return;
      }

      if (!cancelled) {
        setHasPermission(permission.granted);
      }
    };

    void ensurePermission();

    return () => {
      cancelled = true;
    };
  }, [hasPermission, permission, requestPermission]);

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

  const onScan = ({ data }: ScanResult) => {
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
      <CameraView
        style={styles.scanner}
        facing="back"
        onBarcodeScanned={scanned ? undefined : onScan}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scanner: { flex: 1 },
});
