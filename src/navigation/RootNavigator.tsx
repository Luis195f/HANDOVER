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
import QRScanRoute from '@/src/navigation/QRScanRoute';
import ShiftDetailsScreen from '@/src/screens/ShiftDetailsScreen';
import SyncCenter from '@/src/screens/SyncCenter';
import AuditLogScreen from '@/src/screens/AuditLogScreen';
import SupervisorDashboardScreen from '@/src/screens/SupervisorDashboard';
import { AdminDashboardScreen } from '@/src/screens/admin/AdminDashboardScreen';
import LoginScreen from '@/src/screens/LoginScreen';
import PrivacyConsentScreen from '@/src/screens/PrivacyConsentScreen';

import type { RootStackParamList } from '@/src/navigation/types';
import { canAccess, type Capabilities, type RouteName } from '@/src/security/capabilities';
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
function CapabilityGuard(props: {
  capabilities: Capabilities | null;
  isDemo: boolean;
  routeName: RouteName;
  children: React.ReactNode;
}) {
  const { capabilities, isDemo, routeName, children } = props;

  if (isDemo) return <>{children}</>;
  if (!capabilities) return <UnauthorizedScreen />;


  const ok = canAccess(routeName, capabilities);
  return ok ? <>{children}</> : <UnauthorizedScreen />;
}

/**
 * Crea un Screen “guarded” que conserva EXACTAMENTE los props de navegación del Screen original,
 * evitando TS2559 y TS2739.
 */
function withCapabilityGuard<P extends object>(
  Screen: React.ComponentType<P>,
  routeName: RouteName,
) {
  return function GuardedScreen(props: P) {
    const { capabilities, session } = useAuth();
    const isDemo = session?.mode === 'demo';
    return (
      <CapabilityGuard capabilities={capabilities} isDemo={isDemo} routeName={routeName}>
        <Screen {...props} />
      </CapabilityGuard>
    );
  };
}

const GuardedPatientList = withCapabilityGuard(PatientList, 'PatientList');
const GuardedAudioNote = withCapabilityGuard(AudioNote, 'AudioNote');
const GuardedHandoverMain = withCapabilityGuard(HandoverForm, 'HandoverMain');
const GuardedHandoverForm = withCapabilityGuard(HandoverForm, 'HandoverForm');
const GuardedShiftDetails = withCapabilityGuard(ShiftDetailsScreen, 'ShiftDetails');
const GuardedQRScan = withCapabilityGuard(QRScanRoute, 'QRScan');
const GuardedSyncCenter = withCapabilityGuard(SyncCenter, 'SyncCenter');
const GuardedPatientDashboard = withCapabilityGuard(PatientDashboard, 'PatientDashboard');
const GuardedAuditLog = withCapabilityGuard(AuditLogScreen, 'AuditLog');
const GuardedSupervisorDashboard = withCapabilityGuard(SupervisorDashboardScreen, 'SupervisorDashboard');
const GuardedAdminDashboard = withCapabilityGuard(AdminDashboardScreen, 'AdminDashboard');

function AuthGate() {
  const { session, capabilities, loading, logout, switchDemoActor } = useAuth();

  const [onboardingCompleted, setOnboardingCompletedState] = React.useState<boolean | null>(null);
  const [privacyConsent, setPrivacyConsentState] = React.useState<boolean | null>(null);
  const isE2E = process.env.EXPO_PUBLIC_E2E === 'true';
  const hasSession = Boolean(session);

  React.useEffect(() => {
    let alive = true;

    async function loadOnboarding() {
      if (!hasSession) {
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
  }, [hasSession]);

  React.useEffect(() => {
    let alive = true;

    async function loadConsent() {
      if (!hasSession) {
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
  }, [hasSession]);

  // Splash mientras hidrata auth + flags (si hay sesión)
  const onboardingReady = isE2E ? true : onboardingCompleted;
  const consentReady = isE2E ? true : privacyConsent;

  if (loading || (session && (onboardingReady === null || consentReady === null))) {
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

// 2) ✅ Guard global temprano PERO sin race: espera capabilities
if (!isDemo && !capabilities) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator size="large" />
    </View>
  );
}

const allowedAppEntry =
  isDemo || Boolean(Object.values((capabilities ?? { permissions: {} as any }).permissions).some(Boolean));

if (!allowedAppEntry) {
  return <UnauthorizedScreen />;
}

  // ✅ flags de features (sin romper tu lógica)
  // 🔧 Incluimos admin para que no quede bloqueado post-onboarding.
  const canEnterPatientList = isDemo || canAccess('PatientList', capabilities);
  const postOnboardingRoute: keyof RootStackParamList = canEnterPatientList
    ? 'PatientList'
    : (capabilities?.permissions.canViewAudit ? 'AuditLog' : 'Unauthorized');

  const initialRouteName: keyof RootStackParamList =
    onboardingReady ? (consentReady ? postOnboardingRoute : 'PrivacyConsent') : 'Onboarding';

  return (
    <View style={{ flex: 1 }}>
      <DemoModeBanner session={session} onExit={logout} onSwitchActor={switchDemoActor} />

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
