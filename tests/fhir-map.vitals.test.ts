// tests/fhir-map.vitals.test.ts
import { FHIR_CODES, CATEGORY } from '@/src/lib/codes';
import { mapObservationVitals } from '@/src/lib/fhir-map'; // ajusta el import si tu ruta/nombre varía

type Ctx = {
  patientId: string;
  encounterId?: string;
  performerId?: string;
  effectiveDateTime: string;
};

const findByCode = (arr: any[], code: { system: string; code: string }) =>
  arr.find((r) =>
    r?.code?.coding?.some(
      (c: any) => c.system === code.system && String(c.code) === String(code.code),
    ),
  );

const hasVitalCategory = (r: any) =>
  r?.category?.some((cat: any) =>
    cat?.coding?.some(
      (c: any) =>
        c.system === CATEGORY.vitalSigns.system && c.code === CATEGORY.vitalSigns.code,
    ),
  );

const UOM = 'http://unitsofmeasure.org';

describe('FHIR map - Vital signs with LOINC', () => {
  const ctx: Ctx = {
    patientId: 'pat-001',
    encounterId: 'enc-123',
    performerId: 'prac-999',
    effectiveDateTime: '2025-10-21T08:30:00Z',
  };

  it('mapea TA como panel 85354-9 con componentes TAS 8480-6 y TAD 8462-4 en mm[Hg]', () => {
    const input = { sbp: 120, dbp: 75 };
    const out = mapObservationVitals(input, ctx);
    const bp = findByCode(out, FHIR_CODES.VITALS.BP_PANEL);
    expect(bp).toBeTruthy();

    expect(bp.status).toBe('final');
    expect(hasVitalCategory(bp)).toBe(true);
    expect(bp.subject?.reference).toBe('Patient/pat-001');
    expect(bp.encounter?.reference).toBe('Encounter/enc-123');
    expect(bp.effectiveDateTime).toBe(ctx.effectiveDateTime);

    const hasCode = (component: any, code: { system: string; code: string }) =>
      component?.code?.coding?.some(
        (cc: any) => cc.system === code.system && cc.code === code.code,
      );
    const sys = bp.component.find((c: any) => hasCode(c, FHIR_CODES.VITALS.BP_SYSTOLIC));
    const dia = bp.component.find((c: any) => hasCode(c, FHIR_CODES.VITALS.BP_DIASTOLIC));

    expect(sys.valueQuantity).toMatchObject({
      value: 120,
      unit: 'mmHg',
      system: UOM,
      code: 'mm[Hg]',
    });

    expect(dia.valueQuantity).toMatchObject({
      value: 75,
      unit: 'mmHg',
      system: UOM,
      code: 'mm[Hg]',
    });
  });

  it('mapea FC 8867-4 (/min), FR 9279-1 (/min), Temp 8310-5 (Cel) y SpO₂ 59408-5 (%)', () => {
    const input = { hr: 88, rr: 18, tempC: 37.2, spo2: 96 };
    const out = mapObservationVitals(input, ctx);

    const hr = findByCode(out, FHIR_CODES.VITALS.HEART_RATE);
    expect(hr).toBeTruthy();
    expect(hr.valueQuantity).toMatchObject({
      value: 88,
      unit: '/min',
      system: UOM,
      code: '/min',
    });
    expect(hasVitalCategory(hr)).toBe(true);

    const rr = findByCode(out, FHIR_CODES.VITALS.RESP_RATE);
    expect(rr.valueQuantity).toMatchObject({
      value: 18,
      unit: '/min',
      system: UOM,
      code: '/min',
    });

    const temp = findByCode(out, FHIR_CODES.VITALS.TEMPERATURE);
    expect(temp.valueQuantity).toMatchObject({
      value: 37.2,
      unit: '°C',
      system: UOM,
      code: 'Cel',
    });

    const spo2 = findByCode(out, FHIR_CODES.VITALS.SPO2);
    expect(spo2.valueQuantity).toMatchObject({
      value: 96,
      unit: '%',
      system: UOM,
      code: '%',
    });

    // referencias comunes
    for (const r of [hr, rr, temp, spo2]) {
      expect(r.status).toBe('final');
      expect(r.subject?.reference).toBe('Patient/pat-001');
      expect(r.encounter?.reference).toBe('Encounter/enc-123');
      expect(r.effectiveDateTime).toBe(ctx.effectiveDateTime);
    }
  });

  it('no genera observaciones para valores faltantes/undefined', () => {
    const input = { hr: undefined, rr: null, tempC: NaN };
    const out = mapObservationVitals(input as any, ctx);

    expect(findByCode(out, FHIR_CODES.VITALS.HEART_RATE)).toBeFalsy();
    expect(findByCode(out, FHIR_CODES.VITALS.RESP_RATE)).toBeFalsy();
    expect(findByCode(out, FHIR_CODES.VITALS.TEMPERATURE)).toBeFalsy();
  });

  it('si sólo llega TAS o TAD, crea el panel 85354-9 con el componente disponible (idempotente)', () => {
    const onlySys = mapObservationVitals({ sbp: 130 }, ctx);
    const bp1 = findByCode(onlySys, FHIR_CODES.VITALS.BP_PANEL);
    expect(bp1).toBeTruthy();
    expect(
      bp1.component.some((c: any) =>
        c.code.coding.some((cc: any) => cc.code === FHIR_CODES.VITALS.BP_SYSTOLIC.code)
      )
    ).toBe(true);
    expect(
      bp1.component.some((c: any) =>
        c.code.coding.some((cc: any) => cc.code === FHIR_CODES.VITALS.BP_DIASTOLIC.code)
      )
    ).toBe(false);

    const onlyDia = mapObservationVitals({ dbp: 70 }, ctx);
    const bp2 = findByCode(onlyDia, FHIR_CODES.VITALS.BP_PANEL);
    expect(bp2).toBeTruthy();
    expect(
      bp2.component.some((c: any) =>
        c.code.coding.some((cc: any) => cc.code === FHIR_CODES.VITALS.BP_DIASTOLIC.code)
      )
    ).toBe(true);
  });

  it('añade meta/profile de vital signs cuando aplique', () => {
    const out = mapObservationVitals({ hr: 80 }, ctx);
    const hr = findByCode(out, FHIR_CODES.VITALS.HEART_RATE);
    // opcional pero recomendado por perfil de FHIR vital signs
    expect(hr.meta?.profile?.some((p: string) =>
      p.includes('StructureDefinition') && p.toLowerCase().includes('vitalsign')
    )).toBeTruthy();
  });
});
