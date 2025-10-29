// src/navigation/RootNavigator.tsx
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import PatientList from '@/src/screens/PatientList';
import AudioNote from '@/src/screens/AudioNote';
import HandoverForm from '@/src/screens/HandoverForm';
import QRScan from '@/src/screens/QRScan';

export type RootStackParamList = {
  PatientList: undefined;
  AudioNote: { onDoneRoute?: string } | undefined;
  HandoverForm: { patientIdParam?: string; unitIdParam?: string; specialtyId?: string };
  // Enviamos a qué pantalla volver después del escaneo (por defecto HandoverForm)
  QRScan:
    | {
        returnTo?: 'HandoverForm' | 'PatientList' | 'AudioNote';
        unitIdParam?: string;
        specialtyId?: string;
      }
    | undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  return (
    <Stack.Navigator initialRouteName="PatientList">
      <Stack.Screen name="PatientList" component={PatientList} options={{ title: 'Pacientes' }} />
      <Stack.Screen name="HandoverForm" component={HandoverForm} options={{ title: 'Entrega de turno' }} />
      <Stack.Screen name="AudioNote" component={AudioNote} options={{ title: 'Notas de audio' }} />
      <Stack.Screen name="QRScan" component={QRScan} options={{ title: 'Escanear' }} />
    </Stack.Navigator>
  );
}
