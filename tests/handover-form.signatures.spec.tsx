import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import HandoverForm from '@/src/screens/HandoverForm';

const enqueueBundle = vi.fn();
const buildHandoverBundle = vi.fn();
const ensureUnitAccess = vi.fn();
const mockSession = {
  userId: 'nurse-1',
  displayName: 'Nurse One',
  roles: ['nurse'],
  units: ['unit-1'],
  user: { id: 'nurse-1', name: 'Nurse One', unitId: 'unit-1' },
};

vi.mock('@/src/config/flags', () => ({ isOn: () => false }));
vi.mock('@/src/state/filterStore', () => ({ useSelectedUnitId: () => 'unit-1', ALL_UNITS_OPTION: '__all__' }));
vi.mock('@/src/security/auth', () => ({
  useAuth: () => ({ session: mockSession, loading: false, loginWithOAuth: vi.fn(), logout: vi.fn() }),
  getSession: vi.fn(async () => mockSession),
}));
vi.mock('@/src/security/acl', () => ({ ensureUnitAccess: (...args: unknown[]) => ensureUnitAccess(...args) }));
vi.mock('@/src/lib/queue', () => ({ enqueueBundle: (...args: unknown[]) => enqueueBundle(...args) }));
vi.mock('@/src/lib/fhir-map', () => ({ buildHandoverBundle: (...args: unknown[]) => buildHandoverBundle(...args) }));
vi.mock('@/src/lib/audit', () => ({
  createAsyncStorageAuditStorage: () => ({ type: 'mock' }),
  appendAuditEvent: vi.fn(),
  makeAuditEvent: vi.fn(),
}));
vi.mock('@/src/lib/stt', () => ({
  createSttService: () => ({
    start: vi.fn(),
    stop: vi.fn(),
    getStatus: () => 'idle',
    getLastError: () => null,
    setListener: vi.fn(),
  }),
}));
vi.mock('@/src/screens/components/SpecificCareSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/ClinicalScalesSection', () => ({ default: () => null }));
vi.mock('@/src/components/AudioAttach', () => ({ default: () => null }));
vi.mock('@/src/screens/components/ExportPdfButton', () => ({
  ExportPdfButton: ({ onBeforeExport }: { onBeforeExport?: () => Promise<boolean> }) => {
    onBeforeExport?.();
    return null;
  },
}));

describe('HandoverForm signatures', () => {
  beforeEach(() => {
    enqueueBundle.mockReset();
    buildHandoverBundle.mockReset();
    ensureUnitAccess.mockReset();
    mockSession.roles = ['nurse'];
  });

  it('permite que una enfermera saliente firme', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation((_, __, buttons) => {
      const confirm = Array.isArray(buttons) ? buttons.find((b) => b.text === 'Confirmar') : null;
      confirm?.onPress?.();
      return 0;
    });

    const { getByText, queryByText } = render(
      <HandoverForm navigation={{ navigate: vi.fn() } as any} route={{ key: '1', name: 'HandoverForm', params: { patientId: 'P1', unitId: 'unit-1' } } as any} />,
    );

    expect(getByText('Firmar como enfermera saliente')).toBeTruthy();
    fireEvent.press(getByText('Firmar como enfermera saliente'));

    await waitFor(() => {
      expect(queryByText('Nombre: Nurse One')).toBeTruthy();
    });

    alertSpy.mockRestore();
  });

  it('no muestra botón de firma para roles no autorizados', () => {
    mockSession.roles = ['admin'];
    const { queryByText } = render(
      <HandoverForm navigation={{ navigate: vi.fn() } as any} route={{ key: '2', name: 'HandoverForm', params: { patientId: 'P1', unitId: 'unit-1' } } as any} />,
    );

    expect(queryByText('Firmar como enfermera saliente')).toBeNull();
  });

  it('bloquea finalización sin firma saliente', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert').mockImplementation(() => 0);

    const { getByText } = render(
      <HandoverForm navigation={{ navigate: vi.fn() } as any} route={{ key: '3', name: 'HandoverForm', params: { patientId: 'P1', unitId: 'unit-1' } } as any} />,
    );

    fireEvent.press(getByText('Finalizar entrega'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Falta firma',
        'Para finalizar la entrega falta la firma de enfermera saliente.',
      );
    });
    expect(buildHandoverBundle).not.toHaveBeenCalled();

    alertSpy.mockRestore();
  });
});
