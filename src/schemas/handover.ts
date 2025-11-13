import { z } from 'zod';

export const vitalsSchema = z.object({
  hr: z.number().min(20).max(220).optional(),
  sbp: z.number().min(50).max(260).optional(),
  rr: z.number().min(5).max(60).optional(),
  temp: z.number().min(30).max(43).optional(),
  spo2: z.number().min(50).max(100).optional(),
});

export const adminSchema = z.object({
  unit: z.string().min(1),
  staffOut: z.string().min(1),
  staffIn: z.string().min(1),
  census: z.number().min(0).max(200),
});

export const handoverSchema = z.object({
  patientId: z.string().min(1),
  admin: adminSchema,
  dxList: z.array(z.string()).default([]),
  evolution: z.string().max(2000).optional(),
  vitals: vitalsSchema,
  risks: z.record(z.boolean()).default({}),
  meds: z
    .array(
      z.object({
        name: z.string().min(1),
        dose: z.string().optional(),
        route: z.string().optional(),
        time: z.string().optional(),
      })
    )
    .default([]),
});

export type HandoverData = z.infer<typeof handoverSchema>;
