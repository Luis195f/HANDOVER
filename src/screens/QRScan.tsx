import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert, Pressable } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from './PatientList';

type Props = NativeStackScreenProps<RootStackParamList, 'QRScan'>;

function parsePatientIdFromQR(data: string): string | null {
  try {
    const m = data.match(/Patient\/([A-Za-z0-9\-\._]+)/);
    if (m?.[1]) return m[1];
    if (data.trim().startsWith('{')) {
      const obj = JSON.parse(data);
      if (obj?.resourceType === 'Patient' && typeof obj?.id === 'string') return obj.id;
    }
    const p = data.match(/^PAT:([A-Za-z0-9\-\._]+)/i);
    if (p?.[1]) return p[1];
    if (/^[A-Za-z0-9\-\._]+$/.test(data.trim())) return data.trim();
  } catch {}
  return null;
}

export default function QRScan({ navigation }: Props) {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    if (!permission) requestPermission();
  }, [permission]);

  if (!permission) {
    return <View style={styles.center}><Text style={styles.text}>Solicitando permiso de cámara…</Text></View>;
  }
  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.text}>Sin permiso de cámara.</Text>
        <Pressable onPress={requestPermission} style={styles.btn}>
          <Text style={{ color:'#fff', fontWeight:'700' }}>Conceder permiso</Text>
        </Pressable>
      </View>
    );
  }

  const onBarCodeScanned = (result: any) => {
    if (scanned) return;
    setScanned(true);
    const data: string = result?.data ?? '';
    const pid = parsePatientIdFromQR(data);
    if (!pid) {
      Alert.alert('Código no reconocido', 'Asegúrate de que el QR contenga Patient/{id} o un id válido.');
      setScanned(false);
      return;
    }
    navigation.replace('HandoverForm', { patientId: pid });
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={onBarCodeScanned}
      />
      <View style={styles.overlay}>
        <Text style={styles.text}>Enfoca la pulsera QR del paciente</Text>
        <Pressable onPress={()=>navigation.goBack()} style={styles.btn}>
          <Text style={{ color:'#fff', fontWeight:'700' }}>Cancelar</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex:1, alignItems:'center', justifyContent:'center', backgroundColor:'#0b1220', gap:10 },
  text: { color:'#eaf2ff', fontSize:16 },
  overlay: { position:'absolute', bottom:20, left:0, right:0, alignItems:'center', gap:10 },
  btn: { paddingVertical:10, paddingHorizontal:16, backgroundColor:'#2e4473', borderRadius:12 }
});
