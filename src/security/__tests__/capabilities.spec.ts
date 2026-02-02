import { describe, expect, test } from 'vitest';

import { canAccess, type Capabilities } from '@/src/security/capabilities';

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
  test('nurse no puede acceder a auditoría', () => {
    expect(canAccess('AuditLog', nurseCapabilities)).toBe(false);
  });

  test('admin puede acceder a todo', () => {
    expect(canAccess('AuditLog', adminCapabilities)).toBe(true);
    expect(canAccess('AdminDashboard', adminCapabilities)).toBe(true);
    expect(canAccess('HandoverForm', adminCapabilities)).toBe(true);
  });
});
