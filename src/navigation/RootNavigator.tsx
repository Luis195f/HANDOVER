// src/navigation/RootNavigator.tsx
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import LoginMock from '@/src/screens/LoginMock';
import PatientList from '@/src/screens/PatientList';
import AudioNote from '@/src/screens/AudioNote';
import HandoverForm from '@/src/screens/HandoverForm';
import HandoverMain from '@/src/screens/HandoverMain';
import QRScan from '@/src/screens/QRScan';

export type RootStackParamList = {
  Login: undefined;
  PatientList: undefined;
  AudioNote: { onDoneRoute?: string } | undefined;
  HandoverMain: { patientId: string };
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
    <Stack.Navigator initialRouteName="Login" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginMock} options={{ headerShown: false }} />
      <Stack.Screen
        name="PatientList"
        component={PatientList}
        options={{ title: 'Pacientes', headerShown: true }}
      />
      <Stack.Screen
        name="HandoverForm"
        component={HandoverForm}
        options={{ title: 'Entrega de turno', headerShown: true }}
      />
      <Stack.Screen
        name="HandoverMain"
        component={HandoverMain}
        options={{ title: 'Entrega de turno', headerShown: true }}
      />
      <Stack.Screen
        name="AudioNote"
        component={AudioNote}
        options={{ title: 'Notas de audio', headerShown: true }}
      />
      <Stack.Screen name="QRScan" component={QRScan} options={{ title: 'Escanear', headerShown: true }} />
    </Stack.Navigator>
  );
}
