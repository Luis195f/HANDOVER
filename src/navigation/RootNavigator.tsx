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

/**
 * Guard “real” por pantalla:
 * - Si no hay sesión: no renderiza aquí (AuthGate ya maneja Login), pero por seguridad devolvemos Unauthorized.
 * - Si no tiene rol: Unauthorized.
 * - Si es demo: pasa.
 */
function RoleGuard(props: {
  session: any; // session viene del hook; mantenemos esto “blando” para no romper tipados existentes.
  isDemo: boolean;
  allowedRoles: Array<'admin' | 'nurse' | 'supervisor' | 'viewer'>;
  children: React.ReactNode;
}) {
  const { session, isDemo, allowedRoles, children } = props;

  if (!session) return <UnauthorizedScreen />;
  if (isDemo) return <>{children}</>;

  const ok = hasRole(session, allowedRoles);
  return ok ? <>{children}</> : <UnauthorizedScreen />;
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

  // 2) ✅ Guard global temprano (mantiene tu intención original)
  const allowedAppEntry = isDemo || hasRole(session, ['admin', 'nurse', 'supervisor']);
  if (!allowedAppEntry) {
    return <UnauthorizedScreen />;
  }

  // ✅ flags de features (sin romper tu lógica)
  // 🔧 Incluimos admin para que no quede bloqueado post-onboarding.
  const canSubmitHandover = isDemo || hasRole(session, ['nurse', 'supervisor', 'admin']);
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

        {/* Siempre registrada: route estable */}
        <Stack.Screen name="Unauthorized" component={UnauthorizedScreen} options={{ title: 'Acceso restringido' }} />

        {/* ⛔️ Enforcer real: aunque intenten navegar directo, el componente está guardado */}
        <Stack.Screen name="PatientList" options={{ title: 'Pacientes' }}>
          {() => (
            <RoleGuard session={session} isDemo={isDemo} allowedRoles={['nurse', 'supervisor', 'admin']}>
              <PatientList />
            </RoleGuard>
          )}
        </Stack.Screen>

        <Stack.Screen name="AudioNote" options={{ title: 'Nota de voz' }}>
          {() => (
            <RoleGuard session={session} isDemo={isDemo} allowedRoles={['nurse', 'supervisor', 'admin']}>
              <AudioNote />
            </RoleGuard>
          )}
        </Stack.Screen>

        <Stack.Screen name="HandoverMain" options={{ title: 'Handover' }}>
          {() => (
            <RoleGuard session={session} isDemo={isDemo} allowedRoles={['nurse', 'supervisor', 'admin']}>
              <HandoverForm />
            </RoleGuard>
          )}
        </Stack.Screen>

        <Stack.Screen name="HandoverForm" options={{ title: 'Handover' }}>
          {() => (
            <RoleGuard session={session} isDemo={isDemo} allowedRoles={['nurse', 'supervisor', 'admin']}>
              <HandoverForm />
            </RoleGuard>
          )}
        </Stack.Screen>

        <Stack.Screen name="ShiftDetails" options={{ title: 'Turno' }}>
          {() => (
            <RoleGuard session={session} isDemo={isDemo} allowedRoles={['nurse', 'supervisor', 'admin']}>
              <ShiftDetailsScreen />
            </RoleGuard>
          )}
        </Stack.Screen>

        <Stack.Screen name="QRScan" options={{ title: 'Escanear QR' }}>
          {() => (
            <RoleGuard session={session} isDemo={isDemo} allowedRoles={['nurse', 'supervisor', 'admin']}>
              <QRScan />
            </RoleGuard>
          )}
        </Stack.Screen>

        <Stack.Screen name="SyncCenter" options={{ title: 'Centro de sincronización' }}>
          {() => (
            <RoleGuard session={session} isDemo={isDemo} allowedRoles={['nurse', 'supervisor', 'admin']}>
              <SyncCenter />
            </RoleGuard>
          )}
        </Stack.Screen>

        <Stack.Screen name="PatientDashboard" options={{ title: 'Dashboard del paciente' }}>
          {() => (
            <RoleGuard session={session} isDemo={isDemo} allowedRoles={['nurse', 'supervisor', 'admin']}>
              <PatientDashboard />
            </RoleGuard>
          )}
        </Stack.Screen>

        <Stack.Screen name="AuditLog" options={{ title: 'Auditoría' }}>
          {() => (
            <RoleGuard session={session} isDemo={isDemo} allowedRoles={['nurse', 'supervisor', 'admin']}>
              <AuditLogScreen />
            </RoleGuard>
          )}
        </Stack.Screen>

        <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicy} options={{ title: 'Política de privacidad' }} />

        <Stack.Screen name="SupervisorDashboard" options={{ title: 'Dashboard de turno' }}>
          {() => (
            <RoleGuard session={session} isDemo={isDemo} allowedRoles={['supervisor', 'admin']}>
              <SupervisorDashboardScreen />
            </RoleGuard>
          )}
        </Stack.Screen>

        <Stack.Screen name="AdminDashboard" options={{ title: 'Dashboard admin' }}>
          {() => (
            <RoleGuard session={session} isDemo={isDemo} allowedRoles={['admin']}>
              <AdminDashboardScreen />
            </RoleGuard>
          )}
        </Stack.Screen>
      </Stack.Navigator>
    </View>
  );
}

export default function RootNavigator() {
  return <AuthGate />;
}

