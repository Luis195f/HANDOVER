import { describe, expect, it } from "vitest";

import { SNOMED_SYSTEM } from "@/src/data/snomed-dict";
import { zHandover, type HandoverFormData } from "@/src/validation/schemas";

const baseValidData: HandoverFormData = {
  administrativeData: {
    unit: "UCI Adulto",
    census: 10,
    staffIn: ["Enfermera A"],
    staffOut: ["Enfermera B"],
    shiftStart: "2024-01-01T08:00:00.000Z",
    shiftEnd: "2024-01-01T16:00:00.000Z",
    shiftType: "Mañana",
    generalNotes: "Notas generales del turno.",
    incidents: ["Cambio de turno sin novedades"],
  },
  patientId: "pat-001",
  status: "final",
  vitals: {
    hr: 82,
    rr: 16,
    tempC: 37.2,
    spo2: 97,
    sbp: 118,
    dbp: 75,
    glucoseMgDl: 110,
    glucoseMmolL: 6,
    avpu: "A",
  },
  dxMedical: { system: SNOMED_SYSTEM, code: "195967001", display: "Neumonía" },
  dxNursing: { system: SNOMED_SYSTEM, code: "386661006", display: "Fiebre" },
  dxMedicalStructured: [
    { system: "SNOMED", code: "233604007", display: "Neumonía" },
  ],
  dxNursingStructured: [
    { system: "NANDA", code: "00030", display: "Deterioro del intercambio gaseoso" },
  ],
  evolution: "Paciente estable, sin nuevos hallazgos.",
  closingSummary: "Entrego paciente estable, con oxigenoterapia nasal a 2 L/min.",
  sbarSituation: "Paciente con neumonía en tratamiento.",
  sbarBackground: "Antecedentes de tabaquismo.",
  sbarAssessment: "Estable, con saturación adecuada.",
  sbarRecommendation: "Continuar antibiótico y vigilar saturación.",
  meds: "Paracetamol 1g c/8h",
  medications: [
    {
      id: "med-1",
      name: "Paracetamol",
      route: "oral",
      dose: "1 g",
      frequency: "c/8h",
      startTime: "08:00",
      endTime: "16:00",
      isContinuous: false,
    },
  ],
  treatments: [
    {
      id: "treat-1",
      type: "woundCare",
      description: "Curación de herida quirúrgica",
      scheduledAt: "2024-01-01T10:00:00.000Z",
      done: false,
    },
  ],
  oxygenTherapy: {
    flowLMin: 2,
    device: "Cánula nasal",
    fio2: 30,
  },
  nutrition: {
    dietType: "oral",
    tolerance: "Buena",
    intakeMl: 1500,
  },
  elimination: {
    urineMl: 1200,
    stoolPattern: "normal",
    hasRectalTube: false,
  },
  mobility: {
    mobilityLevel: "assisted",
    repositioningPlan: "Cambio de posición cada 2h",
  },
  skin: {
    skinStatus: "Integridad conservada",
    hasPressureInjury: false,
  },
  fluidBalance: {
    intakeMl: 2000,
    outputMl: 1800,
    netBalanceMl: 200,
    notes: "Balance positivo leve",
  },
  painAssessment: {
    hasPain: true,
    evaScore: 3,
    location: "Herida quirúrgica",
    actionsTaken: "Analgesia pautada",
  },
  braden: {
    sensoryPerception: 3,
    moisture: 3,
    activity: 3,
    mobility: 3,
    nutrition: 3,
    frictionShear: 3,
    totalScore: 18,
    riskLevel: "bajo",
  },
  glasgow: {
    eye: 4,
    verbal: 5,
    motor: 6,
    total: 15,
    severity: "leve",
  },
  bedsideChecklist: {
    patientIdentityConfirmed: true,
    allergiesReviewed: true,
    linesAndDevicesChecked: true,
    medicationPlanReviewed: true,
    safetyMeasuresApplied: true,
    questionsAnswered: true,
    bedsideNotes: "Checklist completo",
  },
  risks: {
    fall: false,
    pressureUlcer: false,
    isolation: false,
  },
  risksStructured: [
    { type: "fall", present: false, notes: "Sin riesgo", actions: [] },
  ],
  signatures: {
    outgoing: {
      userId: "nurse-out",
      fullName: "Enfermera Saliente",
      unitId: "UCI-1",
      signedAt: "2024-01-01T16:05:00.000Z",
      imageBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ",
      method: "session",
    },
  },
  audioUri: "https://example.com/audio.m4a",
};

describe("zHandover", () => {
  it("acepta datos clínicos completos y coherentes", () => {
    const result = zHandover.safeParse(baseValidData);
    expect(result.success).toBe(true);
  });

  it("rechaza campos obligatorios vacíos", () => {
    const invalid: Partial<HandoverFormData> = {
      dxMedical: baseValidData.dxMedical,
      dxNursing: baseValidData.dxNursing,
      administrativeData: {
        unit: "",
        census: -1,
        staffIn: [],
        staffOut: [],
        shiftStart: "2024-01-01T16:00:00.000Z",
        shiftEnd: "2024-01-01T08:00:00.000Z",
        shiftType: "Mañana",
      },
      patientId: "",
      bedsideChecklist: {
        patientIdentityConfirmed: false,
        allergiesReviewed: false,
        linesAndDevicesChecked: false,
        medicationPlanReviewed: false,
        safetyMeasuresApplied: false,
        questionsAnswered: false,
      },
    };

    const result = zHandover.safeParse(invalid);
    expect(result.success).toBe(false);
    const messages = result.success ? [] : result.error.issues.map((i) => i.message);
    expect(messages).toContain("Unidad requerida");
    expect(messages).toContain("El censo no puede ser negativo");
    expect(messages).toContain("Al menos 1 persona");
    expect(messages).toContain("El fin del turno debe ser posterior al inicio");
    expect(messages).toContain("ID paciente requerido");
    expect(
      messages.some((msg) =>
        msg.includes(
          "Confirma la identidad del paciente y revisa las alergias antes de cerrar el pase de turno.",
        ),
      ),
    ).toBe(true);
  });

  it("valida rangos de signos vitales", () => {
    const invalidVitals: HandoverFormData = {
      ...baseValidData,
      vitals: { ...baseValidData.vitals, hr: 400, spo2: 20 },
    };

    const result = zHandover.safeParse(invalidVitals);
    expect(result.success).toBe(false);
    const messages = result.success ? [] : result.error.issues.map((i) => i.message);
    expect(messages).toContain("Frecuencia cardiaca fuera de rango");
    expect(messages).toContain("SpO₂ fuera de rango");
  });

  it("acepta diagnósticos SNOMED válidos", () => {
    const valid: HandoverFormData = {
      ...baseValidData,
      dxMedical: { system: SNOMED_SYSTEM, code: "25064002", display: "Dolor torácico" },
    };

    const result = zHandover.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rechaza términos SNOMED no reconocidos", () => {
    const invalid: HandoverFormData = {
      ...baseValidData,
      dxMedical: { system: SNOMED_SYSTEM, code: "25064002", display: "dolor de pecho" },
    };

    const result = zHandover.safeParse(invalid);
    expect(result.success).toBe(false);
    const messages = result.success ? [] : result.error.issues.map((i) => i.message);
    expect(messages).toContain("Término no reconocido (SNOMED)");
  });

  it("rechaza códigos SNOMED inconsistentes con el término", () => {
    const invalid: HandoverFormData = {
      ...baseValidData,
      dxMedical: { system: SNOMED_SYSTEM, code: "386661006", display: "Dolor torácico" },
    };

    const result = zHandover.safeParse(invalid);
    expect(result.success).toBe(false);
    const messages = result.success ? [] : result.error.issues.map((i) => i.message);
    expect(messages).toContain("Código SNOMED no corresponde al término");
  });

  it("prioriza mg/dL cuando ambos valores de glucosa están presentes", () => {
    const payload: HandoverFormData = {
      ...baseValidData,
      vitals: { ...baseValidData.vitals, glucoseMgDl: 90, glucoseMmolL: 2 },
    };

    const result = zHandover.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.vitals?.glucoseMgDl).toBe(90);
      expect(result.data.vitals?.glucoseMmolL).toBeCloseTo(5, 1);
    }
  });

  it("valida consistencia de Braden", () => {
    const invalidBraden: HandoverFormData = {
      ...baseValidData,
      braden: {
        sensoryPerception: 4,
        moisture: 4,
        activity: 4,
        mobility: 4,
        nutrition: 4,
        frictionShear: 4,
        totalScore: 10,
        riskLevel: "alto",
      },
    };

    const result = zHandover.safeParse(invalidBraden);
    expect(result.success).toBe(false);
    const messages = result.success ? [] : result.error.issues.map((i) => i.message);
    expect(messages).toContain("El puntaje total debe ser igual a la suma de las subescalas.");
  });


  it('acepta payload legacy con solo dxNursing como texto libre', () => {
    const payload = {
      ...baseValidData,
      dxNursing: 'Dolor agudo',
      dxNursingStructured: [],
    };

    const result = zHandover.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dxNursing).toBe('Dolor agudo');
      expect(result.data.dxNursingStructured ?? []).toHaveLength(0);
    }
  });

  it('acepta payload legacy con dxNursing como objeto y lo normaliza a texto (display)', () => {
    const payload = {
      ...baseValidData,
      dxNursing: { system: SNOMED_SYSTEM, code: '386661006', display: 'Fiebre' },
      dxNursingStructured: [],
    };

    const result = zHandover.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dxNursing).toBe('Fiebre');
    }
  });

  it('deriva dxNursing legacy desde el primer NANDA cuando solo hay diagnóstico estructurado', () => {
    const payload = {
      ...baseValidData,
      dxNursing: '',
      dxNursingStructured: [
        { system: 'NANDA', code: '00030', display: 'Deterioro del intercambio gaseoso' },
      ],
    };

    const result = zHandover.safeParse(payload);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dxNursing).toContain('Deterioro del intercambio gaseoso');
    }
  });

  it('acepta tratamientos con codificacion NIC opcional', () => {
    const payload: HandoverFormData = {
      ...baseValidData,
      treatments: [
        {
          id: 'treat-nic-1',
          type: 'other',
          description: 'Control del dolor',
          done: false,
          code: {
            system: 'NIC',
            code: '2210',
            display: 'Administracion de analgesicos',
          },
        },
      ],
    };

    const result = zHandover.safeParse(payload);
    expect(result.success).toBe(true);
  });
});

