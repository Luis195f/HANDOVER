import React from 'react';
import { render } from '@testing-library/react-native';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { HandoverOverview } from '../HandoverOverview';

const originalEnv = { ...process.env };
const isOn = vi.fn<(name: string) => boolean>(() => true);

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: {
      extra: {},
    },
  },
}));

vi.mock('@/src/config/flags', () => ({
  isOn: (name: string) => isOn(name),
}));

const styles = {
  syncNotice: {},
  syncNoticeTitle: {},
  syncNoticeMessage: {},
  syncNoticeActions: {},
  syncNoticeCta: {},
  e2eControls: {},
  e2eTitle: {},
  e2eActions: {},
  profileCard: {},
  profileCardTitle: {},
  profileCardMeta: {},
};

describe('HandoverOverview', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON;
    delete process.env.HANDOVER_PROFILE_ACTIVATION_JSON;
    delete process.env.EXPO_PUBLIC_HANDOVER_UNITS_JSON;
    delete process.env.HANDOVER_UNITS_JSON;
    delete process.env.UNITS_CONFIG;
    isOn.mockReset();
    isOn.mockReturnValue(true);
  });

  it('lists explainable behavioral-health priorities without presenting a new scoring workflow', async () => {
    process.env.UNITS_CONFIG = JSON.stringify({
      units: [
        {
          id: 'psych-adult-a',
          name: 'Psiquiatria adulto demo',
          specialty: 'psych',
          profileId: 'behavioral-health',
        },
      ],
    });
    process.env.EXPO_PUBLIC_HANDOVER_PROFILE_ACTIVATION_JSON = JSON.stringify({
      unitProfiles: ['behavioral-health'],
    });

    const { resolveHandoverProfileRuntime } = await import('@/src/lib/profile-runtime');
    const profileRuntime = resolveHandoverProfileRuntime({ unitId: 'psych-adult-a', specialtyId: 'psych' });

    const screen = render(
      <HandoverOverview
        styles={styles}
        colors={{
          text: '#111827',
          primary: '#2563EB',
          danger: '#DC2626',
          success: '#059669',
          warning: '#D97706',
          info: '#0284C7',
        }}
        handoverSyncStatus="idle"
        handoverSyncError={null}
        syncSnapshot={{ status: 'idle' }}
        onRetrySync={() => {}}
        onOpenLogin={() => {}}
        onOpenSyncCenter={() => {}}
        isE2E={false}
        onSetFinalStatus={() => {}}
        onAddSignature={() => {}}
        onCompleteChecklist={() => {}}
        profileRuntime={profileRuntime}
        bannerSummary={null}
        bannerLoading={false}
        patientSummaryError={null}
      />,
    );

    expect(screen.getByText('Prioridades explicables de continuidad (MPAC prudente):')).toBeTruthy();
    expect(screen.getByText('- Continuidad del relevo explicitada para el siguiente turno')).toBeTruthy();
    expect(screen.getByText('- Riesgo de omision en medicacion, tratamiento, vigilancia o coordinacion visible')).toBeTruthy();
    expect(screen.getByText('- Observacion especial o acompanamiento explicitados')).toBeTruthy();
    expect(screen.getByText('- Evento de contencion trazable sin instrucciones operativas')).toBeTruthy();
  });
});
