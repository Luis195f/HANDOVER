// src/navigation/RootNavigator.tsx
import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import PatientList from '@/src/screens/PatientList';
import AudioNote from '@/src/screens/AudioNote';
// Si usas HandoverForm, puedes descomentar esto:
// import HandoverForm from '@/src/screens/HandoverForm';

import type { RootStackParamList } from '@/src/navigation/types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  return (
    <Stack.Navigator initialRouteName="PatientList">
      <Stack.Screen
        name="PatientList"
        component={PatientList}
        options={{ title: 'Pacientes' }}
      />
      <Stack.Screen
        name="AudioNote"
        component={AudioNote}
        options={{ title: 'Notas de audio' }}
      />
      {/*
      <Stack.Screen
        name="HandoverForm"
        component={HandoverForm}
        options={{ title: 'Entrega de turno' }}
      />
      */}
    </Stack.Navigator>
  );
}
