import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HandoverForm from '@/src/screens/HandoverForm';
import { fetchInterventionsSuggestions } from '@/src/lib/ai-suggestions';

vi.mock('@/src/lib/ai-suggestions', () => ({
  fetchInterventionsSuggestions: vi.fn(),
}));
vi.mock('@/src/lib/fhir-map', () => ({ buildHandoverBundle: vi.fn() }));
vi.mock('@/src/lib/queue', () => ({ enqueueBundle: vi.fn() }));
vi.mock('@/src/config/flags', () => ({ isOn: () => true }));
vi.mock('@/src/components/AudioAttach', () => ({ default: () => null }));
vi.mock('@/src/lib/news2', () => ({ computeNEWS2: () => ({ total: 0, anyThree: false, band: 'low' }) }));
vi.mock('@/src/lib/hooks/useVitalTrends', () => ({ useVitalTrends: () => ({ loading: false, error: null, data: [] }) }));
vi.mock('@/src/hooks/usePatientSummary', () => ({ usePatientSummary: () => ({ loading: false, error: null, summary: null }) }));
vi.mock('@/src/lib/unitConfig', () => ({ getUnitConfig: () => null, getDefaultUnitConfig: () => ({ features: {} }) }));
vi.mock('@/src/security/acl', () => ({ ensureUnitAccess: () => undefined }));
vi.mock('@/src/security/auth', () => ({ useAuth: () => ({ session: null }), getSession: async () => ({ userId: 'nurse' }) }));
vi.mock('@/src/state/filterStore', () => ({ ALL_UNITS_OPTION: 'ALL', useSelectedUnitId: () => 'unit-store' }));

const fetchInterventionsSuggestionsMock = fetchInterventionsSuggestions as unknown as vi.Mock;

describe('HandoverForm - IA sugerencias', () => {
  beforeEach(() => {
    fetchInterventionsSuggestionsMock.mockReset();
  });

  const renderForm = () => {
    const navigation = {
      navigate: vi.fn(),
      goBack: vi.fn(),
      getState: vi.fn(() => ({ routeNames: ['QRScan'] })),
    } as any;

    const route = {
      key: 'handover-ia-suggestions',
      name: 'HandoverForm' as const,
      params: {
        patientId: 'pat-ia',
        unitId: 'icu',
        specialtyId: 'cardio',
      },
    } as const;

    return render(<HandoverForm navigation={navigation} route={route} />);
  };

  it('muestra sugerencias IA bajo demanda sin modificar campos', async () => {
    fetchInterventionsSuggestionsMock.mockResolvedValue({
      section: 'vitals',
      interventions: ['Oxigenoterapia de apoyo'],
      rationale: 'Saturación baja',
    });

    renderForm();

    fireEvent.press(screen.getByText('Ver sugerencias de intervenciones (IA)'));

    await waitFor(() => {
      expect(screen.getByText('Oxigenoterapia de apoyo')).toBeTruthy();
    });

    expect(fetchInterventionsSuggestionsMock).toHaveBeenCalled();
    expect(screen.queryByDisplayValue('Oxigenoterapia de apoyo')).toBeNull();
  });
});
