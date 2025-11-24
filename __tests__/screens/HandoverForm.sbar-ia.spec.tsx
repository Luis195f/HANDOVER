import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import HandoverForm from '@/src/screens/HandoverForm';
import { generateSbarViaBackend } from '@/src/lib/ai-sbar';

vi.mock('@/src/lib/ai-sbar', () => ({
  generateSbarViaBackend: vi.fn(),
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

const generateSbarViaBackendMock = generateSbarViaBackend as unknown as vi.Mock;

describe('HandoverForm - SBAR IA', () => {
  beforeEach(() => {
    generateSbarViaBackendMock.mockReset();
  });

  const renderForm = () => {
    const navigation = {
      navigate: vi.fn(),
      goBack: vi.fn(),
      getState: vi.fn(() => ({ routeNames: ['QRScan'] })),
    } as any;

    const route = {
      key: 'handover-ia',
      name: 'HandoverForm' as const,
      params: {
        patientId: 'pat-ia',
        unitId: 'icu',
        specialtyId: 'cardio',
      },
    } as const;

    return render(<HandoverForm navigation={navigation} route={route} />);
  };

  it('rellena los campos SBAR cuando la IA responde', async () => {
    generateSbarViaBackendMock.mockResolvedValue({
      situation: 'Situación AI',
      background: 'Antecedentes AI',
      assessment: 'Valoración AI',
      recommendation: 'Recomendación AI',
      fullText: 'SBAR completo AI',
    });

    renderForm();

    fireEvent.changeText(screen.getByPlaceholderText('Paciente'), 'pat-ia');
    fireEvent.changeText(screen.getByPlaceholderText('Unidad'), 'icu');
    fireEvent.changeText(screen.getByPlaceholderText('Notas de evolución'), 'Paciente estable');

    fireEvent.press(screen.getByText('Generar SBAR con IA'));

    await waitFor(() => {
      expect(screen.getByDisplayValue('Situación AI')).toBeTruthy();
      expect(screen.getByDisplayValue('Antecedentes AI')).toBeTruthy();
      expect(screen.getByDisplayValue('Valoración AI')).toBeTruthy();
      expect(screen.getByDisplayValue('Recomendación AI')).toBeTruthy();
    });

    expect(generateSbarViaBackendMock).toHaveBeenCalled();
  });
});
