// @ts-nocheck
// ===============================
// FILE: src/validation/schemas.ts
// ===============================
import { z } from 'zod';

/**
 * 🔐 Tip: usamos z.coerce.number() para tolerar entradas de formulario (strings).
 * ✔️ Aceptamos formas "legacy" y nuevas para no romper (ej. checklist objeto vs array).
 */

/* ----------------------------------
 * Enums y tipos base
 * ---------------------------------*/
export const zShift = z.enum(['morning', 'evening', 'night']);

export const zACVPU = z.enum(["A", "C", "V", "P", "U"]);

/** Helper opcional: tolera minúsculas/espacios y normaliza a ACVPU estricto */
export const zACVPU_coerce = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(zACVPU);

export type ACVPU = z.infer<typeof zACVPU>;

// URI de audio: http(s) o esquemas móviles comunes (file://, content://)
export const zAudioUri = z
  .string()
  .trim()
  .refine(
    (v) => /^https?:\/\//.test(v) || /^file:\/\//.test(v) || /^content:\/\//.test(v),
    'URI de audio inválido (http(s)://, file:// o content://)'
  );

/* ----------------------------------
 * Vitals (NEWS2 ranges) — coerce numbers
 * ---------------------------------*/
export const zVitals = z.object({
  rr: z.coerce.number().min(3, 'RR fuera de rango (>=3)').max(60, 'RR fuera de rango (<=60)'),
  spo2: z.coerce.number().min(50, 'SpO2 fuera de rango (>=50)').max(100, 'SpO2 <=100'),
  temp: z.coerce.number().min(30, 'Temp fuera de rango (>=30°C)').max(43, 'Temp fuera de rango (<=43°C)'),
  sbp: z.coerce.number().min(50, 'PAS fuera de rango (>=50)').max(250, 'PAS fuera de rango (<=250)'),
  hr: z.coerce.number().min(30, 'FC fuera de rango (>=30)').max(220, 'FC fuera de rango (<=220)'),
  o2: z.coerce.boolean().optional(),
});

/* ----------------------------------
 * Incidencias (objeto) — conservador y extensible
 * ---------------------------------*/
export const HandoverIncidentSchema = z.object({
  title: z.string().min(3, 'Describe la incidencia (≥3 car.)'),
  severity: z.enum(['low', 'moderate', 'high']).default('low'),
  notes: z.string().max(1000).optional(),
}).passthrough();
export type HandoverIncident = z.infer<typeof HandoverIncidentSchema>;

/* ----------------------------------
 * Checklist — permitimos dos formas: objeto PRO o array de strings (legacy)
 * ---------------------------------*/
export const HandoverChecklistSchema = z.object({
  fallsRisk: z.boolean().default(false),
  isolation: z.boolean().default(false),
  pressureInjuryRisk: z.boolean().default(false),
  venousAccessOk: z.boolean().default(false),
  painUncontrolled: z.boolean().default(false),
}).passthrough();
export type HandoverChecklist = z.infer<typeof HandoverChecklistSchema>;

export const zChecklist = z.union([
  z.array(z.string()),
  HandoverChecklistSchema
]);

/* ----------------------------------
 * Staff / Firmas (opcionales, sin romper)
 * ---------------------------------*/
export const HandoverStaffSchema = z.object({
  authorId: z.string().optional().default(''),
  role: z.string().optional().default('nurse'),
  team: z.array(z.any()).default([]),
}).passthrough();

export const HandoverSignaturesSchema = z.object({
  signed: z.boolean().default(false),
}).passthrough();

/* ----------------------------------
 * Esquema principal — tolerante a claves legacy y extenso
 * - Acepta `incidents` (nuevo) y `incidences` (legacy)
 * - Acepta `checklist` como array o como objeto PRO
 * - Passthrough para permitir evolución sin romper
 * ---------------------------------*/
export const HandoverFormSchema = z.object({
  patientId: z.string().trim().min(1, 'Paciente obligatorio'),
  unitId: z.string().trim().min(1, 'Unidad/Servicio obligatoria'),
  shift: zShift.default('morning'),
  acvpu: zACVPU,
  vitals: zVitals,
  // Nueva clave canónica
  incidents: z.array(HandoverIncidentSchema).default([]).optional(),
  // Clave legacy admitida
  incidences: z.array(HandoverIncidentSchema).default([]).optional(),
  // Aceptar ambas formas
  checklist: zChecklist.default([] as any).optional(),
  notes: z.string().max(2000).optional(),
  audioUri: zAudioUri.optional(),
  authorId: z.string().optional(),
  // Extras opcionales (no rompen)
  staff: HandoverStaffSchema.optional(),
  signatures: HandoverSignaturesSchema.optional(),
}).passthrough();

export type HandoverForm = z.infer<typeof HandoverFormSchema>;

/* ----------------------------------
 * Helpers de defaults (útiles para inicializar formularios)
 * ---------------------------------*/
export const makeHandoverDefaults = (overrides: Partial<HandoverForm> = {}): HandoverForm => ({
  patientId: '',
  unitId: '',
  shift: 'morning',
  acvpu: 'A',
  vitals: { rr: 16, spo2: 98, temp: 36.8, sbp: 120, hr: 80 },
  incidents: [],
  checklist: { fallsRisk: false, isolation: false, pressureInjuryRisk: false, venousAccessOk: false, painUncontrolled: false },
  notes: '',
  audioUri: undefined,
  authorId: '',
  staff: { authorId: '', role: 'nurse', team: [] },
  signatures: { signed: false },
  ...(overrides as any),
});
