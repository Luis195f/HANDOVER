import { z } from "zod";

import {
  DIET_TYPES,
  MOBILITY_LEVELS,
  STOOL_PATTERNS,
  type EliminationInfo,
  type FluidBalanceInfo,
  type MobilityInfo,
  type NutritionInfo,
  type SkinInfo,
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
  intakeMl: z.number().nonnegative(),
  outputMl: z.number().nonnegative(),
  netBalanceMl: z.number().optional(),
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

  // Multimedia
  audioUri: z.string().min(1).optional()
});

export type HandoverValues = z.infer<typeof zHandover>;
