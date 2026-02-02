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

/**
 * Crea un Screen “guarded” que conserva EXACTAMENTE los props de navegación del Screen original,
 * evitando TS2559 y TS2739.
 */
function withRoleGuard<P extends object>(
  Screen: React.ComponentType<P>,
  getGuard: () => { session: any; isDemo: boolean; allowedRoles: Array<'admin' | 'nurse' | 'supervisor' | 'viewer'> }
) {
  return function GuardedScreen(props: P) {
    const { session, isDemo, allowedRoles } = getGuard();
    return (
      <RoleGuard session={session} isDemo={isDemo} allowedRoles={allowedRoles}>
        <Screen {...props} />
      </RoleGuard>
    );
  };
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

  // ✅ Guard factory (cerramos sobre session/isDemo una sola vez)
  const guardBase = () => ({ session, isDemo });

  // ✅ Screens protegidas (wrappers tipados)
  const GuardedPatientList = withRoleGuard(PatientList as any, () => ({
    ...guardBase(),
    allowedRoles: ['nurse', 'supervisor', 'admin'],
  }));

  const GuardedAudioNote = withRoleGuard(AudioNote as any, () => ({
    ...guardBase(),
    allowedRoles: ['nurse', 'supervisor', 'admin'],
  }));

  const GuardedHandoverMain = withRoleGuard(HandoverForm as any, () => ({
    ...guardBase(),
    allowedRoles: ['nurse', 'supervisor', 'admin'],
  }));

  const GuardedHandoverForm = withRoleGuard(HandoverForm as any, () => ({
    ...guardBase(),
    allowedRoles: ['nurse', 'supervisor', 'admin'],
  }));

  const GuardedShiftDetails = withRoleGuard(ShiftDetailsScreen as any, () => ({
    ...guardBase(),
    allowedRoles: ['nurse', 'supervisor', 'admin'],
  }));

  const GuardedQRScan = withRoleGuard(QRScan as any, () => ({
    ...guardBase(),
    allowedRoles: ['nurse', 'supervisor', 'admin'],
  }));

  const GuardedSyncCenter = withRoleGuard(SyncCenter as any, () => ({
    ...guardBase(),
    allowedRoles: ['nurse', 'supervisor', 'admin'],
  }));

  const GuardedPatientDashboard = withRoleGuard(PatientDashboard as any, () => ({
    ...guardBase(),
    allowedRoles: ['nurse', 'supervisor', 'admin'],
  }));

  const GuardedAuditLog = withRoleGuard(AuditLogScreen as any, () => ({
    ...guardBase(),
    allowedRoles: ['nurse', 'supervisor', 'admin'],
  }));

  const GuardedSupervisorDashboard = withRoleGuard(SupervisorDashboardScreen as any, () => ({
    ...guardBase(),
    allowedRoles: ['supervisor', 'admin'],
  }));

  const GuardedAdminDashboard = withRoleGuard(AdminDashboardScreen as any, () => ({
    ...guardBase(),
    allowedRoles: ['admin'],
  }));

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

        {/* ✅ Protegidas por role guard (enforcement real) */}
        <Stack.Screen name="PatientList" component={GuardedPatientList} options={{ title: 'Pacientes' }} />
        <Stack.Screen name="AudioNote" component={GuardedAudioNote} options={{ title: 'Nota de voz' }} />
        <Stack.Screen name="HandoverMain" component={GuardedHandoverMain} options={{ title: 'Handover' }} />
        <Stack.Screen name="HandoverForm" component={GuardedHandoverForm} options={{ title: 'Handover' }} />
        <Stack.Screen name="ShiftDetails" component={GuardedShiftDetails} options={{ title: 'Turno' }} />
        <Stack.Screen name="QRScan" component={GuardedQRScan} options={{ title: 'Escanear QR' }} />
        <Stack.Screen name="SyncCenter" component={GuardedSyncCenter} options={{ title: 'Centro de sincronización' }} />
        <Stack.Screen
          name="PatientDashboard"
          component={GuardedPatientDashboard}
          options={{ title: 'Dashboard del paciente' }}
        />
        <Stack.Screen name="AuditLog" component={GuardedAuditLog} options={{ title: 'Auditoría' }} />

        <Stack.Screen name="PrivacyPolicy" component={PrivacyPolicy} options={{ title: 'Política de privacidad' }} />

        <Stack.Screen
          name="SupervisorDashboard"
          component={GuardedSupervisorDashboard}
          options={{ title: 'Dashboard de turno' }}
        />
        <Stack.Screen name="AdminDashboard" component={GuardedAdminDashboard} options={{ title: 'Dashboard admin' }} />
      </Stack.Navigator>
    </View>
  );
}

export default function RootNavigator() {
  return <AuthGate />;
}
