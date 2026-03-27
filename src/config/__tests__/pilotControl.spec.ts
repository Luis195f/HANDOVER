import { beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };
const mockState = vi.hoisted(() => ({
  apiGet: vi.fn(),
}));

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {},
    },
  },
}));
vi.mock('@/src/lib/api', () => ({
  apiGet: mockState.apiGet,
}));

describe('pilotControl', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.EXPO_PUBLIC_HANDOVER_DEPLOYMENT_MODE;
    delete process.env.EXPO_PUBLIC_HANDOVER_PILOT_CONTROL_JSON;
    delete process.env.EXPO_PUBLIC_ENABLE_ICEA_BRIDGE;
    delete process.env.EXPO_PUBLIC_ENABLE_ICEA_PATIENT_RISK;
    delete process.env.EXPO_PUBLIC_ENABLE_ICEA_IMMEDIATE_SCORING;
    delete process.env.EXPO_PUBLIC_ENABLE_ICEA_ENRICHED_SCORING;
    delete process.env.EXPO_PUBLIC_SHOW_NIC_CODING;
    delete process.env.EXPO_PUBLIC_SHOW_NOC_OUTCOMES;
    delete process.env.EXPO_PUBLIC_AI_SUGGESTIONS_ENABLED;
  });

  it('keeps patient risk disabled in explicit ICEA shadow mode when backend is unavailable', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_DEPLOYMENT_MODE = 'pilot';
    process.env.EXPO_PUBLIC_ENABLE_ICEA_BRIDGE = 'true';
    process.env.EXPO_PUBLIC_ENABLE_ICEA_PATIENT_RISK = 'true';
    process.env.EXPO_PUBLIC_HANDOVER_PILOT_CONTROL_JSON = JSON.stringify({
      explicitShadowModeForIcea: true,
      features: {
        icea_patient_risk: {
          mode: 'pilot',
          enabledUnits: ['icu-a'],
          allowedRoles: ['nurse', 'supervisor', 'admin'],
          environmentScope: ['pilot', 'test'],
        },
      },
    });

    const { resolvePilotFeatureState } = await import('../pilotControl');
    const state = resolvePilotFeatureState('icea_patient_risk', {
      unitId: 'icu-a',
      roles: ['nurse'],
    });

    expect(state.enabled).toBe(false);
    expect(state.shadow).toBe(true);
    expect(state.denialReason).toBe('shadow_mode');
    expect(state.source).toBe('fallback');
  });

  it('keeps governed NNN disabled until backend confirms the effective state', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_DEPLOYMENT_MODE = 'pilot';
    process.env.EXPO_PUBLIC_SHOW_NIC_CODING = 'true';
    process.env.EXPO_PUBLIC_SHOW_NOC_OUTCOMES = 'true';
    process.env.EXPO_PUBLIC_HANDOVER_PILOT_CONTROL_JSON = JSON.stringify({
      features: {
        governed_nnn: {
          mode: 'pilot',
          enabledUnits: ['ward-a'],
          environmentScope: ['pilot'],
        },
      },
    });

    const { resolvePilotFeatureState } = await import('../pilotControl');

    expect(resolvePilotFeatureState('governed_nnn', { unitId: 'ward-a' }).enabled).toBe(false);
    expect(resolvePilotFeatureState('governed_nnn', { unitId: 'ward-a' }).denialReason).toBe('backend_unavailable');
    expect(resolvePilotFeatureState('governed_nnn', { unitId: 'ward-b' }).enabled).toBe(false);
    expect(resolvePilotFeatureState('governed_nnn', { unitId: 'ward-b' }).denialReason).toBe('unit_out_of_scope');
  });

  it('uses the backend feature endpoint as the primary source of truth', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_DEPLOYMENT_MODE = 'pilot';
    process.env.EXPO_PUBLIC_ENABLE_ICEA_PATIENT_RISK = 'true';
    process.env.EXPO_PUBLIC_HANDOVER_PILOT_CONTROL_JSON = JSON.stringify({
      features: {
        icea_patient_risk: {
          mode: 'pilot',
          enabledUnits: ['icu-a'],
          allowedRoles: ['nurse'],
        },
      },
    });
    mockState.apiGet.mockResolvedValue({
      generatedAt: '2026-03-27T10:00:00Z',
      requestedContext: {
        unitId: 'icu-a',
        roles: ['nurse'],
      },
      features: {
        icea_bridge: { enabled: false, shadow: true, pilotMode: 'pilot', mode: 'shadow', denialReason: null },
        icea_immediate_scoring: { enabled: false, shadow: true, pilotMode: 'pilot', mode: 'shadow', denialReason: null },
        icea_enriched_scoring: { enabled: false, shadow: true, pilotMode: 'pilot', mode: 'shadow', denialReason: null },
        icea_patient_risk: { enabled: false, shadow: false, pilotMode: 'pilot', mode: 'disabled', denialReason: 'pilot_control_disabled' },
        governed_nnn: { enabled: false, shadow: false, pilotMode: 'pilot', mode: 'disabled', denialReason: 'pilot_control_disabled' },
        admin_analytics: { enabled: false, shadow: true, pilotMode: 'pilot', mode: 'shadow', denialReason: 'role_out_of_scope' },
        ai_suggestions: { enabled: false, shadow: false, pilotMode: 'pilot', mode: 'disabled', denialReason: 'pilot_control_disabled' },
      },
    });

    const { refreshPilotControlContext, resolvePilotFeatureState } = await import('../pilotControl');
    await refreshPilotControlContext({ unitId: 'icu-a', roles: ['nurse'] });

    const state = resolvePilotFeatureState('icea_patient_risk', {
      unitId: 'icu-a',
      roles: ['nurse'],
    });

    expect(mockState.apiGet).toHaveBeenCalledWith('/api/pilot-control/features?unitId=icu-a');
    expect(state.enabled).toBe(false);
    expect(state.mode).toBe('disabled');
    expect(state.denialReason).toBe('pilot_control_disabled');
    expect(state.source).toBe('backend');
  });

  it('rejects invalid endpoint payloads and falls back conservatively', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_DEPLOYMENT_MODE = 'production';
    process.env.EXPO_PUBLIC_SHOW_NIC_CODING = 'true';
    process.env.EXPO_PUBLIC_SHOW_NOC_OUTCOMES = 'true';
    mockState.apiGet.mockResolvedValue({
      features: {
        icea_bridge: { enabled: true, pilotMode: 'enabled', mode: 'enabled', denialReason: null, shadowMode: false },
      },
    });

    const { refreshPilotControlContext, resolvePilotFeatureState } = await import('../pilotControl');
    await refreshPilotControlContext({ unitId: 'icu-a', roles: ['nurse'] });
    const state = resolvePilotFeatureState('governed_nnn', { unitId: 'icu-a', roles: ['nurse'] });

    expect(state.enabled).toBe(false);
    expect(state.denialReason).toBe('backend_unavailable');
    expect(state.source).toBe('fallback');
  });

  it('maps canonical backend shadow naming into frontend state and keeps the shape stable', async () => {
    mockState.apiGet.mockResolvedValue({
      generatedAt: '2026-03-27T10:00:00Z',
      requestedContext: {
        unitId: 'icu-a',
        roles: ['nurse'],
      },
      features: {
        icea_bridge: { enabled: true, shadow: true, pilotMode: 'pilot', mode: 'shadow', denialReason: null },
        icea_immediate_scoring: { enabled: false, shadow: true, pilotMode: 'pilot', mode: 'shadow', denialReason: null },
        icea_enriched_scoring: { enabled: false, shadow: true, pilotMode: 'pilot', mode: 'shadow', denialReason: null },
        icea_patient_risk: { enabled: false, shadow: true, pilotMode: 'pilot', mode: 'pilot', denialReason: 'rollout_paused' },
        governed_nnn: { enabled: true, shadow: false, pilotMode: 'pilot', mode: 'pilot', denialReason: null },
        admin_analytics: { enabled: false, shadow: true, pilotMode: 'pilot', mode: 'shadow', denialReason: 'role_out_of_scope' },
        ai_suggestions: { enabled: false, shadow: false, pilotMode: 'pilot', mode: 'disabled', denialReason: 'pilot_control_disabled' },
      },
    });

    const { refreshPilotControlContext, resolvePilotFeatureState } = await import('../pilotControl');
    await refreshPilotControlContext({ unitId: 'icu-a', roles: ['nurse'] });

    const state = resolvePilotFeatureState('icea_bridge', { unitId: 'icu-a', roles: ['nurse'] });

    expect(state.shadow).toBe(true);
    expect(state.pilotMode).toBe('pilot');
    expect(state.mode).toBe('shadow');
    expect(state.source).toBe('backend');
  });

  it('does not share cached backend state across different role sets in the same unit', async () => {
    mockState.apiGet
      .mockResolvedValueOnce({
        generatedAt: '2026-03-27T10:00:00Z',
        requestedContext: {
          unitId: 'icu-a',
          roles: ['admin'],
        },
        features: {
          icea_bridge: { enabled: true, shadow: true, pilotMode: 'pilot', mode: 'shadow', denialReason: null },
          icea_immediate_scoring: { enabled: false, shadow: true, pilotMode: 'pilot', mode: 'shadow', denialReason: null },
          icea_enriched_scoring: { enabled: false, shadow: true, pilotMode: 'pilot', mode: 'shadow', denialReason: null },
          icea_patient_risk: { enabled: false, shadow: false, pilotMode: 'pilot', mode: 'disabled', denialReason: 'pilot_control_disabled' },
          governed_nnn: { enabled: false, shadow: false, pilotMode: 'pilot', mode: 'disabled', denialReason: 'pilot_control_disabled' },
          admin_analytics: { enabled: true, shadow: false, pilotMode: 'pilot', mode: 'enabled', denialReason: null },
          ai_suggestions: { enabled: false, shadow: false, pilotMode: 'pilot', mode: 'disabled', denialReason: 'pilot_control_disabled' },
        },
      })
      .mockRejectedValueOnce(new Error('network down'));

    const { refreshPilotControlContext, resolvePilotFeatureState } = await import('../pilotControl');

    await refreshPilotControlContext({ unitId: 'icu-a', roles: ['admin'] });
    const adminState = resolvePilotFeatureState('admin_analytics', {
      unitId: 'icu-a',
      roles: ['admin'],
    });
    expect(adminState.enabled).toBe(true);
    expect(adminState.source).toBe('backend');

    await refreshPilotControlContext({ unitId: 'icu-a', roles: ['nurse'] });
    const nurseState = resolvePilotFeatureState('admin_analytics', {
      unitId: 'icu-a',
      roles: ['nurse'],
    });
    expect(nurseState.enabled).toBe(false);
    expect(nurseState.source).toBe('fallback');
    expect(nurseState.denialReason).toBe('role_out_of_scope');

    expect(mockState.apiGet).toHaveBeenCalledTimes(2);
    expect(mockState.apiGet).toHaveBeenNthCalledWith(1, '/api/pilot-control/features?unitId=icu-a');
    expect(mockState.apiGet).toHaveBeenNthCalledWith(2, '/api/pilot-control/features?unitId=icu-a');
  });

  it('never exposes admin analytics to nurse via cached admin state contamination', async () => {
    mockState.apiGet
      .mockResolvedValueOnce({
        generatedAt: '2026-03-27T10:00:00Z',
        requestedContext: {
          unitId: 'icu-a',
          roles: ['admin'],
        },
        features: {
          icea_bridge: { enabled: true, shadow: true, pilotMode: 'pilot', mode: 'shadow', denialReason: null },
          icea_immediate_scoring: { enabled: false, shadow: true, pilotMode: 'pilot', mode: 'shadow', denialReason: null },
          icea_enriched_scoring: { enabled: false, shadow: true, pilotMode: 'pilot', mode: 'shadow', denialReason: null },
          icea_patient_risk: { enabled: false, shadow: false, pilotMode: 'pilot', mode: 'disabled', denialReason: 'pilot_control_disabled' },
          governed_nnn: { enabled: false, shadow: false, pilotMode: 'pilot', mode: 'disabled', denialReason: 'pilot_control_disabled' },
          admin_analytics: { enabled: true, shadow: false, pilotMode: 'pilot', mode: 'enabled', denialReason: null },
          ai_suggestions: { enabled: false, shadow: false, pilotMode: 'pilot', mode: 'disabled', denialReason: 'pilot_control_disabled' },
        },
      });

    const { refreshPilotControlContext, resolvePilotFeatureState } = await import('../pilotControl');

    await refreshPilotControlContext({ unitId: 'icu-a', roles: ['admin'] });
    const nurseState = resolvePilotFeatureState('admin_analytics', {
      unitId: 'icu-a',
      roles: ['nurse'],
    });

    expect(nurseState.enabled).toBe(false);
    expect(nurseState.source).toBe('fallback');
  });

  it('treats the same role set with different order as the same cache key', async () => {
    mockState.apiGet.mockResolvedValue({
      generatedAt: '2026-03-27T10:00:00Z',
      requestedContext: {
        unitId: 'icu-a',
        roles: ['admin', 'supervisor'],
      },
      features: {
        icea_bridge: { enabled: true, shadow: true, pilotMode: 'pilot', mode: 'shadow', denialReason: null },
        icea_immediate_scoring: { enabled: false, shadow: true, pilotMode: 'pilot', mode: 'shadow', denialReason: null },
        icea_enriched_scoring: { enabled: false, shadow: true, pilotMode: 'pilot', mode: 'shadow', denialReason: null },
        icea_patient_risk: { enabled: false, shadow: false, pilotMode: 'pilot', mode: 'disabled', denialReason: 'pilot_control_disabled' },
        governed_nnn: { enabled: false, shadow: false, pilotMode: 'pilot', mode: 'disabled', denialReason: 'pilot_control_disabled' },
        admin_analytics: { enabled: true, shadow: false, pilotMode: 'pilot', mode: 'enabled', denialReason: null },
        ai_suggestions: { enabled: false, shadow: false, pilotMode: 'pilot', mode: 'disabled', denialReason: 'pilot_control_disabled' },
      },
    });

    const { refreshPilotControlContext, resolvePilotFeatureState } = await import('../pilotControl');

    await refreshPilotControlContext({ unitId: 'icu-a', roles: ['supervisor', 'admin', 'admin'] });

    const state = resolvePilotFeatureState('admin_analytics', {
      unitId: 'icu-a',
      roles: ['admin', 'supervisor'],
    });

    expect(state.enabled).toBe(true);
    expect(state.source).toBe('backend');
    expect(mockState.apiGet).toHaveBeenCalledTimes(1);
  });

  it('keeps the conservative fallback intact when the endpoint request fails', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_DEPLOYMENT_MODE = 'production';
    process.env.EXPO_PUBLIC_HANDOVER_PILOT_CONTROL_JSON = JSON.stringify({
      features: {
        admin_analytics: {
          mode: 'enabled',
        },
      },
    });
    mockState.apiGet.mockRejectedValue(new Error('pilot-control unavailable'));

    const { refreshPilotControlContext, resolvePilotFeatureState } = await import('../pilotControl');

    await refreshPilotControlContext({ unitId: 'icu-a', roles: ['nurse'] });
    const state = resolvePilotFeatureState('admin_analytics', {
      unitId: 'icu-a',
      roles: ['nurse'],
    });

    expect(state.enabled).toBe(false);
    expect(state.source).toBe('fallback');
    expect(state.denialReason).toBe('role_out_of_scope');
  });
});
