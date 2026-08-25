import { describe, expect, it } from 'vitest';

import { SNOMED_SYSTEM } from '@/src/data/snomed-dict';
import type { HandoverValues } from '@/src/validation/schemas';
import { buildHandoverInputPayload } from '../submission';
import {
  createDeterministicSbar,
  createInitialDeterministicSbar,
  getSbarFingerprint,
} from '../deterministicSbar';

type SbarOverrides = Partial<
  Pick<
    HandoverValues,
    'sbarSituation' | 'sbarBackground' | 'sbarAssessment' | 'sbarRecommendation' | 'closingSummary'
  >
>;

const buildValues = (overrides: SbarOverrides = {}): HandoverValues => ({
  administrativeData: {
    unit: 'udcc-psychogeriatrics',
    census: 1,
    staffIn: [],
    staffOut: [],
    shiftStart: '2026-08-27T06:00:00.000Z',
    shiftEnd: '2026-08-27T14:00:00.000Z',
    shiftType: 'Mañana',
    incidents: [],
  },
  patientId: 'demo-psych-udcc-001',
  status: 'draft',
  dxMedical: { system: SNOMED_SYSTEM, code: '90128006', display: 'Delirium' },
  dxNursing: '',
  dxMedicalStructured: [],
  dxNursingStructured: [],
  medications: [],
  treatments: [],
  exams: [],
  procedures: [],
  attachments: [],
  devices: [{ name: 'Sonda vesical sintetica', active: true }],
  elimination: { urineMl: 450, stoolPattern: 'constipation', hasRectalTube: false },
  pendingTasks: [
    {
      id: 'task-elimination',
      category: 'reevaluation',
      title: 'Vigilar diuresis y estreñimiento en el siguiente turno',
      status: 'pending',
      priority: 'urgent',
    },
  ],
  bedsideChecklist: {
    patientIdentityConfirmed: false,
    allergiesReviewed: false,
    linesAndDevicesChecked: false,
    medicationPlanReviewed: false,
    safetyMeasuresApplied: false,
    questionsAnswered: false,
  },
  risksStructured: [],
  closingSummary: '',
  sbarSituation: '',
  sbarBackground: '',
  sbarAssessment: '',
  sbarRecommendation: '',
  ...overrides,
});

const provenance = 'Resumen automático local basado en datos sintéticos; no es una inferencia clínica de IA.';

describe('deterministic SBAR form initialization', () => {
  it('generates once after receiving the complete prefill and remains deterministic', () => {
    const values = buildValues();
    const first = createInitialDeterministicSbar(values, provenance);
    const second = createInitialDeterministicSbar(values, provenance);

    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(first?.summary.situation).toContain('Delirium');
    expect(first?.fullText).toContain(provenance);
  });

  it('preserves an existing SBAR and professional edits without repeated generation', () => {
    const existing = buildValues({ sbarSituation: 'SBAR existente del turno anterior' });
    expect(createInitialDeterministicSbar(existing, provenance)).toBeNull();

    const generated = createDeterministicSbar(buildValues(), provenance);
    const initialized = buildValues({
      sbarSituation: generated.summary.situation,
      sbarBackground: generated.summary.background,
      sbarAssessment: generated.summary.assessment,
      sbarRecommendation: generated.summary.recommendation,
      closingSummary: generated.fullText,
    });
    expect(createInitialDeterministicSbar(initialized, provenance)).toBeNull();

    const edited = { ...initialized, sbarRecommendation: 'Texto ajustado por la profesional' };
    expect(createInitialDeterministicSbar(edited, provenance)).toBeNull();
    expect(getSbarFingerprint(edited)).not.toBe(generated.fingerprint);
  });

  it('keeps SBAR and elimination in the canonical payload used by the offline queue', () => {
    const values = buildValues();
    const generated = createDeterministicSbar(values, provenance);
    const payload = buildHandoverInputPayload(
      {
        ...values,
        sbarSituation: generated.summary.situation,
        sbarBackground: generated.summary.background,
        sbarAssessment: generated.summary.assessment,
        sbarRecommendation: generated.summary.recommendation,
        closingSummary: generated.fullText,
      },
      {
        closingSummary: generated.fullText,
        sbar: {
          situation: generated.summary.situation,
          background: generated.summary.background,
          assessment: generated.summary.assessment,
          recommendation: generated.summary.recommendation,
        },
      },
    );

    expect(payload.sbar?.assessment).toContain('estreñimiento');
    expect(payload.closingSummary).toContain(provenance);
    expect(payload.elimination).toEqual(values.elimination);
  });
});
