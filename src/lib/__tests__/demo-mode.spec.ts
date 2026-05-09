import { describe, expect, it, vi } from 'vitest';

import { apiGet } from '@/src/lib/api';
import { fetchWithRetry } from '@/src/lib/net';
import { buildDemoResponse } from '@/src/demo/mock-api';

// IMPORTANTE:
// apiGet ahora llama ensureFreshAccessToken() antes de hacer requests.
// Este test mockeaba auth pero no incluía ese export, causando fallo.
vi.mock('@/src/security/auth', () => ({
  getCurrentSession: vi.fn(async () => ({ mode: 'demo' })),
  // Para compatibilidad con la nueva capa de "fresh token" antes de llamadas HTTP
  ensureFreshAccessToken: vi.fn(async () => 'test-access-token'),
  // Si en algún punto se importa el alias/función antigua, también lo cubrimos
  ensureFreshToken: vi.fn(async () => 'test-access-token'),
}));

describe('Demo mode network interception', () => {
  it('intercepta fetchWithRetry en modo demo', async () => {
    const fetchSpy = vi.fn();

    const res = await fetchWithRetry('https://demo.hospital/api/ping', { fetchImpl: fetchSpy });
    const body = await res.json();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(body).toMatchObject({ mode: 'demo' });
  });

  it('intercepta apiGet y devuelve datos mock', async () => {
    const data = await apiGet('/api/ping');
    expect(data).toMatchObject({ mode: 'demo' });
  });

  it('expone los tres recorridos psiquiatricos sinteticos solo en demo mode', async () => {
    const response = await buildDemoResponse('https://demo.hospital/api/patients');
    const body = await response?.json();

    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'demo-psych-adult-001', unitId: 'sjd-a' }),
        expect.objectContaining({ id: 'demo-psych-child-001', unitId: 'sjd-infanto' }),
        expect.objectContaining({ id: 'demo-psych-udcc-001', unitId: 'udcc-psychogeriatrics' }),
      ]),
    );
    expect(body).toHaveLength(3);
  });

  it('resuelve el detalle FHIR demo por patientId sin mezclar los casos sinteticos', async () => {
    const patientResponse = await buildDemoResponse('https://demo.hospital/fhir/Patient/demo-psych-child-001');
    const encounterResponse = await buildDemoResponse(
      'https://demo.hospital/fhir/Encounter?subject=Patient/demo-psych-udcc-001&_include=Encounter:location',
    );

    const patientBody = await patientResponse?.json();
    const encounterBody = await encounterResponse?.json();

    expect(patientBody).toMatchObject({
      id: 'demo-psych-child-001',
      name: [expect.objectContaining({ text: 'Caso sintetico infanto' })],
    });
    expect(encounterBody).toMatchObject({
      entry: [
        expect.objectContaining({
          resource: expect.objectContaining({
            resourceType: 'Encounter',
            subject: expect.objectContaining({ reference: 'Patient/demo-psych-udcc-001' }),
          }),
        }),
        expect.objectContaining({
          resource: expect.objectContaining({
            resourceType: 'Location',
            identifier: [expect.objectContaining({ value: 'UDCC-03' })],
          }),
        }),
      ],
    });
  });
});
