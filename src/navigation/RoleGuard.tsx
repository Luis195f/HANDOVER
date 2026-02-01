import React from 'react';
import { View, Text } from 'react-native';
import { hasRole } from '@/src/security/acl';

type GuardRole = 'admin' | 'nurse' | 'supervisor' | 'viewer';

function UnauthorizedInline() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Text style={{ fontSize: 18, fontWeight: '600', marginBottom: 8 }}>Acceso restringido</Text>
      <Text style={{ textAlign: 'center' }}>
        Tu cuenta no tiene permisos para acceder a esta sección. Contacta con el administrador.
      </Text>
    </View>
  );
}

export function RoleGuard(props: {
  session: any; // intencionalmente laxo: no forzamos tipado y no rompemos
  isDemo: boolean;
  allowedRoles: GuardRole[];
  children: React.ReactNode;
}) {
  const { session, isDemo, allowedRoles, children } = props;

  if (!session) return <UnauthorizedInline />;
  if (isDemo) return <>{children}</>;

  return hasRole(session, allowedRoles) ? <>{children}</> : <UnauthorizedInline />;
}
