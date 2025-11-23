import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getDefaultUnitConfig, getUnitConfig } from '@/src/lib/unitConfig';

const ORIGINAL_ENV = { ...process.env };

vi.mock('@/src/lib/hooks/useVitalTrends', () => ({
  useVitalTrends: () => ({ loading: false, error: null, data: [] }),
}));

vi.mock('@/src/config/flags', () => ({ isOn: () => false }));

vi.mock('@/src/lib/alerts', () => ({ computeAlerts: () => [] }));

vi.mock('@/src/lib/news2', () => ({ computeNEWS2: () => ({ total: 0, anyThree: false, band: 'low' }) }));

vi.mock('@/src/lib/stt', () => {
  const stub = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    addListener: () => () => undefined,
    getStatus: () => 'idle',
    getLastError: () => null,
  };
  return {
    createSttService: () => stub,
  };
});

vi.mock('@/src/lib/queue', () => ({ enqueueBundle: vi.fn() }));
vi.mock('@/src/lib/fhir-map', () => ({ buildHandoverBundle: vi.fn() }));
vi.mock('@/src/security/acl', () => ({ ensureUnitAccess: () => {} }));
vi.mock('@/src/components/AudioAttach', () => ({ default: () => null }));
vi.mock('@/src/screens/components/BedsideChecklistSection', () => ({
  BedsideChecklistSection: () => null,
}));
vi.mock('@/src/screens/components/SignaturesSection', () => ({
  SignaturesSection: () => null,
}));

afterEach(() => {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
  vi.unmock('expo-constants');
});

describe('unitConfig helpers', () => {
  it('returns pediatric unit configuration with flag', () => {
    const config = getUnitConfig('pediatria');
    expect(config?.features?.enablePediatricScales).toBe(true);
  });

  it('returns default unit configuration', () => {
    const config = getDefaultUnitConfig();
    expect(config.id).toBe('icu-adulto');
  });

  it('loads configuration from environment JSON', async () => {
    vi.resetModules();
    const customUnits = [
      { id: 'custom-1', name: 'Custom Unit', specialty: 'icu', default: true },
    ];
    process.env.HANDOVER_UNITS_JSON = JSON.stringify(customUnits);
    vi.doMock('expo-constants', () => ({
      default: { expoConfig: { extra: {} } },
    }));

    const { UNITS_CONFIG } = await import('@/src/config/unitsConfig');

    expect(UNITS_CONFIG).toHaveLength(1);
    expect(UNITS_CONFIG[0].id).toBe('custom-1');
  });
});

describe('HandoverForm unit config usage', () => {
  const renderForm = () => {
    const HandoverForm = require('@/src/screens/HandoverForm').default as typeof import('@/src/screens/HandoverForm').default;

    const navigation = {
      navigate: vi.fn(),
      goBack: vi.fn(),
      getState: vi.fn(() => ({ routeNames: [] })),
    } as any;

    const route = {
      key: 'handover',
      name: 'HandoverForm' as const,
      params: { patientId: 'patient-1', unitId: undefined, specialtyId: 'icu' },
    } as const;

    return render(<HandoverForm navigation={navigation} route={route} />);
  };

  it('falls back to default unit when the selected one does not exist', () => {
    const view = renderForm();

    expect(() => {
      view.getByText('Escalas clínicas');
    }).not.toThrow();
    expect(view.queryByText('TODO: Escalas pediátricas aquí')).toBeNull();
  });

  it('enables pediatric features when the unit is pediatrics', () => {
    const view = renderForm();

    const unitInput = view.getByPlaceholderText('UCI Adulto');
    fireEvent.changeText(unitInput, 'pediatria');

    expect(screen.getByText('TODO: Escalas pediátricas aquí')).toBeOnTheScreen();
  });
});
