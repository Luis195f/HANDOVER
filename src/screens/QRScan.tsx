// src/screens/QRScan.tsx
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

type ScannerMod = typeof import('expo-barcode-scanner');

export default function QRScan() {
  const isFocused = useIsFocused();
  const [scanner, setScanner] = useState<ScannerMod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [scanned, setScanned] = useState(false);

  // Carga dinámica del módulo para evitar resolución en tiempo de bundle
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const mod = await import('expo-barcode-scanner'); // <- no rompe Metro si no se ejecuta
        if (!mounted) return;
        setScanner(mod);
        const { status } = await mod.BarCodeScanner.requestPermissionsAsync();
        setHasPermission(status === 'granted');
      } catch (e) {
        setError(
          'Falta dependencia expo-barcode-scanner. Instala con: npx expo install expo-barcode-scanner'
        );
      }
    })();
    return () => { mounted = false; };
  }, []);

  const onScan = useCallback(({ data, type }: { data: string; type: string }) => {
    setScanned(true);
    Alert.alert('QR detectado', `Tipo: ${type}\nDato: ${data}`, [
      { text: 'OK', onPress: () => setScanned(false) },
    ]);
  }, []);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.err}>{error}</Text>
      </View>
    );
  }

  if (hasPermission === false) {
    return (
      <View style={styles.center}>
        <Text>Permiso de cámara denegado. Revísalo en ajustes.</Text>
      </View>
    );
  }

  if (!scanner || hasPermission == null) {
    return (
      <View style={styles.center}>
        <Text>Cargando escáner…</Text>
      </View>
    );
  }

  const Scanner = scanner.BarCodeScanner;
  const enabled = isFocused && !scanned;

  return (
    <View style={styles.container}>
      {enabled ? (
        <Scanner
          onBarCodeScanned={onScan}
          style={StyleSheet.absoluteFillObject}
        />
      ) : (
        <View style={styles.center}><Text>Pausado</Text></View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  err: { color: '#c00', textAlign: 'center' },
});
