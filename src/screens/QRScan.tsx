// src/screens/QRScan.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import {
  CameraView,
  useCameraPermissions,
  type BarcodeScanningResult,
} from 'expo-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';

// Ajusta este nombre de ruta si en tu RootNavigator usas otro (por ejemplo "QRScan")
type Props = NativeStackScreenProps<RootStackParamList, 'QRScan'>;

export function QRScanScreen({ navigation }: Props) {
  const isFocused = useIsFocused();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  // Pedir permisos de cámara al entrar
  useEffect(() => {
    if (!permission) {
      requestPermission();
    }
  }, [permission, requestPermission]);

  // Al salir de la pantalla, reseteamos el estado de escaneo
  useEffect(() => {
    if (!isFocused && scanned) {
      setScanned(false);
    }
  }, [isFocused, scanned]);

  const handleBarcodeScanned = useCallback(
    (result: BarcodeScanningResult) => {
      if (scanned) return; // evita doble disparo

      setScanned(true);

      const data = result.data?.trim();
      if (!data) {
        Alert.alert('Código no válido', 'No se pudo leer el código QR.');
        setScanned(false);
        return;
      }

      // Aquí decides qué hacer con el contenido del QR.
      // Ejemplo: asumir que el QR lleva un patientId y navegar al dashboard:
      navigation.navigate('PatientDashboard', { patientId: data });
    },
    [navigation, scanned],
  );

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.text}>Solicitando permisos de cámara…</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>
          Necesitamos acceso a la cámara para escanear el código QR del paciente.
        </Text>
        <Text style={styles.link} onPress={requestPermission}>
          Toca aquí para volver a solicitar permisos
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Sólo montamos la cámara cuando la pantalla está enfocada */}
      {isFocused && (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          onBarcodeScanned={handleBarcodeScanned}
          barcodeScannerSettings={{
            barcodeTypes: ['qr'],
          }}
        />
      )}

      {/* Overlay con instrucciones */}
      <View style={styles.overlay}>
        <Text style={styles.title}>Escanea el código QR del paciente</Text>
        <Text style={styles.subtitle}>
          Centra el código dentro del recuadro. Se detectará automáticamente.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  text: {
    fontSize: 16,
    textAlign: 'center',
    color: '#111111',
  },
  link: {
    marginTop: 12,
    fontSize: 16,
    textAlign: 'center',
    textDecorationLine: 'underline',
    color: '#007AFF',
  },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 24,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#E5E5E5',
  },
});
