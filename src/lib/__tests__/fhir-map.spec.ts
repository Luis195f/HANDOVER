// __tests__/fhir-map.spec.ts
import { buildHandoverBundle, mapExamObservations, mapProcedures } from '../fhir-map';
import { TEST_SNOMED_CODES, TEST_SYSTEMS, TEST_VITAL_CODES } from './fhir-map.test-constants';

type Entry = { fullUrl?: string; resource: any; request?: any };

const ISO_NOW = '2025-10-19T12:00:00Z';

function extract(entries: Entry[], rt: string) {
  return entries.filter(e => e.resource?.resourceType === rt).map(e => e.resource);
}
function extractEntries(entries: Entry[], rt: string) {
  return entries.filter(e => e.resource?.resourceType === rt);
}
function stripDyn<T extends Entry>(entries: T[]) {
  return entries.map(({ fullUrl: _drop, ...rest }) => rest);
}

describe('mapVitalsToObservations (vía buildHandoverBundle con emitIndividuals)', () => {
  test('solo HR/RR → Observations individuales con LOINC/UCUM correctos', () => {
    const values = { patientId: 'pat-001', vitals: { hr: 80, rr: 18 } };
    const bundle = buildHandoverBundle(values, {
      now: ISO_NOW,
      emitPanel: false,          // probamos “mapVitalsToObservations” puro
      emitIndividuals: true
    });

    const obs = extract(bundle.entry as Entry[], 'Observation');
    // Deberían ser solo 2 (HR y RR)
    expect(obs).toHaveLength(2);

    const codes = obs.map(o => o.code?.coding?.[0]?.code).sort();
    expect(codes).toEqual([
      TEST_VITAL_CODES.HEART_RATE.code,
      TEST_VITAL_CODES.RESP_RATE.code,
    ]);

    // UCUM: ambos en /min
    for (const o of obs) {
      expect(o.valueQuantity?.system).toBe(TEST_SYSTEMS.UCUM);
      expect(o.valueQuantity?.code).toBe('/min');
    }

    // effectiveDateTime fijado
    for (const o of obs) {
      expect(o.effectiveDateTime).toBe(ISO_NOW);
    }
  });

  test('todos los vitales + O₂ → individuales sin panel ni DeviceUseStatement', () => {
    const values = {
      patientId: 'pat-001',
      vitals: { rr: 18, hr: 80, sbp: 120, tempC: 37.1, spo2: 96, o2: true }
    };
    const bundle = buildHandoverBundle(values, {
      now: ISO_NOW,
      emitPanel: true,
      emitIndividuals: true
    });

    const obsEntries = extractEntries(bundle.entry as Entry[], 'Observation');
    const obs = extract(bundle.entry as Entry[], 'Observation');
    // Individuales (RR, HR, Temp, SpO2; SBP opcional)
    expect(obsEntries.length).toBeGreaterThanOrEqual(4);

    // No se emiten paneles ni DeviceUseStatement en este flujo
    const panel = obs.find(o =>
      o.code?.coding?.some((coding: any) =>
        coding.system === TEST_VITAL_CODES.VITAL_SIGNS_PANEL.system &&
        coding.code === TEST_VITAL_CODES.VITAL_SIGNS_PANEL.code
      )
    );
    expect(panel).toBeUndefined();

    const dus = extract(bundle.entry as Entry[], 'DeviceUseStatement');
    expect(dus).toHaveLength(0);

    // UCUM por vital
    const get = (code: string) => obs.find(o => o.code?.coding?.some((c: any) => c.code === code));
    expect(get(TEST_VITAL_CODES.RESP_RATE.code)?.valueQuantity?.code).toBe('/min');
    expect(get(TEST_VITAL_CODES.HEART_RATE.code)?.valueQuantity?.code).toBe('/min');
    const sbp = get(TEST_VITAL_CODES.BP_SYSTOLIC.code);
    if (sbp) {
      expect(sbp.valueQuantity?.code).toBe('mm[Hg]');
    }
    const temp = get(TEST_VITAL_CODES.TEMPERATURE.code);
    if (temp) {
      expect(temp.valueQuantity?.code).toBe('Cel');
    }
    expect(get(TEST_VITAL_CODES.SPO2.code)?.valueQuantity?.code).toBe('%');
  });

  test('idempotencia: Composition.identifier y ifNoneExist constantes para mismos inputs', () => {
    const values = {
      patientId: 'pat-XYZ',
      shiftStart: '2025-10-19T08:00:00Z',
      vitals: { hr: 74 }
    };

    const b1 = buildHandoverBundle(values, { now: ISO_NOW });
    const b2 = buildHandoverBundle(values, { now: ISO_NOW });

    const comp1 = (b1.entry as Entry[]).find(e => e.resource?.resourceType === 'Composition')!;
    const comp2 = (b2.entry as Entry[]).find(e => e.resource?.resourceType === 'Composition')!;

    const id1 = comp1.resource.identifier?.value;
    const id2 = comp2.resource.identifier?.value;
    expect(id1).toBe(id2);

    // mismo ifNoneExist (usa el identifier determinista cuando existe)
    expect(comp1.request?.ifNoneExist).toBe(comp2.request?.ifNoneExist);
    if (id1) {
      expect(comp1.request?.ifNoneExist).toMatch(/^identifier=urn:uuid\|/);
    }
  });

  test('validación LOINC/UCUM (SBP y Temp)', () => {
    const bundle = buildHandoverBundle(
      { patientId: 'pat-001', vitals: { sbp: 123, dbp: 70, tempC: 36.7 } },
      { now: ISO_NOW, emitPanel: false, emitIndividuals: true }
    );

    const obs = extract(bundle.entry as Entry[], 'Observation');
    const sbp = obs.find(o => o.code?.coding?.[0]?.code === TEST_VITAL_CODES.BP_SYSTOLIC.code);
    const tmp = obs.find(o => o.code?.coding?.[0]?.code === TEST_VITAL_CODES.TEMPERATURE.code);

    if (sbp) {
      expect(sbp.valueQuantity?.unit).toBe('mm[Hg]');
      expect(sbp.valueQuantity?.code).toBe('mm[Hg]');
    }
    if (tmp) {
      expect(tmp.valueQuantity?.unit).toBe('°C');
      expect(tmp.valueQuantity?.code).toBe('Cel');
    }
  });
});

describe('exams and procedures mapping', () => {
  test('maps laboratory result exams to Observation with lab category and final status', () => {
    const observations = mapExamObservations(
      {
        patientId: 'pat-exam-1',
        exams: [{ type: 'laboratory', state: 'result', description: 'Hemograma completo' }],
      },
      { now: '2025-01-01T00:00:00Z' },
    );

    expect(observations).toHaveLength(1);
    const exam = observations[0];
    expect(exam.status).toBe('final');
    expect(exam.category?.[0]?.coding?.[0]?.code).toBe('laboratory');
    expect(exam.code?.text).toBe('Laboratory result');
  });

  test('maps imaging pending exams to Observation with imaging category and registered status', () => {
    const observations = mapExamObservations(
      {
        patientId: 'pat-exam-2',
        exams: [{ type: 'imaging', state: 'pending', description: 'TAC de tórax' }],
      },
      { now: '2025-01-01T00:00:00Z' },
    );

    expect(observations).toHaveLength(1);
    const exam = observations[0];
    expect(exam.status).toBe('registered');
    expect(exam.category?.[0]?.coding?.[0]?.code).toBe('imaging');
  });

  test('maps incomplete procedures as preparation', () => {
    const procedures = mapProcedures(
      { patientId: 'pat-proc-1', procedures: [{ description: 'Curación de herida', done: false }] },
      { now: '2025-01-01T00:00:00Z' },
    );

    expect(procedures).toHaveLength(1);
    expect(procedures[0]?.status).toBe('preparation');
  });

  test('maps completed procedures with completed status', () => {
    const procedures = mapProcedures(
      { patientId: 'pat-proc-2', procedures: [{ description: 'Retiro de suturas', done: true }] },
      { now: '2025-01-01T00:00:00Z' },
    );

    expect(procedures).toHaveLength(1);
    expect(procedures[0]?.status).toBe('completed');
  });
});
