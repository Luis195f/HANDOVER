import { describe, expect, it } from 'vitest';

import { canAccess, type Capabilities } from '@/src/security/capabilities';

const supervisorCapabilities: Capabilities = {
  userSub: 'auth0|supervisor',
  roles: ['supervisor'],
  scopes: ['handover:write'],
  permissions: {
    canWriteHandover: true,
    canSignHandover: true,
    canViewAudit: false,
    canSendAuditEvents: false,
    isAdmin: false,
  },
};

describe('capabilities routes', () => {
  it('permite dashboard admin para supervisor', () => {
    expect(canAccess('AdminDashboard', supervisorCapabilities)).toBe(true);
  });
});
