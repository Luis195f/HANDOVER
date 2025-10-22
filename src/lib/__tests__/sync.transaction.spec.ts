import { describe, it, expect } from 'vitest';
import { buildTransactionBundleForQueue } from '@/src/lib/sync';

describe('buildTransactionBundleForQueue (FHIR R4 transaction)', () => {
  const NOW = '2025-10-19T12:00:00Z';

  const input = {
    patientId: 'pat-001',
    vitals: { rr: 18, hr: 80, sbp: 120, temp: 37.1, spo2: 96, o2: true },
    shiftStart: '2025-10-19T08:00:00Z',
  };

  it('construye Bundle type=transaction con Patient interno y Observations con conditional create', () => {
    const bundle = buildTransactionBundleForQueue(input, { now: NOW });

    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('transaction');
    expect(Array.isArray(bundle.entry)).toBe(true);

    const patientEntry = bundle.entry[0];
    expect(patientEntry.resource.resourceType).toBe('Patient');
    expect(patientEntry.fullUrl).toBe('urn:uuid:patient-pat-001');
    expect(patientEntry.request.method).toBe('POST');
    expect(patientEntry.request.url).toBe('Patient');
    expect(String(patientEntry.request.ifNoneExist)).toContain('identifier=urn%3Ahandover-pro%3Aids|pat-001');

    const obsEntries = bundle.entry.filter((e: any) => e?.resource?.resourceType === 'Observation');
    expect(obsEntries.length).toBeGreaterThan(0);

    for (const e of obsEntries) {
      const r = e.resource;
      const q = String(e.request?.ifNoneExist || '');

      expect(e.request?.method).toBe('POST');
      expect(e.request?.url).toBe('Observation');
      expect(q).toContain('identifier=urn%3Ahandover-pro%3Aobs|');
      expect(q).toContain('patient=urn%3Auuid%3Apatient-pat-001');
      expect(q).toMatch(/code=http%3A%2F%2Floinc\.org\|[0-9\-]+/);
      expect(q).toMatch(/effective=eq2025-10-19/);

      expect(r.subject?.reference).toBe('urn:uuid:patient-pat-001');
    }
  });
});
