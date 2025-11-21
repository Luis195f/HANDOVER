import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import AudioNote from '@/src/screens/AudioNote';
import HandoverForm from '@/src/screens/HandoverForm';
import HandoverMain from '@/src/screens/HandoverMain';
import PatientDashboard from '@/src/screens/PatientDashboard';
import PatientList from '@/src/screens/PatientList';
import QRScan from '@/src/screens/QRScan';
import SyncCenter from '@/src/screens/SyncCenter';
import SupervisorDashboardScreen from '@/src/screens/SupervisorDashboard';
import { AdminDashboardScreen } from '@/src/screens/admin/AdminDashboardScreen';
import LoginScreen from '@/src/screens/LoginScreen';
import type { RootStackParamList } from '@/src/navigation/types';
import { hasRole } from '@/src/security/acl';
import { useAuth } from '@/src/security/auth';

const Stack = createNativeStackNavigator<RootStackParamList>();

function UnauthorizedScreen() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 8 }}>Acceso restringido</Text>
      <Text style={{ textAlign: 'center' }}>
        Tu cuenta no tiene permisos para acceder a esta sección. Contacta con el administrador.
      </Text>
    </View>
  );
}

// BEGIN HANDOVER_AUTH
function AuthGate() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!session) {
    return (
      <Stack.Navigator>
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      </Stack.Navigator>
    );
  }

  const canSubmitHandover = hasRole(session, ['nurse', 'supervisor']);
  const canAdminister = hasRole(session, ['supervisor', 'admin']);

  return (
    <Stack.Navigator>
      {canSubmitHandover ? (
        <>
          <Stack.Screen name="PatientList" component={PatientList} options={{ title: 'Pacientes' }} />
          <Stack.Screen name="AudioNote" component={AudioNote} options={{ title: 'Nota de voz' }} />
          <Stack.Screen name="HandoverMain" component={HandoverMain} options={{ title: 'Handover' }} />
          <Stack.Screen name="HandoverForm" component={HandoverForm} options={{ title: 'Handover' }} />
          <Stack.Screen name="QRScan" component={QRScan} options={{ title: 'Escanear QR' }} />
          <Stack.Screen name="SyncCenter" component={SyncCenter} options={{ title: 'Centro de sincronización' }} />
          <Stack.Screen name="PatientDashboard" component={PatientDashboard} options={{ title: 'Dashboard del paciente' }} />
        </>
      ) : (
        <Stack.Screen name="Unauthorized" component={UnauthorizedScreen} options={{ title: 'Acceso restringido' }} />
      )}
      {canAdminister ? (
        <Stack.Screen
          name="SupervisorDashboard"
          component={SupervisorDashboardScreen}
          options={{ title: 'Dashboard de turno' }}
        />
      ) : null}
      {canAdminister ? (
        <Stack.Screen
          name="AdminDashboard"
          component={AdminDashboardScreen}
          options={{ title: 'Dashboard admin' }}
        />
      ) : null}
    </Stack.Navigator>
  );
}
// END HANDOVER_AUTH

export default function RootNavigator() {
  return <AuthGate />;
}
