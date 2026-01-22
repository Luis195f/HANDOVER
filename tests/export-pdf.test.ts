import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as FileSystem from 'expo-file-system';
import * as Print from 'expo-print';

import type { HandoverValues } from '../src/types/handover';
import type { HandoverSession } from '../src/security/auth-types';
import { generateHandoverPdf } from '../src/lib/export/export-pdf';

const mockHandover: HandoverValues & { id: string } = {
  id: 'handover-123',
  administrativeData: {
    unit: 'UCI Adulto',
    census: 0,
    staffIn: [],
    staffOut: [],
    shiftStart: '2025-11-21T07:00:00Z',
    shiftEnd: '2025-11-21T15:00:00Z',
    shiftType: 'Mañana',
    incidents: [],
  },
  patientId: 'patient-1',
  bedsideChecklist: {
    patientIdentityConfirmed: true,
    allergiesReviewed: true,
    linesAndDevicesChecked: false,
    medicationPlanReviewed: false,
    safetyMeasuresApplied: false,
    questionsAnswered: false,
  },
};
const mockUser: HandoverSession = {
  userId: 'user-1',
  displayName: 'Dr. Supervisor',
  roles: ['supervisor'],
  units: [],
  accessToken: 'token',
};

describe('generateHandoverPdf', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Print, 'printToFileAsync').mockResolvedValue({
      uri: 'file:///tmp/original.pdf',
    } as Print.PrintToFileResponse);
    vi.spyOn(FileSystem, 'moveAsync').mockResolvedValue();
    (FileSystem as typeof FileSystem & { documentDirectory: string }).documentDirectory = 'file:///docs/';
  });

  it('genera un PDF y devuelve metadatos básicos', async () => {
    const pdf = await generateHandoverPdf(mockHandover, mockUser);

    expect(pdf.uri.startsWith('file:///docs/')).toBe(true);
    expect(pdf.name.endsWith('.pdf')).toBe(true);
    expect(pdf.author).toBe(mockUser.displayName);
    expect(pdf.mimeType).toBe('application/pdf');
  });
});
