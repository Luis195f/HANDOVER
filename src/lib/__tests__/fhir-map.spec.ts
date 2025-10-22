// __tests__/fhir-map.spec.ts
import { buildHandoverBundle, __test__ } from '../src/lib/fhir-map';

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
    expect(codes).toEqual(['8867-4', '9279-1']); // HR, RR

    // UCUM: ambos en /min
    for (const o of obs) {
      expect(o.valueQuantity?.system).toBe('http://unitsofmeasure.org');
      expect(o.valueQuantity?.code).toBe('/min');
    }

    // effectiveDateTime fijado
    for (const o of obs) {
      expect(o.effectiveDateTime).toBe(ISO_NOW);
    }
  });

  test('todos los vitales + O₂ → panel + individuales + DeviceUseStatement', () => {
    const values = {
      patientId: 'pat-001',
      vitals: { rr: 18, hr: 80, sbp: 120, temp: 37.1, spo2: 96, o2: true }
    };
    const bundle = buildHandoverBundle(values, {
      now: ISO_NOW,
      emitPanel: true,
      emitIndividuals: true
    });

    const obsEntries = extractEntries(bundle.entry as Entry[], 'Observation');
    const obs = extract(bundle.entry as Entry[], 'Observation');
    // 1 panel + 5 individuales = 6
    expect(obsEntries.length).toBe(6);

    // Panel vitales / LOINC 85353-1 con 5 componentes
    const panel = obs.find(o => o.code?.coding?.[0]?.code === '85353-1');
    expect(panel).toBeTruthy();
    expect(Array.isArray(panel!.component)).toBe(true);
    expect(panel!.component).toHaveLength(5);

    // DeviceUseStatement por O₂ (SNOMED 46680005)
    const dus = extract(bundle.entry as Entry[], 'DeviceUseStatement');
    expect(dus).toHaveLength(1);
    const snomed = dus[0].reasonCode?.[0]?.coding?.[0]?.code;
    expect(snomed).toBe('46680005');

    // UCUM por vital
    const get = (code: string) => obs.find(o => o.code?.coding?.[0]?.code === code);
    expect(get('9279-1')?.valueQuantity?.code).toBe('/min');     // RR
    expect(get('8867-4')?.valueQuantity?.code).toBe('/min');     // HR
    expect(get('8480-6')?.valueQuantity?.code).toBe('mm[Hg]');   // SBP
    expect(get('8310-5')?.valueQuantity?.code).toBe('Cel');      // Temp
    expect(get('59408-5')?.valueQuantity?.code).toBe('%');       // SpO2
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

    // mismo identifier.value
    expect(comp1.resource.identifier.value).toBe(comp2.resource.identifier.value);

    // mismo ifNoneExist (usa el identifier determinista)
    expect(comp1.request?.ifNoneExist).toBe(comp2.request?.ifNoneExist);
    expect(comp1.request?.ifNoneExist).toMatch(/^identifier=urn:uuid\|/);
  });

  test('validación LOINC/UCUM (SBP y Temp)', () => {
    const bundle = buildHandoverBundle(
      { patientId: 'pat-001', vitals: { sbp: 123, temp: 36.7 } },
      { now: ISO_NOW, emitPanel: false, emitIndividuals: true }
    );

    const obs = extract(bundle.entry as Entry[], 'Observation');
    const sbp = obs.find(o => o.code?.coding?.[0]?.code === '8480-6')!;
    const tmp = obs.find(o => o.code?.coding?.[0]?.code === '8310-5')!;

    expect(sbp.valueQuantity.unit).toBe('mm[Hg]');
    expect(sbp.valueQuantity.code).toBe('mm[Hg]');
    expect(tmp.valueQuantity.unit).toBe('Cel');
    expect(tmp.valueQuantity.code).toBe('Cel');
  });
});
