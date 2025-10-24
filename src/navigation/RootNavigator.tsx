import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import PatientList from '@/src/screens/PatientList';
import HandoverForm from '@/src/screens/HandoverForm';
import SyncCenter from '@/src/screens/SyncCenter';
import type { RootStackParamList } from './navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="PatientList" component={PatientList} options={{ title: 'Pacientes' }} />
      <Stack.Screen
        name="HandoverForm"
        component={HandoverForm}
        options={{ title: 'Entrega de turno' }}
      />
      <Stack.Screen
        name="SyncCenter"
        component={SyncCenter}
        options={{ title: 'Centro de sincronización' }}
      />
    </Stack.Navigator>
  );
}

export type { RootStackParamList };
