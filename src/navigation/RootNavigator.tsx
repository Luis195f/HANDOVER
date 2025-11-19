import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import AudioNote from '@/src/screens/AudioNote';
import HandoverForm from '@/src/screens/HandoverForm';
import HandoverMain from '@/src/screens/HandoverMain';
import PatientDashboard from '@/src/screens/PatientDashboard';
import PatientList from '@/src/screens/PatientList';
import QRScan from '@/src/screens/QRScan';
import SyncCenter from '@/src/screens/SyncCenter';
import SupervisorDashboardScreen from '@/src/screens/SupervisorDashboard';
import type { RootStackParamList } from '@/src/navigation/types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  // TODO: restringir acceso a SupervisorDashboard a usuarios con rol de supervisión cuando exista gestión de roles.
  return (
    <Stack.Navigator>
      <Stack.Screen name="PatientList" component={PatientList} options={{ title: 'Pacientes' }} />
      <Stack.Screen name="AudioNote" component={AudioNote} options={{ title: 'Nota de voz' }} />
      <Stack.Screen name="HandoverMain" component={HandoverMain} options={{ title: 'Handover' }} />
      <Stack.Screen name="HandoverForm" component={HandoverForm} options={{ title: 'Handover' }} />
      <Stack.Screen name="QRScan" component={QRScan} options={{ title: 'Escanear QR' }} />
      <Stack.Screen name="SyncCenter" component={SyncCenter} options={{ title: 'Centro de sincronización' }} />
      <Stack.Screen name="PatientDashboard" component={PatientDashboard} options={{ title: 'Dashboard del paciente' }} />
      <Stack.Screen
        name="SupervisorDashboard"
        component={SupervisorDashboardScreen}
        options={{ title: 'Dashboard de turno' }}
      />
    </Stack.Navigator>
  );
}
