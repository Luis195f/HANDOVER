import { z } from "zod";

import { SHIFT_TYPES } from "../types/administrative";
import { DIET_TYPES, MOBILITY_LEVELS, STOOL_PATTERNS } from "../types/handover-constants";

const optionalTrimmedString = (maxLength: number) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (typeof value !== "string") return undefined;
      const trimmed = value.trim();
      return trimmed === "" ? undefined : trimmed;
    })
    .refine((value) => value === undefined || value.length <= maxLength, {
      message: `Debe tener máximo ${maxLength} caracteres`,
    });

const parseCensus = (value: unknown) => {
  if (typeof value === "string") {
    const normalized = value.replace(",", ".").trim();
    if (!normalized) return undefined;
    const parsed = Number(normalized);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return value;
};

export const zAdministrativeData = z
  .object({
    unit: z.string().trim().min(1, "Unidad requerida").max(80),
    census: z
      .preprocess(
        parseCensus,
        z
          .number()
          .int()
          .min(0, "El censo no puede ser negativo")
          .max(200, "El censo no puede superar 200 pacientes"),
      )
      .default(0),
    staffIn: z
      .array(z.string().trim().min(1, "Requerido").max(100))
      .min(1, "Al menos 1 persona")
      .default([]),
    staffOut: z
      .array(z.string().trim().min(1, "Requerido").max(100))
      .min(1, "Al menos 1 persona")
      .default([]),
    shiftStart: z.string().min(1, "Inicio obligatorio"),
    shiftEnd: z.string().min(1, "Fin obligatorio"),
    shiftType: z.enum(SHIFT_TYPES, {
      errorMap: () => ({ message: "Turno requerido" }),
    }),
    generalNotes: optionalTrimmedString(500),
    incidents: z.array(z.string().trim().min(1).max(500)).optional(),
  })
  .superRefine((data, ctx) => {
    const start = Date.parse(data.shiftStart);
    const end = Date.parse(data.shiftEnd);
    if (Number.isFinite(start) && Number.isFinite(end) && end <= start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "El fin del turno debe ser posterior al inicio",
        path: ["shiftEnd"],
      });
    }
  });

export const zVitals = z.object({
  hr: z
    .number()
    .int()
    .min(30, "Frecuencia cardiaca fuera de rango")
    .max(220, "Frecuencia cardiaca fuera de rango")
    .describe('Frecuencia cardiaca (LOINC 8867-4) en latidos por minuto')
    .optional(),
  rr: z
    .number()
    .int()
    .min(5, "Frecuencia respiratoria fuera de rango")
    .max(60, "Frecuencia respiratoria fuera de rango")
    .describe('Frecuencia respiratoria (LOINC 9279-1) en respiraciones por minuto')
    .optional(),
  tempC: z
    .number()
    .min(30, "Temperatura fuera de rango")
    .max(45, "Temperatura fuera de rango")
    .describe('Temperatura corporal en °C mapeada a LOINC 8310-5')
    .optional(),
  spo2: z
    .number()
    .int()
    .min(50, "SpO₂ fuera de rango")
    .max(100, "SpO₂ fuera de rango")
    .describe('Saturación de oxígeno (LOINC 59408-5) en porcentaje')
    .optional(),
  sbp: z
    .number()
    .int()
    .min(50, "Presión arterial fuera de rango")
    .max(260, "Presión arterial fuera de rango")
    .describe('Presión sistólica (LOINC 8480-6) en mmHg')
    .optional(),
  dbp: z
    .number()
    .int()
    .min(30, "Presión arterial fuera de rango")
    .max(160, "Presión arterial fuera de rango")
    .describe('Presión diastólica (LOINC 8462-4) en mmHg')
    .optional(),
  glucoseMgDl: z
    .number()
    .min(20, "Glucemia fuera de rango")
    .max(600, "Glucemia fuera de rango")
    .describe('Glucemia capilar mg/dL (LOINC 2339-0)')
    .optional(),
  glucoseMmolL: z
    .number()
    .min(1, "Glucemia fuera de rango")
    .max(55, "Glucemia fuera de rango")
    .describe('Glucemia capilar mmol/L (LOINC 15074-8)')
    .optional(),
  avpu: z
    .enum(["A", "C", "V", "P", "U"])
    .describe('Escala AVPU codificada con SNOMED/LOINC para el mapeo a FHIR')
    .optional(),
}).superRefine((value, ctx) => {
  if (
    typeof value.glucoseMgDl === "number" &&
    typeof value.glucoseMmolL === "number"
  ) {
    const convertedMmol = value.glucoseMmolL * 18;
    const tolerance = 15; // mg/dL de tolerancia
    if (Math.abs(convertedMmol - value.glucoseMgDl) > tolerance) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Las glucemias en mg/dL y mmol/L deben ser coherentes",
        path: ["glucoseMmolL"],
      });
    }
  }

  if (typeof value.sbp === "number" && typeof value.dbp === "number" && value.dbp >= value.sbp) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "La presión diastólica debe ser menor que la sistólica",
      path: ["dbp"],
    });
  }
});

export const zOxygen = z
  .object({
    flowLMin: z.number().min(0).max(80).optional(),
    device: z.string().optional(),
    fio2: z.number().min(0).max(100).optional(),
  })
  .partial();

export const zPainAssessment = z
  .object({
    hasPain: z.boolean(),
    evaScore: z.number().min(0).max(10).nullable().optional(),
    location: z.string().max(200).nullable().optional(),
    actionsTaken: z.string().max(500).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.hasPain && value.evaScore == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evaScore"],
        message: "Ingrese una EVA entre 0 y 10 cuando el paciente tiene dolor.",
      });
    }

    if (!value.hasPain && value.evaScore != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evaScore"],
        message: "No debe registrar EVA si el paciente no refiere dolor.",
      });
    }
  });

const zBradenSubscale = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);

export const zBradenScale = z
  .object({
    sensoryPerception: zBradenSubscale,
    moisture: zBradenSubscale,
    activity: zBradenSubscale,
    mobility: zBradenSubscale,
    nutrition: zBradenSubscale,
    frictionShear: zBradenSubscale,
    totalScore: z.number().int().min(6).max(24),
    riskLevel: z.enum(["alto", "moderado", "bajo", "sin_riesgo"]),
  })
  .superRefine((value, ctx) => {
    const computedTotal =
      value.sensoryPerception +
      value.moisture +
      value.activity +
      value.mobility +
      value.nutrition +
      value.frictionShear;

    if (value.totalScore !== computedTotal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["totalScore"],
        message: "El puntaje total debe ser igual a la suma de las subescalas.",
      });
    }

    let expectedRisk: "alto" | "moderado" | "bajo" | "sin_riesgo";
    if (computedTotal <= 12) expectedRisk = "alto";
    else if (computedTotal <= 14) expectedRisk = "moderado";
    else if (computedTotal <= 18) expectedRisk = "bajo";
    else expectedRisk = "sin_riesgo";

    if (value.riskLevel !== expectedRisk) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["riskLevel"],
        message: "El nivel de riesgo no coincide con el puntaje total.",
      });
    }
  });

const zGlasgowEye = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
const zGlasgowVerbal = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
const zGlasgowMotor = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);

export const zGlasgowScale = z
  .object({
    eye: zGlasgowEye,
    verbal: zGlasgowVerbal,
    motor: zGlasgowMotor,
    total: z.number().int().min(3).max(15),
    severity: z.enum(["grave", "moderado", "leve"]),
  })
  .superRefine((value, ctx) => {
    const computedTotal = value.eye + value.verbal + value.motor;

    if (value.total !== computedTotal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["total"],
        message: "El puntaje total debe ser igual a la suma de ojo + verbal + motor.",
      });
    }

    let expectedSeverity: "grave" | "moderado" | "leve";
    if (computedTotal <= 8) expectedSeverity = "grave";
    else if (computedTotal <= 12) expectedSeverity = "moderado";
    else expectedSeverity = "leve";

    if (value.severity !== expectedSeverity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["severity"],
        message: "La severidad no coincide con el puntaje total.",
      });
    }
  });

export const zNutritionInfo = z.object({
  dietType: z.enum(DIET_TYPES),
  tolerance: optionalTrimmedString(200).optional(),
  intakeMl: z.number().nonnegative().max(20000).optional(),
});

export const zEliminationInfo = z.object({
  urineMl: z.number().nonnegative().max(20000).optional(),
  stoolPattern: z.enum(STOOL_PATTERNS).optional(),
  hasRectalTube: z.boolean().optional(),
});

export const zDeviceItem = z.object({
  name: z.string().trim().min(1, "Detalle requerido").max(200),
  active: z.boolean().default(true),
});

export const zMobilityInfo = z.object({
  mobilityLevel: z.enum(MOBILITY_LEVELS),
  repositioningPlan: optionalTrimmedString(300).optional(),
});

export const zSkinInfo = z.object({
  skinStatus: z.string().trim().min(1, "Estado de piel requerido").max(200),
  hasPressureInjury: z.boolean().optional(),
});

export const zPsychosocialCare = z
  .object({
    emotionalStatus: z.string().trim().min(1).optional(),
    familyNotes: z.string().trim().min(1).optional(),
    familyVisits: z.boolean().optional(), // tri-estado: undefined/true/false
  })
  .partial();

export const zRiskType = z.enum([
  "fall",
  "pressureUlcer",
  "isolation",
  "seizure",
  "suicide",
  "deviceDisconnection",
  "infection",
  "other",
]);
export type RiskType = z.infer<typeof zRiskType>;

// BEGIN HANDOVER D1 – BedsideChecklist
export const zHandoverBedsideChecklist = z.object({
  patientIdentityConfirmed: z.boolean().default(false),
  allergiesReviewed: z.boolean().default(false),
  linesAndDevicesChecked: z.boolean().default(false),
  medicationPlanReviewed: z.boolean().default(false),
  safetyMeasuresApplied: z.boolean().default(false),
  questionsAnswered: z.boolean().default(false),
  bedsideNotes: z.string().max(500).optional(),
});
// END HANDOVER D1 – BedsideChecklist

export const zRiskItem = z.object({
  type: zRiskType,
  present: z.boolean(),
  notes: optionalTrimmedString(500).optional(),
  actions: z.array(z.string().trim().min(1).max(200)).default([]),
});
export type RiskItem = z.infer<typeof zRiskItem>;

export const zRiskFlags = z
  .object({
    fall: z.boolean().optional(),
    pressureUlcer: z.boolean().optional(),
    isolation: z.boolean().optional(),
  })
  .partial();

export const zExamItem = z.object({
  type: z.enum(["laboratory", "imaging", "other"]),
  state: z.enum(["result", "pending"]).default("result"),
  description: z
    .string()
    .trim()
    .min(1, "Detalle requerido")
    .max(200, "Máx. 200 caracteres"),
});

export const zProcedureItem = z.object({
  description: z
    .string()
    .trim()
    .min(1, "Detalle requerido")
    .max(200, "Máx. 200 caracteres"),
  done: z.boolean().default(false),
});

// BEGIN HANDOVER D3 – StructuredDiagnosis schema
export const zHandoverStructuredDiagnosis = z.object({
  system: z
    .union([z.literal('NANDA'), z.literal('SNOMED'), z.literal('ICD10'), z.literal('OTHER')])
    .describe('Sistema de codificación: SNOMED CT (dx médicos), NANDA o ICD10'),
  code: z
    .string()
    .trim()
    .min(1, 'El código no puede estar vacío')
    .max(50)
    .describe('Código del diagnóstico según el sistema seleccionado (SNOMED/ICD10/NANDA)'),
  display: z
    .string()
    .trim()
    .min(1, 'La descripción no puede estar vacía')
    .max(200)
    .describe('Descripción legible asociada al código SNOMED/NANDA'),
  freeTextNote: optionalTrimmedString(300).optional(),
});

export const zHandoverStructuredDiagnosisArray = z
  .array(zHandoverStructuredDiagnosis)
  .optional();
// END HANDOVER D3 – StructuredDiagnosis schema

export const zMedicationRoute = z.enum([
  "oral",
  "iv",
  "im",
  "sc",
  "inhaled",
  "topical",
  "other",
]);

// BEGIN HANDOVER D7 – MedicationModule
const optionalScheduleString = z
  .string()
  .optional()
  .transform((value) => {
    if (typeof value !== "string") return undefined;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  })
  .refine((value) => value === undefined || value.length >= 1, {
    message: "Debe tener al menos 1 caracter",
  });

const zMedicationItemBase = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  code: z
    .object({
      system: z.string().trim().min(1).max(50),
      code: z.string().trim().min(1).max(50),
      display: z.string().trim().min(1).max(120),
    })
    .optional(),
  route: zMedicationRoute.optional(),
  dose: z.string().trim().min(1).max(80).optional(),
  frequency: z.string().trim().min(1).max(80).optional(),
  isContinuous: z.boolean().optional(),
  isContinuousInfusion: z.boolean().optional(),
  startTime: optionalScheduleString,
  endTime: optionalScheduleString,
  isHighAlert: z.boolean().optional(),
  notes: optionalTrimmedString(500).optional(),
  signature: z.lazy(() => zHandoverSignature).optional(),
});

export const zMedicationItem = zMedicationItemBase.transform(
  (item) => ({
    ...item,
    isContinuous: item.isContinuous ?? item.isContinuousInfusion,
    isContinuousInfusion: item.isContinuousInfusion ?? item.isContinuous,
  }),
);
// END HANDOVER D7 – MedicationModule

export const zTreatmentItem = z.object({
  id: z.string().min(1),
  type: z.enum(["woundCare", "respiratory", "mobilization", "education", "other"]),
  description: z.string().trim().min(1).max(500),
  scheduledAt: z.string().datetime().optional(),
  done: z.boolean().optional(),
});

// BEGIN HANDOVER: SIGNATURES_DUAL
const zHandoverSignatureBase = z.object({
  userId: z.string().min(1, "Falta identificador de usuario para la firma"),
  fullName: z.string().trim().min(1, "Falta nombre completo en la firma").max(100),
  role: z.enum(["nurse", "admin", "supervisor"]).optional(),
  unitId: z.string().trim().min(1, "Falta unidad clínica en la firma").max(80),
  signedAt: z.string().datetime().or(z.string()).describe("ISO timestamp de firma"),
  deviceInfo: z.string().optional(),
  method: z.enum(["session", "pin", "biometric"]).default("session"),
});

export const zHandoverSignature = zHandoverSignatureBase;
// END HANDOVER: SIGNATURES_DUAL

export const zFluidBalanceInfo = z.object({
  intakeMl: z.number().nonnegative({ message: "No puede ser negativo" }),
  outputMl: z.number().nonnegative({ message: "No puede ser negativo" }),
  netBalanceMl: z.number().optional(),
  notes: optionalTrimmedString(300).optional(),
}).superRefine((data, ctx) => {
  if (typeof data.netBalanceMl === "number") {
    const expected = data.intakeMl - data.outputMl;
    if (data.netBalanceMl !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "El balance neto no coincide con los datos ingresados",
        path: ["netBalanceMl"],
      });
    }
  }
});

const zFileAttachment = z.object({
  uri: z.string().url(),
  contentType: z.string().min(1),
  name: z.string().trim().min(1).optional(),
  data: z.string().min(1),
});

export const zHandover = z.object({
  administrativeData: zAdministrativeData,

  status: z.enum(["draft", "final"]).default("draft"),

  // Paciente (se llena luego en Lote 1B)
  patientId: z.string().min(1, "ID paciente requerido"),

  // Signos (se completa en 1C)
  vitals: zVitals.optional(),

  // Diagnóstico/Evolución (se mejora en 1D)
  dxMedical: optionalTrimmedString(500).optional(),
  dxNursing: optionalTrimmedString(500).optional(),
  dxMedicalStructured: zHandoverStructuredDiagnosisArray,
  dxNursingStructured: zHandoverStructuredDiagnosisArray,
  evolution: optionalTrimmedString(1200).optional(),
  closingSummary: optionalTrimmedString(1500).optional(),

  sbarSituation: optionalTrimmedString(800).optional(),
  sbarBackground: optionalTrimmedString(800).optional(),
  sbarAssessment: optionalTrimmedString(800).optional(),
  sbarRecommendation: optionalTrimmedString(800).optional(),

  meds: optionalTrimmedString(1000).optional(),

  medications: z.array(zMedicationItem).default([]),
  treatments: z.array(zTreatmentItem).default([]),
  exams: z.array(zExamItem).default([]),
  procedures: z.array(zProcedureItem).default([]),

  oxygenTherapy: zOxygen.optional(),
  devices: z.array(zDeviceItem).default([]),

  nutrition: zNutritionInfo.optional(),
  elimination: zEliminationInfo.optional(),
  mobility: zMobilityInfo.optional(),
  skin: zSkinInfo.optional(),
  psychosocial: zPsychosocialCare.optional(),
  fluidBalance: zFluidBalanceInfo.optional(),
  painAssessment: zPainAssessment.optional(),
  braden: zBradenScale.optional(),
  glasgow: zGlasgowScale.optional(),
  // BEGIN HANDOVER D1 – BedsideChecklist
  bedsideChecklist: zHandoverBedsideChecklist,
  // END HANDOVER D1 – BedsideChecklist
  // Deprecated: usar risksStructured para nuevos flujos
  risks: zRiskFlags.optional(),
  risksStructured: z.array(zRiskItem).default([]),

  signatures: z
    .object({
      outgoing: zHandoverSignature.optional(),
      incoming: zHandoverSignature.optional(),
    })
    .optional(),

  // Multimedia
  audioUri: z.string().trim().min(1).max(500).optional(),
  attachments: z.array(zFileAttachment).default([])
}).superRefine((value, ctx) => {
  // BEGIN HANDOVER D1 – BedsideChecklist rules
  const checklist = value.bedsideChecklist;
  if (!checklist.patientIdentityConfirmed || !checklist.allergiesReviewed) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["bedsideChecklist"],
      message:
        "Confirma la identidad del paciente y revisa las alergias antes de cerrar el pase de turno.",
    });
  }
  // END HANDOVER D1 – BedsideChecklist rules

  if (value.status === "final" && !value.signatures?.outgoing) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["signatures", "outgoing"],
      message: "La entrega final debe tener firma de enfermera saliente.",
    });
  }
});

export type HandoverFormData = z.output<typeof zHandover>;
export type HandoverValues = z.output<typeof zHandover>;
export type HandoverInputValues = z.input<typeof zHandover>;
