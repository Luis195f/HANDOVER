// src/navigation/RootNavigator.tsx 
import * as React from 'react';
import { useEffect } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// Pantallas existentes en tu proyecto
import LoginMock from '@/src/screens/LoginMock';
import PatientList from '@/src/screens/PatientList';
import AudioNote from '@/src/screens/AudioNote';
import HandoverMain from '@/src/screens/HandoverMain'; // <- versión nueva con pestañas
import QRScan from '@/src/screens/QRScan';

// Asegúrate de tener este archivo:
import PatientDashboard from '@/src/screens/PatientDashboard';

export type RootStackParamList = {
  Login: undefined;
  PatientList: undefined;
  // Única ruta de entrega (usa la versión nueva con tabs)
  Handover:
    | {
        patientId?: string;       // preferido
        patientIdParam?: string;  // compat antiguos
        unitIdParam?: string;
        specialtyId?: string;
      }
    | undefined;
  PatientDashboard: { patientId: string };
  AudioNote: { onDoneRoute?: keyof RootStackParamList } | undefined;
  // Permitimos ambos para compat: si alguien aún manda 'HandoverForm', redirigimos.
  QRScan:
    | {
        returnTo?: 'Handover' | 'HandoverForm' | 'PatientList' | 'AudioNote';
        unitIdParam?: string;
        specialtyId?: string;
      }
    | undefined;

  // Ruta antigua: no debe usarse, pero la dejamos tipada para compat.
  HandoverForm?:
    | {
        patientIdParam?: string;
        unitIdParam?: string;
        specialtyId?: string;
      }
    | undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Navigator: any = Stack.Navigator;
const Screen: any = Stack.Screen;

/**
 * Pantalla "fantasma" para compatibilidad:
 * si alguien navega a HandoverForm, lo mandamos a Handover (tabs).
 */
function HandoverRedirect({ route, navigation }: any) {
  useEffect(() => {
    const params = route?.params ?? {};
    const {
      patientId,
      patientIdParam,
      unitIdParam,
      specialtyId,
    } = params;

    navigation.replace('Handover', {
      patientId: patientId ?? patientIdParam,
      unitIdParam,
      specialtyId,
    });
  }, [route, navigation]);

  return null;
}

export default function RootNavigator() {
  return (
    <Navigator initialRouteName="Login" screenOptions={{ headerShown: false }}>
      <Screen name="Login" component={LoginMock} options={{ headerShown: false }} />

      <Screen
        name="PatientList"
        component={PatientList}
        options={{ title: 'Pacientes', headerShown: true }}
      />

      {/* ÚNICA entrega de turno (versión nueva con pestañas) */}
      <Screen
        name="Handover"
        component={HandoverMain}
        options={{ title: 'Entrega de turno', headerShown: true }}
      />

      <Screen
        name="PatientDashboard"
        component={PatientDashboard}
        options={{ title: 'Dashboard clínico', headerShown: true }}
      />

      <Screen
        name="AudioNote"
        component={AudioNote}
        options={{ title: 'Notas de audio', headerShown: true }}
      />

      <Screen
        name="QRScan"
        component={QRScan}
        options={{ title: 'Escanear', headerShown: true }}
      />

      {/* Compat temporal: rutas viejas a HandoverForm */}
      <Screen name="HandoverForm" component={HandoverRedirect} options={{ headerShown: false }} />
    </Navigator>
  );
}
