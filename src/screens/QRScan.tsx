// src/screens/QRScan.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { BarCodeScanner } from 'expo-barcode-scanner';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '@/src/navigation/RootNavigator';
import { handleScanResult } from '@/src/screens/qrScan.utils';

type Props = NativeStackScreenProps<RootStackParamList, 'QRScan'>;
type ScanResult = { data: string };

export default function QRScan({ navigation, route }: Props) {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  const isFocused = useIsFocused();
  const unitIdParam = route.params?.unitIdParam;
  const specialtyId = route.params?.specialtyId;

  useEffect(() => {
    (async () => {
      const { status } = await BarCodeScanner.requestPermissionsAsync();
      setHasPermission(status === 'granted');
    })();
  }, []);

  useEffect(() => {
    if (!isFocused) {
      setScanned(false);
    }
  }, [isFocused]);

  const onBarCodeScanned = useCallback(
    (result: ScanResult) => {
      if (scanned) {
        return;
      }

      setScanned(true);

      handleScanResult({
        data: result.data,
        navigate: (patientId) => {
          navigation.navigate('HandoverForm', {
            patientIdParam: patientId,
            unitIdParam,
            specialtyId,
            patientId,
            unitId: unitIdParam,
          });
        },
        onUnrecognized: () => {
          Alert.alert(
            'QR no reconocido',
            'No se pudo extraer un Patient ID válido. Intenta nuevamente.',
          );
          setScanned(false);
        },
      });
    },
    [navigation, scanned, specialtyId, unitIdParam],
  );

  if (hasPermission === null) {
    return (
      <View style={styles.center}>
        <Text>Solicitando permisos…</Text>
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View style={styles.center}>
        <Text>Sin permiso de cámara</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {isFocused && (
        <BarCodeScanner onBarCodeScanned={onBarCodeScanned} style={StyleSheet.absoluteFillObject} />
      )}
      <View style={styles.overlay}>
        <Text style={styles.hint}>Apunta al QR/CB del paciente</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  overlay: {
    position: 'absolute',
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  hint: {
    backgroundColor: 'rgba(0,0,0,0.6)',
    color: 'white',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});

