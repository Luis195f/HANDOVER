import { describe, expect, it } from 'vitest';

import { formatSbar, generateSBARSummary } from '@/src/lib/summary';
import { SNOMED_SYSTEM, type SnomedCoding } from '@/src/data/snomed-dict';
import type { SBARSummary } from '@/src/types/sbar';
import type { HandoverFormData } from '@/src/validation/schemas';

const administrativeData = {
  unit: 'UCI',
  census: 3,
  staffIn: [],
  staffOut: [],
  shiftStart: '2024-01-01T08:00:00Z',
  shiftEnd: '2024-01-01T20:00:00Z',
  shiftType: 'Mañana',
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

const makeCoding = (code: string, display: string): SnomedCoding => ({
  system: SNOMED_SYSTEM,
  code,
  display,
});

const buildData = (overrides: Partial<HandoverFormData> = {}): HandoverFormData => ({
  administrativeData,
  status: 'draft',
  patientId: 'P-001',
  dxMedical: makeCoding('195967001', 'Neumonía'),
  dxNursing: makeCoding('386661006', 'Fiebre'),
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
        dxMedical: makeCoding('233917008', 'Bronquitis aguda'),
        vitals: { rr: 16, spo2: 98, tempC: 36.7, sbp: 120, hr: 78, avpu: 'A' },
        oxygenTherapy: { device: 'Aire ambiente' },
        evolution: 'Paciente estable, sin incidencias.',
        risks: {},
      }),
    );

    expect(summary.situation).toContain('Bronquitis aguda');
    expect(summary.situation.toLowerCase()).toContain('bajo riesgo');
    expect(summary.assessment.toLowerCase()).not.toMatch(/crític|inestabl|deterioro/);

    const formatted = formatSbar(summary, 'es');
    expect(formatted).toContain('S: Situación');
    expect(formatted).toContain('R: Recomendación');
  });

  it('destaca inestabilidad y riesgos en paciente crítico', () => {
    const summary = generateSBARSummary(
      buildData({
        dxMedical: makeCoding('128045006', 'Sepsis'),
        dxNursing: makeCoding('299709002', 'Shock séptico'),
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
        dxMedical: makeCoding('274100004', 'Estado postoperatorio'),
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
        dxMedical: null,
        dxNursing: null,
        vitals: undefined,
        oxygenTherapy: undefined,
        evolution: undefined,
        risks: {},
        painAssessment: undefined,
      }),
    );

    expectSafeStrings(summary);
  });

  it('incorpora riesgos estructurados y notas de cabecera', () => {
    const summary = generateSBARSummary(
      buildData({
        dxMedical: makeCoding('28926001', 'Infarto agudo de miocardio'),
        risksStructured: [
          { type: 'seizure', present: true, actions: [], notes: 'Monitorizar' },
          { type: 'other', present: true, actions: [], notes: 'Riesgo personalizado' },
        ] as any,
        bedsideChecklist: { ...bedsideChecklist, bedsideNotes: 'Cama cerca del control' },
      }),
    );

    expect(summary.assessment).toContain('convulsiones');
    expect(summary.recommendation).toContain('Vigilar convulsiones, otro');
    expect(summary.background).toContain('Cama cerca del control');
  });

  it('trunca secciones largas respetando límites seguros', () => {
    const summary = generateSBARSummary(
      buildData({
        dxMedical: makeCoding('386661006', 'Dolor de cabeza'),
        evolution: 'Texto muy largo y detallado que debe ser truncado para evitar desbordes en UI',
      }),
      { maxCharsPerSection: 60 },
    );

    expect(summary.situation.length).toBeLessThanOrEqual(60);
    expect(summary.background.length).toBeLessThanOrEqual(60);
    expect(summary.assessment.length).toBeLessThanOrEqual(60);
    expect(summary.recommendation.length).toBeLessThanOrEqual(60);
    expect(summary.situation.endsWith('…')).toBe(true);
  });
});
