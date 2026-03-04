import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { SNOMED_SYSTEM } from '@/src/data/snomed-dict';
import { DIET_TYPES, MOBILITY_LEVELS } from '@/src/types/handover';
import { zHandover } from '@/src/validation/schemas';

const buildValidHandover = () => {
  const now = new Date();
  const fourHoursLater = new Date(now.getTime() + 4 * 3600 * 1000);

  return {
    administrativeData: {
      unit: 'Unidad A',
      census: 10,
      staffIn: ['Ana Enfermera'],
      staffOut: ['Luis Enfermero'],
      shiftStart: now.toISOString(),
      shiftEnd: fourHoursLater.toISOString(),
      shiftType: 'Mañana',
      generalNotes: 'Notas generales del turno.',
      incidents: ['Sin incidentes'],
    },
    status: 'draft' as const,
    patientId: 'patient-123',
    vitals: {
      hr: 82,
      rr: 16,
      tempC: 36.8,
      spo2: 98,
      sbp: 120,
      dbp: 70,
    },
    dxMedical: { system: SNOMED_SYSTEM, code: '195967001', display: 'Neumonía' },
    dxNursing: { system: SNOMED_SYSTEM, code: '386661006', display: 'Fiebre' },
    dxMedicalStructured: [],
    dxNursingStructured: [],
    evolution: 'Paciente estable, sin cambios agudos.',
    closingSummary: 'Se mantiene oxigenoterapia nasal, plan de movilización progresiva.',
    sbarSituation: 'Paciente con fiebre resuelta.',
    sbarBackground: 'Ingresó por neumonía hace 48h.',
    sbarAssessment: 'Estable, sin requerimientos de vasoactivos.',
    sbarRecommendation: 'Continuar antibióticos y fisioterapia respiratoria.',
    meds: 'Amoxicilina 1g c/8h.',
    medications: [],
    treatments: [],
    oxygenTherapy: {},
    nutrition: {
      dietType: DIET_TYPES[0],
      tolerance: 'Buena',
      intakeMl: 1500,
    },
    elimination: {
      urineMl: 1200,
    },
    mobility: {
      mobilityLevel: MOBILITY_LEVELS[0],
      repositioningPlan: 'Cada 2 horas',
    },
    skin: {
      skinStatus: 'Íntegra',
      hasPressureInjury: false,
    },
    fluidBalance: {
      intakeMl: 1500,
      outputMl: 1300,
      netBalanceMl: 200,
      notes: 'Balance positivo leve',
    },
    painAssessment: {
      hasPain: false,
      evaScore: null,
      location: null,
      actionsTaken: null,
    },
    braden: {
      sensoryPerception: 4,
      moisture: 4,
      activity: 3,
      mobility: 3,
      nutrition: 4,
      frictionShear: 3,
      totalScore: 21,
      riskLevel: 'sin_riesgo',
    },
    glasgow: {
      eye: 4,
      verbal: 5,
      motor: 6,
      total: 15,
      severity: 'leve',
    },
    bedsideChecklist: {
      patientIdentityConfirmed: true,
      allergiesReviewed: true,
      linesAndDevicesChecked: true,
      medicationPlanReviewed: true,
      safetyMeasuresApplied: true,
      questionsAnswered: true,
      bedsideNotes: 'Checklist completado',
    },
    risks: {},
    risksStructured: [],
    signatures: {},
  };
};

describe('zHandover schema', () => {

  it('normaliza payload legacy (meds/risks/sbar/glucosa) hacia campos canónicos', () => {
    const data = buildValidHandover() as Record<string, unknown>;
    data.medications = [];
    data.meds = 'Aspirina 100mg, Metformina 850mg';
    data.risksStructured = [];
    data.risks = ['caidas', 'aislamiento'];
    data.closingSummary = '';
    data.sbarFullText = 'Resumen SBAR legado';
    data.vitals = { glucoseMmolL: 5.6 };

    const parsed = zHandover.parse(data);

    expect(parsed.medications.length).toBe(2);
    expect(parsed.medications[0]?.name).toContain('Aspirina');
    expect(parsed.risksStructured.map((risk) => risk.type)).toEqual(['fall', 'isolation']);
    expect(parsed.closingSummary).toBe('Resumen SBAR legado');
    expect(parsed.vitals?.glucoseMgDl).toBe(101);
    expect(parsed.vitals?.glucoseMmolL).toBeCloseTo(5.6, 1);
  });


  it('acepta extremos legacy de glucosa mmol/L tras normalizar a mg/dL', () => {
    const low = zHandover.parse({ ...buildValidHandover(), vitals: { glucoseMmolL: 1 } });
    const high = zHandover.parse({ ...buildValidHandover(), vitals: { glucoseMmolL: 55 } });

    expect(low.vitals?.glucoseMgDl).toBe(18);
    expect(high.vitals?.glucoseMgDl).toBe(991);
  });

  it('migra sbarFullText legacy (>1500 chars) a closingSummary sin pérdida', () => {
    const longSbar = 'A'.repeat(1800);
    const parsed = zHandover.parse({
      ...buildValidHandover(),
      closingSummary: '',
      sbarFullText: longSbar,
    });

    expect(parsed.closingSummary).toHaveLength(1800);
    expect(parsed.closingSummary).toBe(longSbar);
  });

  it('deriva campos legacy desde canónicos cuando legacy está vacío', () => {
    const parsed = zHandover.parse({
      ...buildValidHandover(),
      closingSummary: 'Cierre canónico',
      sbarFullText: '',
      meds: '',
      medications: [
        { id: 'm1', name: 'Paracetamol' },
        { id: 'm2', name: 'Heparina' },
      ],
      risks: {},
      risksStructured: [
        { type: 'fall', present: true, actions: [] },
        { type: 'pressureUlcer', present: false, actions: [] },
      ],
    });

    expect(parsed.sbarFullText).toBe('Cierre canónico');
    expect(parsed.meds).toBe('Paracetamol, Heparina');
    expect(parsed.risks).toMatchObject({ fall: true, pressureUlcer: false, isolation: false });
  });

  it('accepts a fully valid handover object', () => {
    const data = buildValidHandover();
    expect(() => zHandover.parse(data)).not.toThrowError();
  });

  it('rejects shift end earlier than start', () => {
    const data = buildValidHandover();
    data.administrativeData.shiftEnd = data.administrativeData.shiftStart;
    expect(() => zHandover.parse(data)).toThrowError(ZodError);
  });

  it('rejects out-of-range vital signs', () => {
    const data = buildValidHandover();
    data.vitals = { ...data.vitals, tempC: 60 };
    expect(() => zHandover.parse(data)).toThrowError(ZodError);
  });

  it('rejects invalid ISO timestamps in vitals', () => {
    const data = buildValidHandover();
    data.vitals = { ...data.vitals, recordedAt: 'no-es-fecha' };
    expect(() => zHandover.parse(data)).toThrowError(ZodError);
  });

  it('accepts exams and procedures entries', () => {
    const data = buildValidHandover();
    data.exams = [{ type: 'laboratory', state: 'result', description: 'PCR' }];
    data.procedures = [{ description: 'Curación', done: true }];
    expect(() => zHandover.parse(data)).not.toThrowError();
  });

  it('rejects incoherent blood pressure', () => {
    const data = buildValidHandover();
    data.vitals = { ...data.vitals, sbp: 90, dbp: 95 };
    expect(() => zHandover.parse(data)).toThrowError(ZodError);
  });

  it('enforces pain score when patient reports pain', () => {
    const data = buildValidHandover();
    data.painAssessment = { ...data.painAssessment, hasPain: true, evaScore: null };
    expect(() => zHandover.parse(data)).toThrowError(ZodError);
  });

  it('validates Braden total score coherence', () => {
    const data = buildValidHandover();
    data.braden = { ...data.braden!, totalScore: 10 };
    expect(() => zHandover.parse(data)).toThrowError(ZodError);
  });
});
