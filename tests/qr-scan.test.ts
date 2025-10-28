import { describe, expect, it, vi } from 'vitest';

import { extractPatientId, handleScanResult } from '@/src/screens/qrScan.utils';

describe('extractPatientId', () => {
  it('detecta Patient/{id} en texto o URL', () => {
    expect(extractPatientId('Patient/12345')).toBe('12345');
    expect(extractPatientId('https://server/fhir/Patient/pat-001')).toBe('pat-001');
  });

  it('lee JSON FHIR Patient', () => {
    const json = JSON.stringify({ resourceType: 'Patient', id: 'pat-json' });
    expect(extractPatientId(json)).toBe('pat-json');
  });

  it('lee Bundle con entrada Patient', () => {
    const bundle = JSON.stringify({
      resourceType: 'Bundle',
      entry: [
        { resource: { resourceType: 'Observation', id: 'obs-1' } },
        { resource: { resourceType: 'Patient', id: 'pat-bundle' } },
      ],
    });
    expect(extractPatientId(bundle)).toBe('pat-bundle');
  });

  it('extrae PID-3 de HL7v2', () => {
    const hl7 =
      'MSH|^~\\&|HOSP|RAD|||202001011200||ADT^A01|123|P|2.5\nPID|1||123456^^^HOSP^MR||Doe^John||19800101';
    expect(extractPatientId(hl7)).toBe('123456');
  });

  it('devuelve null cuando no hay ID', () => {
    expect(extractPatientId('texto aleatorio')).toBeNull();
  });
});

describe('handleScanResult', () => {
  it('navega al detectar un patientId válido', () => {
    const navigate = vi.fn();
    const onUnrecognized = vi.fn();

    const processed = handleScanResult({
      data: 'Patient/valid-id',
      navigate,
      onUnrecognized,
    });

    expect(processed).toBe(true);
    expect(navigate).toHaveBeenCalledWith('valid-id');
    expect(onUnrecognized).not.toHaveBeenCalled();
  });

  it('llama onUnrecognized cuando no se detecta ID', () => {
    const navigate = vi.fn();
    const onUnrecognized = vi.fn();

    const processed = handleScanResult({
      data: 'sin id',
      navigate,
      onUnrecognized,
    });

    expect(processed).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(onUnrecognized).toHaveBeenCalledTimes(1);
  });
});

