import { describe, expect, it } from 'vitest';

import { formatSbar, generateSBARSummary } from '@/src/lib/summary';
import type { SBARSummary } from '@/src/types/sbar';
import type { HandoverFormData } from '@/src/validation/schemas';

const administrativeData = {
  unit: 'UCI',
  census: 3,
  staffIn: [],
  staffOut: [],
  shiftStart: '2024-01-01T08:00:00Z',
  shiftEnd: '2024-01-01T20:00:00Z',
  incidents: [],
};

const bedsideChecklist = {
  patientIdentityConfirmed: true,
  allergiesReviewed: true,
  linesAndDevicesChecked: false,
  medicationPlanReviewed: false,
  safetyMeasuresApplied: false,
  questionsAnswered: false,
};

const buildData = (overrides: Partial<HandoverFormData> = {}): HandoverFormData => ({
  administrativeData,
  status: 'draft',
  patientId: 'P-001',
  dxMedicalStructured: [],
  dxNursingStructured: [],
  closingSummary: '',
  medications: [],
  treatments: [],
  bedsideChecklist,
  risksStructured: [],
  ...overrides,
});

const expectSafeStrings = (summary: SBARSummary) => {
  Object.values(summary).forEach((value) => {
    expect(value).toBeTypeOf('string');
    expect(value.length).toBeGreaterThan(0);
    expect(value).not.toMatch(/undefined|null|\[object Object]/i);
  });
};

describe('generateSBARSummary', () => {
  it('describe a un paciente estable sin lenguaje de alarma', () => {
    const summary = generateSBARSummary(
      buildData({
        dxMedical: 'Bronquitis leve',
        vitals: { rr: 16, spo2: 98, tempC: 36.7, sbp: 120, hr: 78, avpu: 'A' },
        oxygenTherapy: { device: 'Aire ambiente' },
        evolution: 'Paciente estable, sin incidencias.',
        risks: {},
      }),
    );

    expect(summary.situation).toContain('Bronquitis leve');
    expect(summary.situation.toLowerCase()).toContain('bajo riesgo');
    expect(summary.assessment.toLowerCase()).not.toMatch(/crític|inestabl|deterioro/);

    const formatted = formatSbar(summary, 'es');
    expect(formatted).toContain('S: Situación');
    expect(formatted).toContain('R: Recomendación');
  });

  it('destaca inestabilidad y riesgos en paciente crítico', () => {
    const summary = generateSBARSummary(
      buildData({
        dxMedical: 'Sepsis de origen urinario',
        dxNursing: 'Riesgo de shock séptico',
        vitals: { rr: 32, spo2: 84, tempC: 39.1, sbp: 82, hr: 132, avpu: 'C' },
        oxygenTherapy: { device: 'VMNI', flowLMin: 12, fio2: 70 },
        risks: { fall: true, pressureUlcer: true },
        evolution: 'Deterioro en últimas horas',
        meds: 'Antibiótico IV en curso',
        treatments: [{
          id: 't1',
          name: 'Curación de catéter',
          schedule: '12:00',
        } as any],
      }),
    );

    expect(summary.situation.toLowerCase()).toMatch(/alto|crítico/);
    expect(summary.assessment).toContain('Riesgos: caídas, úlceras por presión');
    expect(summary.recommendation).toMatch(/Medicaciones pendientes|Vigilar/);
    expect(summary.recommendation).toContain('Procedimientos/curas programadas');
  });

  it('lista múltiples riesgos sin duplicados ni artefactos', () => {
    const summary = generateSBARSummary(
      buildData({
        dxMedical: 'Postoperatorio inmediato',
        risks: { fall: true, pressureUlcer: true, isolation: true },
        painAssessment: { hasPain: true, evaScore: 5, location: 'incisión', actionsTaken: null },
      }),
    );

    expect(summary.assessment).toContain('Riesgos: caídas, úlceras por presión, aislamiento');
    expect(summary.assessment).not.toMatch(/undefined|null|  /);
    expect(summary.assessment.match(/caídas/g)?.length).toBe(1);
  });

  it('devuelve textos seguros aunque falten la mayoría de datos', () => {
    const summary = generateSBARSummary(
      buildData({
        dxMedical: undefined,
        dxNursing: undefined,
        vitals: undefined,
        oxygenTherapy: undefined,
        evolution: undefined,
        risks: {},
        painAssessment: undefined,
      }),
    );

    expectSafeStrings(summary);
  });
});
