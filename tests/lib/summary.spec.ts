import { describe, expect, it } from 'vitest';

import { formatSbar, generateSbarSummary } from '@/src/lib/summary';
import type { HandoverValues } from '@/src/types/handover';

const baseAdministrativeData = {
  unit: 'UCI',
  census: 5,
  staffIn: [],
  staffOut: [],
  shiftStart: '2024-01-01T08:00:00Z',
  shiftEnd: '2024-01-01T20:00:00Z',
  incidents: [],
};

const buildData = (overrides: Partial<HandoverValues>): HandoverValues => ({
  administrativeData: baseAdministrativeData,
  patientId: 'P-001',
  ...overrides,
});

describe('generateSbarSummary', () => {
  it('resume paciente estable con NEWS2 bajo y diagnóstico respiratorio', () => {
    const data = buildData({
      dxMedical: 'Bronquitis leve',
      vitals: { rr: 16, spo2: 97, tempC: 36.8, sbp: 118, hr: 82, avpu: 'A' },
      oxygenTherapy: { device: 'Aire ambiente' },
      evolution: 'Paciente estable, sin incidencias.',
    });

    const summary = generateSbarSummary(data);
    expect(summary.situation).toContain('Bronquitis leve');
    expect(summary.assessment).toContain('NEWS2');
    expect(summary.assessment.toLowerCase()).toContain('bajo');

    const formatted = formatSbar(summary, 'es');
    expect(formatted).toContain('S: Situación');
    expect(formatted).toContain('R: Recomendación');
  });

  it('incluye alertas y tareas para paciente crítico con soporte respiratorio', () => {
    const data = buildData({
      dxMedical: 'Neumonía grave',
      dxNursing: 'Riesgo de deterioro respiratorio',
      vitals: { rr: 30, spo2: 85, tempC: 38.9, sbp: 88, hr: 128, avpu: 'C' },
      oxygenTherapy: { device: 'VMNI', flowLMin: 12, fio2: 70 },
      risks: { fall: true, pressureUlcer: true },
      meds: 'Antibióticos IV en curso',
      fluidBalance: { intakeMl: 1800, outputMl: 900, netBalanceMl: 900, notes: 'Control horario de diuresis' },
      painAssessment: { hasPain: true, evaScore: 6, location: 'torácico', actionsTaken: null },
    });

    const summary = generateSbarSummary(data);

    expect(summary.assessment).toContain('NEWS2');
    expect(summary.assessment).toContain('Oxígeno');
    expect(summary.assessment).toContain('Riesgos');
    expect(summary.recommendation).toContain('Medicaciones pendientes');
    expect(summary.recommendation).toContain('Control del dolor');
  });

  it('recorta secciones cuando se define maxCharsPerSection', () => {
    const data = buildData({
      dxMedical: 'Paciente con antecedente respiratorio crónico y múltiples notas largas '.repeat(3),
      evolution: 'Texto extenso '.repeat(5),
    });

    const summary = generateSbarSummary(data, { maxCharsPerSection: 80 });
    expect(summary.situation.length).toBeLessThanOrEqual(81);
    expect(summary.background.length).toBeLessThanOrEqual(81);
    expect(summary.assessment.length).toBeLessThanOrEqual(81);
    expect(summary.recommendation.length).toBeLessThanOrEqual(81);
  });
});
