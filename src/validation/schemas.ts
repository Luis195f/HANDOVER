import { z } from "zod";

import {
  DIET_TYPES,
  MOBILITY_LEVELS,
  STOOL_PATTERNS,
  // BEGIN HANDOVER D1 – BedsideChecklist types
  type HandoverBedsideChecklist,
  // END HANDOVER D1 – BedsideChecklist types
  type MedicationItem,
  type TreatmentItem,
  type EliminationInfo,
  type FluidBalanceInfo,
  type MobilityInfo,
  type NutritionInfo,
  type PainAssessment,
  type SkinInfo,
  type BradenScale,
  type GlasgowScale,
  type RiskFlags,
} from "../types/handover";

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
    unit: z.string().min(1, "La unidad es obligatoria"),
    census: z
      .preprocess(parseCensus, z.number().int().min(0, "El censo no puede ser negativo"))
      .default(0),
    staffIn: z.array(z.string().min(1, "Nombre requerido")).default([]),
    staffOut: z.array(z.string().min(1, "Nombre requerido")).default([]),
    shiftStart: z.string().min(1, "Inicio de turno requerido"),
    shiftEnd: z.string().min(1, "Fin de turno requerido"),
    incidents: z.array(z.string().min(1)).optional(),
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
    .min(30)
    .max(220)
    .describe('Frecuencia cardiaca (LOINC 8867-4) en latidos por minuto')
    .optional(),
  rr: z
    .number()
    .int()
    .min(5)
    .max(60)
    .describe('Frecuencia respiratoria (LOINC 9279-1) en respiraciones por minuto')
    .optional(),
  tempC: z
    .number()
    .min(30)
    .max(45)
    .describe('Temperatura corporal en °C mapeada a LOINC 8310-5')
    .optional(),
  spo2: z
    .number()
    .int()
    .min(50)
    .max(100)
    .describe('Saturación de oxígeno (LOINC 59408-5) en porcentaje')
    .optional(),
  sbp: z
    .number()
    .int()
    .min(50)
    .max(260)
    .describe('Presión sistólica (LOINC 8480-6) en mmHg')
    .optional(),
  dbp: z
    .number()
    .int()
    .min(30)
    .max(160)
    .describe('Presión diastólica (LOINC 8462-4) en mmHg')
    .optional(),
  glucoseMgDl: z
    .number()
    .min(20)
    .max(600)
    .describe('Glucemia capilar mg/dL (LOINC 2339-0)')
    .optional(),
  glucoseMmolL: z
    .number()
    .min(1)
    .max(55)
    .describe('Glucemia capilar mmol/L (LOINC 15074-8)')
    .optional(),
  avpu: z
    .enum(["A", "C", "V", "P", "U"])
    .describe('Escala AVPU codificada con SNOMED/LOINC para el mapeo a FHIR')
    .optional(),
});

export const zOxygen = z
  .object({
    flowLMin: z.number().min(0).max(80).optional(),
    device: z.string().optional(),
    fio2: z.number().min(0).max(100).optional(),
  })
  .partial();

export const zPainAssessment: z.ZodSchema<PainAssessment> = z
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
  });

const zBradenSubscale = z.number().int().min(1).max(4);

export const zBradenScale: z.ZodSchema<BradenScale> = z
  .object({
    sensoryPerception: zBradenSubscale,
    moisture: zBradenSubscale,
    activity: zBradenSubscale,
    mobility: zBradenSubscale,
    nutrition: zBradenSubscale,
    frictionShear: z.number().int().min(1).max(4),
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

    let expectedRisk: BradenScale["riskLevel"];
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

export const zGlasgowScale: z.ZodSchema<GlasgowScale> = z
  .object({
    eye: z.number().int().min(1).max(4),
    verbal: z.number().int().min(1).max(5),
    motor: z.number().int().min(1).max(6),
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

    let expectedSeverity: GlasgowScale["severity"];
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

export const zNutritionInfo: z.ZodSchema<NutritionInfo> = z.object({
  dietType: z.enum(DIET_TYPES),
  tolerance: z.string().optional(),
  intakeMl: z.number().nonnegative().optional(),
});

export const zEliminationInfo: z.ZodSchema<EliminationInfo> = z.object({
  urineMl: z.number().nonnegative().optional(),
  stoolPattern: z.enum(STOOL_PATTERNS).optional(),
  hasRectalTube: z.boolean().optional(),
});

export const zMobilityInfo: z.ZodSchema<MobilityInfo> = z.object({
  mobilityLevel: z.enum(MOBILITY_LEVELS),
  repositioningPlan: z.string().optional(),
});

export const zSkinInfo: z.ZodSchema<SkinInfo> = z.object({
  skinStatus: z.string().min(1, "Estado de piel requerido"),
  hasPressureInjury: z.boolean().optional(),
});

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
export const zHandoverBedsideChecklist: z.ZodSchema<HandoverBedsideChecklist> = z.object({
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
  notes: z.string().max(1000).optional(),
  actions: z.array(z.string()).default([]),
});
export type RiskItem = z.infer<typeof zRiskItem>;

export const zRiskFlags: z.ZodSchema<RiskFlags> = z
  .object({
    fall: z.boolean().optional(),
    pressureUlcer: z.boolean().optional(),
    isolation: z.boolean().optional(),
  })
  .partial();

// BEGIN HANDOVER D3 – StructuredDiagnosis schema
export const zHandoverStructuredDiagnosis = z.object({
  system: z
    .union([z.literal('NANDA'), z.literal('SNOMED'), z.literal('ICD10'), z.literal('OTHER')])
    .describe('Sistema de codificación: SNOMED CT (dx médicos), NANDA o ICD10'),
  code: z
    .string()
    .min(1, 'El código no puede estar vacío')
    .describe('Código del diagnóstico según el sistema seleccionado (SNOMED/ICD10/NANDA)'),
  display: z
    .string()
    .min(1, 'La descripción no puede estar vacía')
    .describe('Descripción legible asociada al código SNOMED/NANDA'),
  freeTextNote: z.string().optional(),
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
const optionalScheduleString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

const zMedicationItemBase: z.ZodSchema<MedicationItem> = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  code: z
    .object({
      system: z.string().min(1),
      code: z.string().min(1),
      display: z.string().min(1),
    })
    .optional(),
  route: zMedicationRoute.optional(),
  dose: z.string().min(1).optional(),
  frequency: z.string().min(1).optional(),
  isContinuous: z.boolean().optional(),
  isContinuousInfusion: z.boolean().optional(),
  startTime: optionalScheduleString,
  endTime: optionalScheduleString,
  isHighAlert: z.boolean().optional(),
  notes: z.string().optional(),
  signature: z.lazy(() => zHandoverSignature).optional(),
});

export const zMedicationItem: z.ZodSchema<MedicationItem> = zMedicationItemBase.transform(
  (item) => ({
    ...item,
    isContinuous: item.isContinuous ?? item.isContinuousInfusion,
    isContinuousInfusion: item.isContinuousInfusion ?? item.isContinuous,
  }),
);
// END HANDOVER D7 – MedicationModule

export const zTreatmentItem: z.ZodSchema<TreatmentItem> = z.object({
  id: z.string().min(1),
  type: z.enum(["woundCare", "respiratory", "mobilization", "education", "other"]),
  description: z.string().min(1),
  scheduledAt: z.string().datetime().optional(),
  done: z.boolean().optional(),
});

// BEGIN HANDOVER: SIGNATURES_DUAL
const zHandoverSignatureBase = z.object({
  userId: z.string().min(1, "Falta identificador de usuario para la firma"),
  fullName: z.string().min(1, "Falta nombre completo en la firma"),
  role: z.enum(["nurse", "admin", "supervisor"]).optional(),
  unitId: z.string().min(1, "Falta unidad clínica en la firma"),
  signedAt: z.string().datetime().or(z.string()).describe("ISO timestamp de firma"),
  deviceInfo: z.string().optional(),
  method: z.enum(["session", "pin", "biometric"]).default("session"),
});

export const zHandoverSignature = zHandoverSignatureBase;
// END HANDOVER: SIGNATURES_DUAL

export const zFluidBalanceInfo: z.ZodSchema<FluidBalanceInfo> = z.object({
  intakeMl: z.number().nonnegative({ message: "No puede ser negativo" }),
  outputMl: z.number().nonnegative({ message: "No puede ser negativo" }),
  netBalanceMl: z.number().optional(),
  notes: z.string().optional(),
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

export const zHandover = z.object({
  administrativeData: zAdministrativeData,

  status: z.enum(["draft", "final"]).default("draft"),

  // Paciente (se llena luego en Lote 1B)
  patientId: z.string().min(1, "ID paciente requerido"),

  // Signos (se completa en 1C)
  vitals: zVitals.optional(),

  // Diagnóstico/Evolución (se mejora en 1D)
  dxMedical: z.string().optional(),
  dxNursing: z.string().optional(),
  dxMedicalStructured: zHandoverStructuredDiagnosisArray,
  dxNursingStructured: zHandoverStructuredDiagnosisArray,
  evolution: z.string().optional(),
  closingSummary: z.string().optional(),

  sbarSituation: z.string().optional(),
  sbarBackground: z.string().optional(),
  sbarAssessment: z.string().optional(),
  sbarRecommendation: z.string().optional(),

  meds: z.string().optional(),

  medications: z.array(zMedicationItem).default([]),
  treatments: z.array(zTreatmentItem).default([]),

  oxygenTherapy: zOxygen.optional(),

  nutrition: zNutritionInfo.optional(),
  elimination: zEliminationInfo.optional(),
  mobility: zMobilityInfo.optional(),
  skin: zSkinInfo.optional(),
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
  audioUri: z.string().min(1).optional()
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

export type HandoverValues = z.infer<typeof zHandover>;
