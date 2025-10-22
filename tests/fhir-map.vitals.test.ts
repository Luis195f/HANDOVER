// tests/fhir-map.vitals.test.ts
import { mapObservationVitals } from '@/src/lib/fhir-map'; // ajusta el import si tu ruta/nombre varía

type Ctx = {
  patientId: string;
  encounterId?: string;
  performerId?: string;
  effectiveDateTime: string;
};

const findByLoinc = (arr: any[], code: string) =>
  arr.find(
    (r) =>
      r?.code?.coding?.some(
        (c: any) =>
          c.system === 'http://loinc.org' && String(c.code) === String(code)
      )
  );

const hasVitalCategory = (r: any) =>
  r?.category?.some((cat: any) =>
    cat?.coding?.some(
      (c: any) =>
        c.system === 'http://terminology.hl7.org/CodeSystem/observation-category' &&
        c.code === 'vital-signs'
    )
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
    const bp = findByLoinc(out, '85354-9'); // Blood pressure panel
    expect(bp).toBeTruthy();

    expect(bp.status).toBe('final');
    expect(hasVitalCategory(bp)).toBe(true);
    expect(bp.subject?.reference).toBe('Patient/pat-001');
    expect(bp.encounter?.reference).toBe('Encounter/enc-123');
    expect(bp.effectiveDateTime).toBe(ctx.effectiveDateTime);

    const sys = bp.component.find((c: any) =>
      c.code.coding.some((cc: any) => cc.system === 'http://loinc.org' && cc.code === '8480-6')
    );
    const dia = bp.component.find((c: any) =>
      c.code.coding.some((cc: any) => cc.system === 'http://loinc.org' && cc.code === '8462-4')
    );

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

    const hr = findByLoinc(out, '8867-4');
    expect(hr).toBeTruthy();
    expect(hr.valueQuantity).toMatchObject({
      value: 88,
      unit: '/min',
      system: UOM,
      code: '/min',
    });
    expect(hasVitalCategory(hr)).toBe(true);

    const rr = findByLoinc(out, '9279-1');
    expect(rr.valueQuantity).toMatchObject({
      value: 18,
      unit: '/min',
      system: UOM,
      code: '/min',
    });

    const temp = findByLoinc(out, '8310-5');
    expect(temp.valueQuantity).toMatchObject({
      value: 37.2,
      unit: '°C',
      system: UOM,
      code: 'Cel',
    });

    const spo2 = findByLoinc(out, '59408-5');
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

    expect(findByLoinc(out, '8867-4')).toBeFalsy();
    expect(findByLoinc(out, '9279-1')).toBeFalsy();
    expect(findByLoinc(out, '8310-5')).toBeFalsy();
  });

  it('si sólo llega TAS o TAD, crea el panel 85354-9 con el componente disponible (idempotente)', () => {
    const onlySys = mapObservationVitals({ sbp: 130 }, ctx);
    const bp1 = findByLoinc(onlySys, '85354-9');
    expect(bp1).toBeTruthy();
    expect(
      bp1.component.some((c: any) =>
        c.code.coding.some((cc: any) => cc.code === '8480-6')
      )
    ).toBe(true);
    expect(
      bp1.component.some((c: any) =>
        c.code.coding.some((cc: any) => cc.code === '8462-4')
      )
    ).toBe(false);

    const onlyDia = mapObservationVitals({ dbp: 70 }, ctx);
    const bp2 = findByLoinc(onlyDia, '85354-9');
    expect(bp2).toBeTruthy();
    expect(
      bp2.component.some((c: any) =>
        c.code.coding.some((cc: any) => cc.code === '8462-4')
      )
    ).toBe(true);
  });

  it('añade meta/profile de vital signs cuando aplique', () => {
    const out = mapObservationVitals({ hr: 80 }, ctx);
    const hr = findByLoinc(out, '8867-4');
    // opcional pero recomendado por perfil de FHIR vital signs
    expect(hr.meta?.profile?.some((p: string) =>
      p.includes('StructureDefinition') && p.toLowerCase().includes('vitalsign')
    )).toBeTruthy();
  });
});
