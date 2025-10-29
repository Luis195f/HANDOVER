// src/screens/QRScan.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { BarCodeScanner } from 'expo-barcode-scanner';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import type { RootStackParamList } from '@/src/navigation/RootNavigator';

type Props = NativeStackScreenProps<RootStackParamList, 'QRScan'>;

export default function QRScan({ navigation }: Props) {
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);
  const isFocused = useIsFocused();

  useEffect(() => {
    BarCodeScanner.requestPermissionsAsync().then(({ status }) => {
      setHasPermission(status === 'granted');
    });
  }, []);

  useEffect(() => {
    if (!isFocused) {
      setScanned(false);
    }
  }, [isFocused]);

  const onBarCodeScanned = useCallback(
    ({ data }: { data: string }) => {
      if (scanned) {
        return;
      }

      setScanned(true);

      try {
        let patientIdParam: string | undefined;
        let unitIdParam: string | undefined;
        let specialtyId: string | undefined;

        if (/^Patient\/[\w\-.]+$/i.test(data)) {
          patientIdParam = data.split('/')[1];
        } else {
          try {
            const parsed = JSON.parse(data);
            patientIdParam = parsed?.id ?? parsed?.patient?.id ?? undefined;
            unitIdParam = parsed?.unitId ?? parsed?.context?.unitId ?? undefined;
            specialtyId = parsed?.specialtyId ?? parsed?.context?.specialtyId ?? undefined;
          } catch (error) {
            patientIdParam = data;
          }
        }

        if (!patientIdParam) {
          Alert.alert('QR no válido', 'No se detectó un ID de paciente en el código.');
          setScanned(false);
          return;
        }

        navigation.navigate('HandoverForm', { patientIdParam, unitIdParam, specialtyId });
      } catch (error) {
        console.error(error);
        Alert.alert('Error', 'No se pudo procesar el QR.');
        setScanned(false);
      }
    },
    [navigation, scanned],
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

