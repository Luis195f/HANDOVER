import { describe, expect, it } from 'vitest';
import { buildHandoverBundle } from '../fhir-map';

const NOW = '2025-02-20T10:00:00Z';

describe('buildHandoverBundle care blocks', () => {
  it('maps nutrition, elimination, mobility/skin and fluid balance into observations and composition', () => {
    const bundle = buildHandoverBundle(
      {
        patientId: 'pat-care-001',
        nutrition: { dietType: 'oral', tolerance: 'Buena tolerancia', intakeMl: 600 },
        elimination: { urineMl: 900, stoolPattern: 'diarrhea', hasRectalTube: true },
        mobility: { mobilityLevel: 'assisted', repositioningPlan: 'Cada 2h' },
        skin: { skinStatus: 'Lesión sacra', hasPressureInjury: true },
        fluidBalance: { intakeMl: 1500, outputMl: 1200, netBalanceMl: 300, notes: 'Balance positivo' },
      },
      { now: NOW },
    );

    const entries = bundle.entry as Array<{ resource: any }>;
    const observations = entries.filter((e) => e.resource?.resourceType === 'Observation').map((e) => e.resource);
    const byCodeText = (text: string) => observations.find((o) => o.code?.text === text);

    const nutrition = byCodeText('Nutrition care (TODO code)');
    expect(nutrition).toBeDefined();
    const dietComponent = nutrition?.component?.find((c: any) => c.code?.coding?.[0]?.code === 'diet-type');
    expect(dietComponent?.valueCodeableConcept?.coding?.[0]?.code).toBe('oral');
    const toleranceComponent = nutrition?.component?.find((c: any) => c.code?.coding?.[0]?.code === 'tolerance');
    expect(toleranceComponent?.valueString).toBe('Buena tolerancia');
    const intakeComponent = nutrition?.component?.find((c: any) => c.code?.coding?.[0]?.code === 'intake');
    expect(intakeComponent?.valueQuantity?.value).toBe(600);

    const urine = byCodeText('Urine output (TODO code)');
    expect(urine?.valueQuantity?.value).toBe(900);
    const stool = byCodeText('Stool pattern (TODO code)');
    expect(stool?.valueCodeableConcept?.coding?.[0]?.code).toBe('diarrhea');
    expect(stool?.note?.[0]?.text).toContain('Rectal tube present');

    const mobility = byCodeText('Mobility assessment (TODO code)');
    expect(mobility?.valueCodeableConcept?.coding?.[0]?.code).toBe('assisted');
    expect(mobility?.note?.[0]?.text).toContain('Repositioning plan');

    const skin = byCodeText('Skin assessment (TODO code)');
    expect(skin?.valueString).toBe('Lesión sacra');
    const pressureComponent = skin?.component?.find((c: any) => c.code?.coding?.[0]?.code === 'pressure-injury');
    expect(pressureComponent?.valueCodeableConcept?.coding?.[0]?.code).toBe('yes');

    const fluid = byCodeText('Fluid balance (TODO code)');
    expect(fluid?.component?.find((c: any) => c.code?.coding?.[0]?.code === 'intake')?.valueQuantity?.value).toBe(1500);
    expect(fluid?.component?.find((c: any) => c.code?.coding?.[0]?.code === 'output')?.valueQuantity?.value).toBe(1200);
    expect(fluid?.component?.find((c: any) => c.code?.coding?.[0]?.code === 'net')?.valueQuantity?.value).toBe(300);
    expect(fluid?.note?.[0]?.text).toBe('Balance positivo');

    const composition = entries.find((e) => e.resource?.resourceType === 'Composition')?.resource;
    expect(composition).toBeDefined();
    const sectionTitles = (composition?.section ?? []).map((s: any) => s.title);
    expect(sectionTitles).toEqual(
      expect.arrayContaining(['Nutrition', 'Elimination', 'Mobility and Skin', 'Fluid balance']),
    );
    const nutritionSection = composition?.section?.find((s: any) => s.title === 'Nutrition');
    expect(nutritionSection?.entry?.length).toBeGreaterThan(0);
    const fluidSection = composition?.section?.find((s: any) => s.title === 'Fluid balance');
    expect(fluidSection?.entry?.length).toBeGreaterThan(0);
  });
});
