import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  hasUnitAccess: vi.fn(),
}));

vi.mock('@/src/security/acl', () => ({
  ensureUnitAccess: vi.fn(),
  hasRole: vi.fn(() => false),
  hasUnitAccess: mocked.hasUnitAccess,
}));

describe('PatientList deny-first authz seam', () => {
  beforeEach(() => {
    mocked.hasUnitAccess.mockReset();
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

  it('keeps patient-risk enabled for allowed all-units access only when the role is privileged', async () => {
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
    expect(supervisorState.canQueryIceaPatientRisk).toBe(true);
  });
});
