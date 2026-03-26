import { beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {},
    },
  },
}));

describe('pilotControl', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.EXPO_PUBLIC_HANDOVER_DEPLOYMENT_MODE;
    delete process.env.EXPO_PUBLIC_HANDOVER_PILOT_CONTROL_JSON;
    delete process.env.EXPO_PUBLIC_ENABLE_ICEA_BRIDGE;
    delete process.env.EXPO_PUBLIC_ENABLE_ICEA_PATIENT_RISK;
    delete process.env.EXPO_PUBLIC_SHOW_NIC_CODING;
    delete process.env.EXPO_PUBLIC_SHOW_NOC_OUTCOMES;
    delete process.env.EXPO_PUBLIC_AI_SUGGESTIONS_ENABLED;
  });

  it('keeps patient risk disabled in explicit ICEA shadow mode', async () => {
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
    expect(state.shadowMode).toBe(true);
    expect(state.denialReason).toBe('shadow_mode');
  });

  it('supports unit-scoped governed NNN rollout without affecting other units', async () => {
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

    expect(resolvePilotFeatureState('governed_nnn', { unitId: 'ward-a' }).enabled).toBe(true);
    expect(resolvePilotFeatureState('governed_nnn', { unitId: 'ward-b' }).enabled).toBe(false);
    expect(resolvePilotFeatureState('governed_nnn', { unitId: 'ward-b' }).denialReason).toBe('unit_out_of_scope');
  });

  it('forces ICEA pause semantics into shadow and disables clinical ICEA surfaces', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_DEPLOYMENT_MODE = 'pilot';
    process.env.EXPO_PUBLIC_ENABLE_ICEA_BRIDGE = 'true';
    process.env.EXPO_PUBLIC_ENABLE_ICEA_PATIENT_RISK = 'true';
    process.env.EXPO_PUBLIC_HANDOVER_PILOT_CONTROL_JSON = JSON.stringify({
      pilotMode: 'enabled',
      rolloutStatus: 'pause',
      features: {
        icea_bridge: {
          mode: 'enabled',
          enabledUnits: ['icu-a'],
        },
        icea_patient_risk: {
          mode: 'enabled',
          enabledUnits: ['icu-a'],
          allowedRoles: ['nurse'],
        },
      },
    });

    const { resolvePilotFeatureState } = await import('../pilotControl');

    expect(resolvePilotFeatureState('icea_bridge', { unitId: 'icu-a' }).enabled).toBe(true);
    expect(resolvePilotFeatureState('icea_bridge', { unitId: 'icu-a' }).shadowMode).toBe(true);
    expect(resolvePilotFeatureState('icea_patient_risk', { unitId: 'icu-a', roles: ['nurse'] }).enabled).toBe(false);
    expect(resolvePilotFeatureState('icea_patient_risk', { unitId: 'icu-a', roles: ['nurse'] }).denialReason).toBe('rollout_paused');
  });

  it('disables pilot features on rollout no-go', async () => {
    process.env.EXPO_PUBLIC_HANDOVER_DEPLOYMENT_MODE = 'production';
    process.env.EXPO_PUBLIC_SHOW_NIC_CODING = 'true';
    process.env.EXPO_PUBLIC_SHOW_NOC_OUTCOMES = 'true';
    process.env.EXPO_PUBLIC_HANDOVER_PILOT_CONTROL_JSON = JSON.stringify({
      pilotMode: 'enabled',
      rolloutStatus: 'no-go',
      features: {
        governed_nnn: {
          mode: 'enabled',
        },
      },
    });

    const { resolvePilotFeatureState } = await import('../pilotControl');
    const state = resolvePilotFeatureState('governed_nnn', { unitId: 'icu-a' });

    expect(state.enabled).toBe(false);
    expect(state.denialReason).toBe('rollout_no_go');
  });
});
