import { describe, it, expect } from 'vitest';
import { buildHandoverBundle } from '../fhir-map';

const list = (b:any, rt:string) => (b.entry??[]).map((e:any)=>e.resource).filter((r:any)=>r?.resourceType===rt);

describe('Meds — validación y omisión de entradas vacías', () => {
  const patientId = 'pat-001';
  const now = '2025-10-21T19:20:00Z';

  it('omite meds vacíos y crea MedicationStatement sólo para los válidos', () => {
    const b = buildHandoverBundle(
      {
        patientId,
        medications: [
          {},
          { display: 'Paracetamol 1 g v.o. c/8h' },
          { code: { system: 'sys', code: '12345', display: 'Ibuprofen 400 mg tablet' } },
        ] as any,
      },
      { now }
    );
    const meds = list(b, 'MedicationStatement');
    expect(meds.length).toBe(2);
    expect(JSON.stringify(meds)).toContain('Paracetamol');
    expect(JSON.stringify(meds)).toContain('Ibuprofen');
  });

  it('acepta sólo texto (text/dosageText) o sólo code/display', () => {
    const b = buildHandoverBundle(
      {
        patientId,
        medications: [
          { display: 'Metamizol 2 g IV' },
          { code: { system: 'sys', code: '123', display: 'Omeprazole 20 mg' } },
        ],
      },
      { now }
    );
    const meds = list(b,'MedicationStatement');
    expect(meds.length).toBe(2);
  });
});
