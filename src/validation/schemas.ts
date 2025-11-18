import { z } from "zod";

import {
  DIET_TYPES,
  MOBILITY_LEVELS,
  STOOL_PATTERNS,
  type EliminationInfo,
  type FluidBalanceInfo,
  type MobilityInfo,
  type NutritionInfo,
  type PainAssessment,
  type SkinInfo,
  type BradenScale,
  type GlasgowScale,
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
  hr: z.number().int().min(30).max(220).optional(),
  rr: z.number().int().min(5).max(60).optional(),
  tempC: z.number().min(30).max(45).optional(),
  spo2: z.number().int().min(50).max(100).optional(),
  sbp: z.number().int().min(50).max(260).optional(),
  dbp: z.number().int().min(30).max(160).optional(),
  glucoseMgDl: z.number().min(20).max(600).optional(),
  glucoseMmolL: z.number().min(1).max(55).optional(),
  avpu: z.enum(["A", "C", "V", "P", "U"]).optional(),
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

  // Paciente (se llena luego en Lote 1B)
  patientId: z.string().min(1, "ID paciente requerido"),

  // Signos (se completa en 1C)
  vitals: zVitals.optional(),

  // Diagnóstico/Evolución (se mejora en 1D)
  dxMedical: z.string().optional(),
  dxNursing: z.string().optional(),
  evolution: z.string().optional(),

  sbarSituation: z.string().optional(),
  sbarBackground: z.string().optional(),
  sbarAssessment: z.string().optional(),
  sbarRecommendation: z.string().optional(),

  meds: z.string().optional(),

  oxygenTherapy: zOxygen.optional(),

  nutrition: zNutritionInfo.optional(),
  elimination: zEliminationInfo.optional(),
  mobility: zMobilityInfo.optional(),
  skin: zSkinInfo.optional(),
  fluidBalance: zFluidBalanceInfo.optional(),
  painAssessment: zPainAssessment.optional(),
  braden: zBradenScale.optional(),
  glasgow: zGlasgowScale.optional(),

  // Multimedia
  audioUri: z.string().min(1).optional()
});

export type HandoverValues = z.infer<typeof zHandover>;
