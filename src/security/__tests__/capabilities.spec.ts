import { describe, expect, test } from 'vitest';

import { canAccess, getDemoCapabilities, type Capabilities } from '@/src/security/capabilities';

const nurseCapabilities: Capabilities = {
  userSub: 'auth0|nurse',
  roles: ['nurse'],
  scopes: ['handover:write'],
  permissions: {
    canWriteHandover: true,
    canSignHandover: false,
    canViewAudit: false,
    canSendAuditEvents: true,
    isAdmin: false,
  },
};

const adminCapabilities: Capabilities = {
  userSub: 'auth0|admin',
  roles: ['admin'],
  scopes: ['handover:write', 'handover:audit'],
  permissions: {
    canWriteHandover: true,
    canSignHandover: true,
    canViewAudit: true,
    canSendAuditEvents: true,
    isAdmin: true,
  },
};

describe('canAccess', () => {
  test('falla cerrado si no hay capabilities', () => {
    expect(canAccess('HandoverMain', null)).toBe(false);
  });

  test('nurse no puede acceder a auditoría', () => {
    expect(canAccess('AuditLog', nurseCapabilities)).toBe(false);
  });

  test('admin puede acceder a todo', () => {
    expect(canAccess('AuditLog', adminCapabilities)).toBe(true);
    expect(canAccess('AdminDashboard', adminCapabilities)).toBe(true);
    expect(canAccess('HandoverForm', adminCapabilities)).toBe(true);
  });

  test('rutas no listadas fallan cerrado', () => {
    expect(canAccess('NotARealRoute' as never, adminCapabilities)).toBe(false);
  });

  test('supervisor puede acceder al dashboard de supervisor', () => {
    const supervisorCapabilities: Capabilities = {
      ...nurseCapabilities,
      roles: ['supervisor'],
      permissions: {
        ...nurseCapabilities.permissions,
        canSignHandover: true,
      },
    };

    expect(canAccess('SupervisorDashboard', supervisorCapabilities)).toBe(true);
  });

  test('rutas públicas permanecen accesibles', () => {
    expect(canAccess('Login', nurseCapabilities)).toBe(true);
    expect(canAccess('PrivacyPolicy', nurseCapabilities)).toBe(true);
  });
});

describe('getDemoCapabilities', () => {
  test('devuelve capacidades demo de enfermería sin permisos de firma', () => {
    expect(getDemoCapabilities('demo-u1')).toEqual({
      userSub: 'demo-u1',
      roles: ['nurse'],
      scopes: ['handover:write', 'fhir:transaction'],
      permissions: {
        canWriteHandover: true,
        canSignHandover: false,
        canViewAudit: false,
        canSendAuditEvents: false,
        isAdmin: false,
      },
      fhir: {
        version: 'R4',
        transaction: true,
        profiles: [
          {
            canonical: 'http://hl7.org/fhir/StructureDefinition/Bundle',
            version: '4.0.1',
            title: 'FHIR R4 Bundle',
          },
        ],
      },
    });
  });
});
