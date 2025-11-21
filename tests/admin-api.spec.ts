import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as net from '@/src/lib/net';
import { fetchAdminDashboardData } from '@/src/lib/admin-api';
import { mockUnitSummaries } from '@/src/mock/admin/dashboard-fixture';
import type { AlertSummary, StaffActivity } from '@/src/types/admin';

describe('fetchAdminDashboardData', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('usa datos remotos cuando la API responde bien', async () => {
    const remoteUnits = [{ ...mockUnitSummaries[0], unitName: 'Unidad Remota' }];
    const remoteStaff: StaffActivity[] = [];
    const remoteAlerts: AlertSummary[] = [];

    const apiSpy = vi
      .spyOn(net, 'fetchWithRetry')
      .mockResolvedValueOnce({ ok: true, json: async () => remoteUnits } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => remoteStaff } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => remoteAlerts } as Response);

    const result = await fetchAdminDashboardData();

    expect(result.units[0].unitName).toBe('Unidad Remota');
    expect(result.staff).toEqual(remoteStaff);
    expect(result.alerts).toEqual(remoteAlerts);
    expect(apiSpy).toHaveBeenCalledTimes(3);
  });

  it('cae a mocks cuando la API falla', async () => {
    vi.spyOn(net, 'fetchWithRetry').mockRejectedValueOnce(new Error('Network'));

    const result = await fetchAdminDashboardData();
    expect(result.units).toEqual(mockUnitSummaries);
  });
});
