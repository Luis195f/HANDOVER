import React, { useEffect, useState, useCallback } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useIsFocused } from '@react-navigation/native';

export default function QRScan() {
  const [perm, requestPerm] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const isFocused = useIsFocused();

  // Pide permisos al montar
  useEffect(() => {
    if (!perm?.granted) requestPerm();
  }, [perm, requestPerm]);

  // Cuando la pantalla vuelve a estar enfocada, habilita el escaneo otra vez
  useEffect(() => {
    if (isFocused) setScanned(false);
  }, [isFocused]);

  const onScanned = useCallback(({ data }: { data: string }) => {
    setScanned(true);
    // TODO: maneja tu QR aquí
    Alert.alert('QR leído', data, [{ text: 'OK', onPress: () => setScanned(false) }]);
  }, []);

  if (!perm?.granted) return <View style={styles.container} />;

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        // Solo QR. Puedes añadir otros tipos si lo necesitas
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={scanned ? undefined : onScanned}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
});
