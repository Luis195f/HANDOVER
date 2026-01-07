import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { describe, it, vi, beforeEach } from 'vitest';

import HandoverForm from '@/src/screens/HandoverForm';

const buildHandoverBundleMock = vi.fn();

const imagePickerMock = vi.hoisted(() => ({
  requestMediaLibraryPermissionsAsync: vi.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: vi.fn(async () => ({ canceled: true })),
  MediaTypeOptions: { Images: 'Images' },
}));

const documentPickerMock = vi.hoisted(() => ({
  getDocumentAsync: vi.fn(async () => ({
    canceled: false,
    assets: [
      {
        uri: 'file://mock.pdf',
        name: 'mock.pdf',
        size: 2048,
        mimeType: 'application/pdf',
      },
    ],
  })),
}));

vi.mock('expo-image-picker', () => imagePickerMock);
vi.mock('expo-document-picker', () => documentPickerMock);

vi.mock('@/src/lib/fhir-map', () => ({
  buildHandoverBundle: (...args: unknown[]) => buildHandoverBundleMock(...args),
}));

vi.mock('@/src/lib/queue', () => ({
  enqueueBundle: vi.fn(),
}));

vi.mock('@/src/security/acl', () => ({
  ensureUnitAccess: vi.fn(),
}));

vi.mock('@/src/security/auth', () => ({
  useAuth: () => ({
    session: { user: { id: 'nurse-1', name: 'Nurse Jane' } },
    logout: vi.fn(),
  }),
  getSession: vi.fn(async () => ({ user: { id: 'nurse-1', name: 'Nurse Jane' } })),
}));

vi.mock('@/src/state/filterStore', () => ({
  ALL_UNITS_OPTION: 'ALL',
  useSelectedUnitId: () => 'unit-store',
}));

vi.mock('@/src/hooks/usePatientSummary', () => ({
  usePatientSummary: () => ({ loading: false, error: null, summary: { id: 'pat-1', name: 'Test' } }),
}));

vi.mock('@/src/components/AudioAttach', () => ({
  default: () => null,
}));

vi.mock('@/src/screens/components/SpecificCareSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/ClinicalScalesSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/ExportPdfButton', () => ({ ExportPdfButton: () => null }));

vi.mock('@/src/config/flags', () => ({
  isOn: (flag: string) => flag === 'SHOW_ATTACH',
}));

vi.mock('@/src/lib/news2', () => ({
  computeNEWS2: () => ({ total: 0, anyThree: false, band: 'low' }),
}));

describe('HandoverForm attachments', () => {
  beforeEach(() => {
    buildHandoverBundleMock.mockReset();
    documentPickerMock.getDocumentAsync.mockClear();
  });

  it('renderiza y permite agregar y eliminar adjuntos', async () => {
    const navigation = {
      navigate: vi.fn(),
      goBack: vi.fn(),
      getState: vi.fn(() => ({ routeNames: ['QRScan'] })),
    } as any;

    const route = {
      key: 'handover',
      name: 'HandoverForm' as const,
      params: {
        patientId: 'pat-001',
        unitId: 'icu-west',
        specialtyId: 'cardio',
      },
    } as const;

    render(<HandoverForm navigation={navigation} route={route} />);

    fireEvent.press(screen.getByText('Adjuntar PDF'));

    await waitFor(() => {
      expect(screen.getByText('mock.pdf')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('Eliminar'));

    await waitFor(() => {
      expect(screen.queryByText('mock.pdf')).toBeNull();
    });
  });
});
