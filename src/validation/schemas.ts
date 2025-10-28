import { z } from "zod";

export const zVitals = z.object({
  hr: z.number().int().min(30).max(220).optional(),
  rr: z.number().int().min(5).max(60).optional(),
  temp: z.number().min(30).max(45).optional(),
  spo2: z.number().int().min(50).max(100).optional(),
  sbp: z.number().int().min(50).max(260).optional(),
  dbp: z.number().int().min(30).max(160).optional(),
  bgMgDl: z.number().int().min(20).max(600).optional(),
});

export const zHandover = z.object({
  // Admin
  unitId: z.string().min(1, "Unidad requerida"),
  start: z.string().min(10, "Inicio requerido"),
  end: z.string().min(10, "Fin requerido"),
  staffIn: z.string().optional(),
  staffOut: z.string().optional(),

  // Paciente (se llena luego en Lote 1B)
  patientId: z.string().min(1, "ID paciente requerido"),

  // Signos (se completa en 1C)
  vitals: zVitals.optional(),

  // Diagnóstico/Evolución (se mejora en 1D)
  dxMedical: z.string().optional(),
  dxNursing: z.string().optional(),
  evolution: z.string().optional(),

  // Multimedia
  audioUri: z.string().url().optional()
});

export type HandoverValues = z.infer<typeof zHandover>;
