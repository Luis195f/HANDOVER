import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import AudioNote from '@/src/screens/AudioNote';
import HandoverForm from '@/src/screens/HandoverForm';
import PatientDashboard from '@/src/screens/PatientDashboard';
import PatientList from '@/src/screens/PatientList';
import { DemoModeBanner } from '@/src/components/DemoModeBanner';
import OnboardingScreen from '@/src/screens/OnboardingScreen';
import PrivacyPolicy from '@/src/screens/PrivacyPolicy';
import QRScan from '@/src/screens/QRScan';
import ShiftDetailsScreen from '@/src/screens/ShiftDetailsScreen';
import SyncCenter from '@/src/screens/SyncCenter';
import AuditLogScreen from '@/src/screens/AuditLogScreen';
import SupervisorDashboardScreen from '@/src/screens/SupervisorDashboard';
import { AdminDashboardScreen } from '@/src/screens/admin/AdminDashboardScreen';
import LoginScreen from '@/src/screens/LoginScreen';
import PrivacyConsentScreen from '@/src/screens/PrivacyConsentScreen';

import type { RootStackParamList } from '@/src/navigation/types';
import { hasRole } from '@/src/security/acl';
import { useAuth } from '@/src/security/auth';
import { getOnboardingCompleted } from '@/src/lib/onboarding-storage';
import { hasPrivacyConsent } from '@/src/lib/privacy-consent';

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

function AuthGate() {
  const { session, loading, logout } = useAuth();

  if (__DEV__) {
    // OJO: esto loguea roles y modo; no loguees tokens aquí.
    // eslint-disable-next-line no-console
    console.log('[NAV] session.roles:', session?.roles, 'mode:', session?.mode);
  }

  const [onboardingCompleted, setOnboardingCompletedState] = React.useState<boolean | null>(null);
  const [privacyConsent, setPrivacyConsentState] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    let alive = true;

    async function loadOnboarding() {
      if (!session) {
        setOnboardingCompletedState(null);
        return;
      }

      setOnboardingCompletedState(null);
      try {
        const completed = await getOnboardingCompleted();
        if (alive) setOnboardingCompletedState(completed);
      } catch {
        if (alive) setOnboardingCompletedState(false);
      }
    }

    void loadOnboarding();
    return () => {
      alive = false;
    };
  }, [session]);

  React.useEffect(() => {
    let alive = true;

    async function loadConsent() {
      if (!session) {
        setPrivacyConsentState(null);
        return;
      }

      setPrivacyConsentState(null);
      try {
        const consented = await hasPrivacyConsent();
        if (alive) setPrivacyConsentState(consented);
      } catch {
        if (alive) setPrivacyConsentState(false);
      }
    }

    void loadConsent();
    return () => {
      alive = false;
    };
  }, [session]);

  // Splash mientras hidrata auth + flags (si hay sesión)
  if (loading || (session && (onboardingCompleted === null || privacyConsent === null))) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // 1) Sin sesión => Login stack
  if (!session) {
    return (
      <Stack.Navigator>
        <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
      </Stack.Navigator>
    );
  }

  // ✅ Demo override
  const isDemo = session?.mode === 'demo';

  // 2) ✅ Role guard temprano (incluye supervisor para no bloquear canAdminister)
  const allowed = isDemo || hasRole(session, ['admin', 'nurse', 'supervisor']);
  if (!allowed) {
    return <UnauthorizedScreen />;
  }

  // ✅ guards de features (sin romper)
  const canSubmitHandover = isDemo || hasRole(session, ['nurse', 'supervisor']);
  const canAdminister = isDemo || hasRole(session, ['supervisor', 'admin']);

  const postOnboardingRoute: keyof RootStackParamList = canSubmitHandover ? 'PatientList' : 'Unauthorized';

  const initialRouteName: keyof RootStackParamList =
    onboardingCompleted ? (privacyConsent ? postOnboardingRoute : 'PrivacyConsent') : 'Onboarding';

  return (
    <View style={{ flex: 1 }}>
      <DemoModeBanner visible={!!isDemo} onExit={logout} />

      <Stack.Navigator key={initialRouteName} initialRouteName={initialRouteName}>
        <Stack.Screen name="Onboarding" options={{ headerShown: false }}>
          {(props) => (
            <OnboardingScreen
              {...props}
              onComplete={async () => {
                // ✅ solo onboarding; el consentimiento se maneja en PrivacyConsentScreen
                setOnboardingCompletedState(true);
              }}
              nextRoute={postOnboardingRoute}
            />
          )}
        </Stack.Screen>

        <Stack.Screen name="PrivacyConsent" component={PrivacyConsentScreen} options={{ title: 'Consentimiento' }} />

        {canSubmitHandover ? (
          <>
            <Stack.Screen name="PatientList" component={PatientList} options={{ title: 'Pacientes' }} />
            <Stack.Screen name="AudioNote" component={AudioNote} options={{ title: 'Nota de voz' }} />
            <Stack.Screen name="HandoverMain" component={HandoverForm} options={{ title: 'Handover' }} />
            <Stack.Screen name="HandoverForm" component={HandoverForm} options={{ title: 'Handover' }} />
            <Stack.Screen name="ShiftDetails" component={ShiftDetailsScreen} options={{ title: 'Turno' }} />
            <Stack.Screen name="QRScan" component={QRScan} options={{ title: 'Escanear QR' }} />
            <Stack.Screen name="SyncCenter" component={SyncCenter} options={{ title: 'Centro de sincronización' }} />
            <Stack.Screen
              name="PatientDashboard"
              component={PatientDashboard}
              options={{ title: 'Dashboard del paciente' }}
            />
          </>
        ) : (
          <Stack.Screen name="Unauthorized" component={UnauthorizedScreen} options={{ title: 'Acceso restringido' }} />
        )}

        {canSubmitHandover || canAdminister ? (
          <Stack.Screen name="AuditLog" component={AuditLogScreen} options={{ title: 'Auditoría' }} />
        ) : null}

        <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicy} options={{ title: 'Política de privacidad' }} />

        {canAdminister ? (
          <Stack.Screen
            name="SupervisorDashboard"
            component={SupervisorDashboardScreen}
            options={{ title: 'Dashboard de turno' }}
          />
        ) : null}

        {canAdminister ? (
          <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} options={{ title: 'Dashboard admin' }} />
        ) : null}
      </Stack.Navigator>
    </View>
  );
}

export default function RootNavigator() {
  return <AuthGate />;
}
