import { describe, it, expect } from 'vitest';

import { buildHandoverHtml, type HandoverPdfContext } from '../src/lib/export/build-handover-html';

const mockHandover: HandoverPdfContext['handover'] = {
  id: 'handover-123',
  administrativeData: {
    unit: 'UCI Adulto',
    shiftStart: '2025-11-21T07:00:00Z',
    shiftEnd: '2025-11-21T15:00:00Z',
    census: 10,
    staffIn: [],
    staffOut: [],
  },
  patientId: 'patient-1',
  sbar: {
    situation: 'Paciente estable post cirugía.',
    background: 'Ingresó ayer desde urgencias.',
    assessment: 'Buena respuesta a tratamiento.',
    recommendation: 'Vigilar drenajes y diuresis.',
  },
};

const mockUser: HandoverPdfContext['user'] = {
  userId: 'user-1',
  username: 'sup1',
  displayName: 'Dr. Supervisor',
};

describe('buildHandoverHtml', () => {
  it('incluye secciones SBAR y firma simulada', () => {
    const html = buildHandoverHtml({
      handover: mockHandover,
      user: mockUser,
      generatedAt: '2025-11-21T10:00:00Z',
    });

    expect(html).toContain('Informe de Entrega de Turno');
    expect(html).toContain('Situation');
    expect(html).toContain(mockHandover.sbar.situation);
    expect(html).toContain('Firmado digitalmente (simulado) por');
    expect(html).toContain(mockUser.displayName);
  });
});
