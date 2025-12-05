import { describe, expect, it, vi } from 'vitest';

import { buildMinimalSbarSummary, getBestAvailableSummary } from '@/src/lib/ai-degrade';
import * as SummaryModule from '@/src/lib/summary';
import type { SBARSummary } from '@/src/types/sbar';
import type { HandoverFormData } from '@/src/validation/schemas';

const administrativeData = {
  unit: 'UCI',
  census: 2,
  staffIn: [],
  staffOut: [],
  shiftStart: '2024-01-01T08:00:00Z',
  shiftEnd: '2024-01-01T20:00:00Z',
  incidents: [],
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
  bedsideChecklist: {
    patientIdentityConfirmed: true,
    allergiesReviewed: true,
    linesAndDevicesChecked: false,
    medicationPlanReviewed: false,
    safetyMeasuresApplied: false,
    questionsAnswered: false,
  },
  risksStructured: [],
  ...overrides,
});

describe('ai-degrade summary selection', () => {
  it('usa el proveedor de IA cuando responde con éxito', async () => {
    const handover = buildData({ dxMedical: 'Neumonía' });
    const aiSummary: SBARSummary = {
      situation: 'IA: situación',
      background: 'IA: antecedentes',
      assessment: 'IA: valoración',
      recommendation: 'IA: recomendación',
    };
    const aiProvider = vi.fn(async () => aiSummary);

    const result = await getBestAvailableSummary(handover, { aiProvider });

    expect(aiProvider).toHaveBeenCalled();
    expect(result).toEqual(aiSummary);
  });

  it('degrada a reglas locales cuando el proveedor de IA falla', async () => {
    const handover = buildData({ dxMedical: 'Sepsis', vitals: { rr: 30, spo2: 88, tempC: 39, sbp: 90, hr: 120, avpu: 'V' } });
    const aiProvider = vi.fn(async () => {
      throw new Error('AI offline');
    });

    const result = await getBestAvailableSummary(handover, { aiProvider });

    const local = SummaryModule.generateSBARSummary(handover);
    expect(result.situation).toBe(local.situation);
    expect(result.assessment).toContain('NEWS2');
  });

  it('rellena campos vacíos cuando el proveedor IA devuelve datos parciales', async () => {
    const handover = buildData({ dxMedical: 'Hipotensión', vitals: { rr: 10, spo2: 90, tempC: 36, sbp: 95, hr: 60, avpu: 'A' } });
    const aiProvider = vi.fn(async () => ({
      situation: 'IA custom',
      background: '',
      assessment: '',
      recommendation: '',
    } satisfies SBARSummary));

    const result = await getBestAvailableSummary(handover, { aiProvider });
    const draft = SummaryModule.generateSBARSummary(handover);

    expect(result.situation).toBe('IA custom');
    expect(result.background).toBe(draft.background);
    expect(result.assessment).toBe(draft.assessment);
    expect(result.recommendation).toBe(draft.recommendation);
  });

  it('usa resumen local cuando el proveedor IA devuelve null', async () => {
    const handover = buildData({ dxMedical: 'Fiebre de origen desconocido' });
    const aiProvider = vi.fn(async () => null);

    const result = await getBestAvailableSummary(handover, { aiProvider });
    const draft = SummaryModule.generateSBARSummary(handover);

    expect(aiProvider).toHaveBeenCalled();
    expect(result).toEqual(draft);
  });

  it('cuando no se permiten reglas locales usa el resumen mínimo', async () => {
    const handover = buildData({ dxMedical: undefined, vitals: undefined, risks: {} });

    const result = await getBestAvailableSummary(handover, { useLocalRules: false });

    expect(result.situation).toContain('Diagnóstico no disponible');
    expect(result.assessment).toContain('Riesgos');
  });

  it('usa el resumen mínimo cuando fallan las reglas locales', async () => {
    const handover = buildData({
      dxMedical: 'Paciente crítico',
      vitals: { rr: 30, spo2: 85, tempC: 39.2, sbp: 88, hr: 126, avpu: 'P' },
    });
    const draftMinimal = buildMinimalSbarSummary(handover);
    const spy = vi
      .spyOn(SummaryModule, 'generateSBARSummary')
      .mockImplementation(() => {
        throw new Error('Local rules broken');
      });

    const result = await getBestAvailableSummary(handover);

    expect(result).toEqual(draftMinimal);

    spy.mockRestore();
  });
});

describe('buildMinimalSbarSummary', () => {
  it('prioriza signos críticos y riesgos activos', () => {
    const handover = buildData({
      dxMedical: 'Shock séptico',
      vitals: { rr: 32, spo2: 84, tempC: 39.5, sbp: 82, hr: 130, avpu: 'C' },
      risks: { fall: true, pressureUlcer: true },
      risksStructured: [{ type: 'seizure', present: true, actions: [], notes: 'previo' }] as any,
      oxygenTherapy: { device: 'VMNI' },
    });

    const summary = buildMinimalSbarSummary(handover);

    expect(summary.assessment).toContain('NEWS2');
    expect(summary.assessment).toContain('Riesgos: caídas, úlceras por presión, convulsiones');
    expect(summary.recommendation.toLowerCase()).toContain('monitorizar');
  });
});
