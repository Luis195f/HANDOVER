import { z } from "zod";

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
  vitals: z.object({
    hr: z.number().int().min(0).max(250).optional(),
    rr: z.number().int().min(0).max(80).optional(),
    temp: z.number().min(25).max(45).optional(),
    spo2: z.number().min(0).max(100).optional(),
    sbp: z.number().int().min(40).max(300).optional(),
    dbp: z.number().int().min(20).max(200).optional(),
    bgMgDl: z.number().min(10).max(1000).optional()
  }).default({}),

  // Diagnóstico/Evolución (se mejora en 1D)
  dxMedical: z.string().optional(),
  dxNursing: z.string().optional(),
  evolution: z.string().optional(),

  // Multimedia
  audioUri: z.string().url().optional()
});

export type HandoverValues = z.infer<typeof zHandover>;
