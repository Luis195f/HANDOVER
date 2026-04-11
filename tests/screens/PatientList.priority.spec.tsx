import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearOfflineQueue, enqueueBundle, listOfflineQueue } from '@/src/lib/queue';

vi.mock('expo-sqlite', () => ({
  openDatabaseSync: undefined,
  openDatabase: undefined,
}));

const mocked = vi.hoisted(() => ({
  hasUnitAccess: vi.fn(),
}));

vi.mock('@/src/security/acl', () => ({
  ensureUnitAccess: vi.fn(),
  hasRole: vi.fn(() => false),
  hasUnitAccess: mocked.hasUnitAccess,
}));

describe('PatientList deny-first authz seam', () => {
  beforeEach(async () => {
    mocked.hasUnitAccess.mockReset();
    vi.stubGlobal('__DEV__', true);
    process.env.NODE_ENV = 'test';
    process.env.HANDOVER_TEST_DISABLE_OFFLINE_ENCRYPTION = 'true';
    await clearOfflineQueue();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.HANDOVER_TEST_DISABLE_OFFLINE_ENCRYPTION;
    delete process.env.NODE_ENV;
  });

  it('canQuerySelectedUnit denies a selected unit outside scope and allows all-units aggregate view', async () => {
    const { ALL_UNITS_OPTION, canQuerySelectedUnit } = await import('@/src/screens/PatientList');
    const session = { roles: ['nurse'], units: ['icu-a'] } as const;

    mocked.hasUnitAccess.mockReturnValueOnce(false);
    expect(canQuerySelectedUnit(session, 'icu-b')).toBe(false);
    expect(mocked.hasUnitAccess).toHaveBeenCalledWith(session, 'icu-b');

    expect(canQuerySelectedUnit(session, ALL_UNITS_OPTION)).toBe(true);
    expect(mocked.hasUnitAccess).toHaveBeenCalledTimes(1);
  });

  it('blocks both patient list queries and patient-risk queries for a denied unit', async () => {
    const { getPatientListAccessState } = await import('@/src/screens/PatientList');

    mocked.hasUnitAccess.mockReturnValue(false);
    const state = getPatientListAccessState(
      { roles: ['nurse'], units: ['icu-a'] } as const,
      'icu-b',
      {
        canViewSupervisorDashboard: false,
        showIceaPatientRisk: true,
        isLoadingPatients: false,
      },
    );

    expect(state.canAccessSelectedUnit).toBe(false);
    expect(state.canQueryPatients).toBe(false);
    expect(state.canQueryIceaPatientRisk).toBe(false);
    expect(state.emptyStateMessageKey).toBe('patientList.noAccessMessage');
  });

  it('resets pending patient loading state when deny-first short-circuits a stale request', async () => {
    const { getDeniedPatientLoadState } = await import('@/src/screens/PatientList');

    expect(getDeniedPatientLoadState(4)).toEqual({
      nextRequestId: 5,
      patients: [],
      isLoadingPatients: false,
    });
  });

  it('keeps patient-risk disabled in operational patient lists even for privileged all-units access', async () => {
    const { ALL_UNITS_OPTION, getPatientListAccessState } = await import('@/src/screens/PatientList');

    const nurseState = getPatientListAccessState(
      { roles: ['nurse'], units: ['icu-a'] } as const,
      ALL_UNITS_OPTION,
      {
        canViewSupervisorDashboard: false,
        showIceaPatientRisk: true,
        isLoadingPatients: false,
      },
    );
    const supervisorState = getPatientListAccessState(
      { roles: ['supervisor'], units: ['icu-a', 'icu-b'] } as const,
      ALL_UNITS_OPTION,
      {
        canViewSupervisorDashboard: true,
        showIceaPatientRisk: true,
        isLoadingPatients: false,
      },
    );

    expect(nurseState.canQueryPatients).toBe(true);
    expect(nurseState.canQueryIceaPatientRisk).toBe(false);
    expect(supervisorState.canQueryPatients).toBe(true);
    expect(supervisorState.canQueryIceaPatientRisk).toBe(false);
  });

  it('filters available units to the authoritative capability scope', async () => {
    const { getScopedAvailableUnits } = await import('@/src/screens/PatientList');

    const units = getScopedAvailableUnits(
      'all',
      { roles: ['nurse'], units: ['icu-a', 'icu-b'] } as const,
      {
        userSub: 'auth0|nurse',
        roles: ['nurse'],
        scopes: ['patients:read'],
        unitIds: ['icu-a'],
        permissions: {
          canWriteHandover: true,
          canReadPatients: true,
          canCreatePatients: false,
          canSignHandover: false,
          canViewAudit: false,
          canSendAuditEvents: false,
          isAdmin: false,
        },
      },
    );

    expect(units.map((unit) => unit.id)).toEqual(['icu-a']);
  });

  it('derives queued patient sync status from the canonical offline queue', async () => {
    await clearOfflineQueue();
    await enqueueBundle(
      { resourceType: 'Bundle', type: 'transaction', entry: [] },
      { patientId: 'pat-patient-list' },
    );

    const { buildPatientSyncStatusMap } = await import('@/src/screens/PatientList');
    const statuses = buildPatientSyncStatusMap(await listOfflineQueue());

    expect(statuses).toEqual({ 'pat-patient-list': 'pending' });
  });

  it('does not invent a synced badge when there is no canonical queue evidence for the patient', async () => {
    const { buildPatientSyncStatusMap } = await import('@/src/screens/PatientList');
    const statuses = buildPatientSyncStatusMap(await listOfflineQueue());

    expect(statuses['pat-without-queue-entry']).toBeUndefined();
  });
});

