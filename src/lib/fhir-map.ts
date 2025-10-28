// @ts-nocheck
import { z } from 'zod';

import { createHash } from './node-crypto-shim';

/* [NURSEOS PRO PATCH 2025-10-22] fhir-map.ts
   - Tipos y exports alineados con tests (HandoverValues, AttachmentInput, HandoverInput)
   - Alias de unidades (__test__.UNITS) y helpers
   - Vitals → Observation (incluye SBP/DBP, HR, RR, Temp, SpO2, Glucosa mg/dL y mmol/L, AVPU/ACVPU)
   - Oxigenoterapia: Observation (FiO2, Flow), Procedure (administración O2)
   - buildHandoverBundle: admite HandoverInput | HandoverValues, agrega DocumentReference (attachments) y MedicationStatement (meds)
   - Sin dependencias externas, compatible con TS estricto
*/

const LOINC_SYSTEM = "http://loinc.org";
const SNOMED_SYSTEM = "http://snomed.info/sct";
const UCUM_SYSTEM = "http://unitsofmeasure.org";
const OBS_CAT_SYSTEM = "http://terminology.hl7.org/CodeSystem/observation-category";
const OBS_CAT_VITALS = "vital-signs";
const OBS_CAT_LAB = "laboratory";
const GLUCOSE_CONVERSION_FACTOR = 18.0182;

const hashString = (value: string) =>
  createHash('sha256')
    .update(value)
    .digest('hex');

const PROFILE_VITAL_SIGNS = "http://hl7.org/fhir/StructureDefinition/vitalsigns";
const PROFILE_BP = "http://hl7.org/fhir/StructureDefinition/bp";
const PROFILE_LAB = "http://hl7.org/fhir/StructureDefinition/observation-lab";

const ACVPU_TEXT = {
  A: "Alert",
  C: "New confusion",
  V: "Responds to voice",
  P: "Responds to pain",
  U: "Unresponsive"
} as const;

export const ACVPU_LOINC = {
  A: { system: LOINC_SYSTEM, code: "LA9340-6", display: ACVPU_TEXT.A },
  C: { system: LOINC_SYSTEM, code: "LA6560-2", display: ACVPU_TEXT.C },
  V: { system: LOINC_SYSTEM, code: "LA17108-4", display: ACVPU_TEXT.V },
  P: { system: LOINC_SYSTEM, code: "LA17107-6", display: ACVPU_TEXT.P },
  U: { system: LOINC_SYSTEM, code: "LA9343-0", display: ACVPU_TEXT.U }
} as const;

export const ACVPU_SNOMED = {
  A: { system: SNOMED_SYSTEM, code: "248234008", display: "Alert (finding)" },
  C: { system: SNOMED_SYSTEM, code: "1104441000000107", display: "New confusion (finding)" },
  V: { system: SNOMED_SYSTEM, code: "450847001", display: "Voice responsive (finding)" },
  P: { system: SNOMED_SYSTEM, code: "450848006", display: "Pain responsive (finding)" },
  U: { system: SNOMED_SYSTEM, code: "450849003", display: "Unresponsive (finding)" }
} as const;

const CODES = {
  PANEL_VS: { system: LOINC_SYSTEM, code: "85353-1", display: "Vital signs, weight, height, head circumference and oxygen saturation panel" },
  PANEL_BP: { system: LOINC_SYSTEM, code: "85354-9", display: "Blood pressure panel with all children optional" },
  HR: { system: LOINC_SYSTEM, code: "8867-4", display: "Heart rate" },
  RR: { system: LOINC_SYSTEM, code: "9279-1", display: "Respiratory rate" },
  TEMP: { system: LOINC_SYSTEM, code: "8310-5", display: "Body temperature" },
  SPO2: { system: LOINC_SYSTEM, code: "59408-5", display: "Oxygen saturation in Arterial blood by Pulse oximetry" },
  SBP: { system: LOINC_SYSTEM, code: "8480-6", display: "Systolic blood pressure" },
  DBP: { system: LOINC_SYSTEM, code: "8462-4", display: "Diastolic blood pressure" },
  GLU_MASS_BLD: { system: LOINC_SYSTEM, code: "2339-0", display: "Glucose [Mass/volume] in Blood" },
  GLU_MOLES_BLDC_GLUCOMETER: { system: LOINC_SYSTEM, code: "14743-9", display: "Glucose [Moles/volume] in Capillary blood by Glucometer" },
  ACVPU: { system: LOINC_SYSTEM, code: "67775-7", display: "ACVPU scale" }
} as const;

///////////////////////////
// Tipos expuestos (tests)
///////////////////////////

export type HandoverValues = {
  patientId: string;
  encounterId?: string;
  notes?: string;
  recordedAt?: string;
  close?: {
    audioUri?: string;
    audioTitle?: string;
    // otros campos de cierre si existen
  };
  vitals?: {
    hr?: number;                // /min
    rr?: number;                // /min
    temp?: number;              // °C
    spo2?: number;              // %
    sbp?: number;               // mmHg
    dbp?: number;               // mmHg
    bgMgDl?: number;            // mg/dL
    bgMmolL?: number;           // mmol/L
    avpu?: "A" | "V" | "P" | "U";
    acvpu?: "A" | "C" | "V" | "P" | "U";
    // Oxigenoterapia
    o2?: boolean;
    o2Device?: string;          // p.ej. "Nasal cannula", "Non-rebreather mask"
    o2FlowLpm?: number;         // L/min
    fio2?: number;              // 0..1 o 21..100 (se normaliza a %)
    o2Start?: string;
    o2StartedAt?: string;
    o2Since?: string;
    insertedAt?: string;
    recordedAt?: string;
  };
  // Opcional: medicaciones administradas durante el turno
  meds?: MedicationInput[];
  devices?: DeviceInput[];
  attachments?: AttachmentInput[];
  audioUri?: string;
};

// attachments: description opcional (lo piden los tests)
export type AttachmentInput = {
  url: string;
  contentType?: string;
  description?: string;
};

// Entrada flexible para buildHandoverBundle
export type HandoverInput = {
  values: HandoverValues;
  attachments?: AttachmentInput[];
  meds?: MedicationInput[]; // permite pasar meds aquí o dentro de values.meds
};

export type ProfileUrlMap = Record<string, string[] | undefined>;

export type BuildOptions = {
  emitVitalsPanel?: boolean;
  emitBpPanel?: boolean;
  emitHasMember?: boolean;
  now?: string | Date | (() => string | Date);
  authorId?: string;
  attachments?: AttachmentInput[];
  emitPanel?: boolean;
  emitIndividuals?: boolean;
  normalizeGlucoseToMgDl?: boolean;
  normalizeGlucoseToMgdl?: boolean;
  glucoseDecimals?: number;
  profileUrls?: string[] | ProfileUrlMap;
};

type BuilderOptions = BuildOptions;

const DEFAULT_OPTS: Required<
  Pick<BuilderOptions, 'emitVitalsPanel' | 'emitBpPanel' | 'emitHasMember'>
> & { now: () => Date } = {
  emitVitalsPanel: false,
  emitBpPanel: false,
  emitHasMember: false,
  now: () => new Date(),
};

export type MedicationCodeInput = { system?: string; code?: string; display?: string } | string;

export type MedicationInput = {
  code?: MedicationCodeInput;
  display?: string;
  text?: string;
  name?: string;                // si no hay code/text, se usa como texto
  dose?: string | number;
  unit?: string;                // "mg", "mL", etc.
  route?: string;               // "PO", "IV", etc.
  when?: string;                // ISO timestamp; si falta, se usa now
  note?: string;
};

export type DeviceCodeInput = { system?: string; code?: string; display?: string } | string;

export type DeviceInput = {
  id?: string;
  code?: DeviceCodeInput;
  type?: DeviceCodeInput;
  name?: string;
  text?: string;
  status?: string;
  insertedAt?: string;
  startedAt?: string;
  whenUsedStart?: string;
  bodySite?: string;
  note?: string;
};

/////////////////////////////////////
// Adjuntos (validación y helpers)
/////////////////////////////////////

const HTTP_URL_RE = /^https?:\/\//i;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const ATTACHMENT_MIME_ALLOWLIST = new Set<string>([
  'audio/mpeg',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'audio/wav',
  'audio/ogg',
  'audio/opus',
  'audio/flac',
  'audio/amr',
  'audio/3gpp',
  'audio/3gpp2',
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/octet-stream',
]);

const ATTACHMENT_EXTENSION_MIME = new Map<string, string>([
  ['mp3', 'audio/mpeg'],
  ['m4a', 'audio/mp4'],
  ['mp4', 'audio/mp4'],
  ['aac', 'audio/aac'],
  ['wav', 'audio/wav'],
  ['ogg', 'audio/ogg'],
  ['oga', 'audio/ogg'],
  ['opus', 'audio/opus'],
  ['flac', 'audio/flac'],
  ['amr', 'audio/amr'],
  ['3gp', 'audio/3gpp'],
  ['3gpp', 'audio/3gpp'],
  ['3gpp2', 'audio/3gpp2'],
  ['pdf', 'application/pdf'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
  ['heic', 'image/heic'],
]);

const ATTACHMENT_DEFAULT_MIME = 'application/octet-stream';

export const AttachmentSchema: z.ZodType<AttachmentInput> = z.object({
  url: z
    .string()
    .url()
    .refine((value) => HTTP_URL_RE.test(value), {
      message: 'Attachment URL must use http/https',
    }),
  contentType: z
    .string()
    .optional()
    .transform((value) => {
      if (typeof value !== 'string') return undefined;
      const normalized = value.trim().toLowerCase();
      return normalized.length ? normalized : undefined;
    })
    .refine((mime) => mime === undefined || ATTACHMENT_MIME_ALLOWLIST.has(mime), {
      message: 'Unsupported attachment MIME type',
    }),
  description: z
    .string()
    .optional()
    .transform((value) => {
      if (typeof value !== 'string') return undefined;
      const trimmed = value.trim();
      return trimmed.length ? trimmed : undefined;
    }),
});

const AttachmentArraySchema = AttachmentSchema.array();

function inferAttachmentMime(url: string): string | undefined {
  const clean = url.split('#')[0]?.split('?')[0] ?? '';
  const ext = clean.includes('.') ? clean.substring(clean.lastIndexOf('.') + 1).toLowerCase() : '';
  if (!ext) return undefined;
  const mime = ATTACHMENT_EXTENSION_MIME.get(ext);
  return mime && ATTACHMENT_MIME_ALLOWLIST.has(mime) ? mime : undefined;
}

function resolveAttachmentContentType(att: AttachmentInput): string {
  if (att.contentType && ATTACHMENT_MIME_ALLOWLIST.has(att.contentType)) {
    return att.contentType;
  }
  const inferred = inferAttachmentMime(att.url);
  if (inferred) return inferred;
  return ATTACHMENT_DEFAULT_MIME;
}

///////////////////////////////////////
// Normalización de Vitals/Input
///////////////////////////////////////

const ACVPU_ALLOWED = ["A", "C", "V", "P", "U"] as const;
const AVPU_ALLOWED = ["A", "V", "P", "U", "C"] as const;

const normalizeNumeric = (min: number, max: number) =>
  z.any().transform((value, ctx) => {
    if (value === undefined || value === null) return undefined;

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      const num = Number(trimmed);
      if (!Number.isFinite(num)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Expected a numeric value" });
        return undefined;
      }
      if (num < min || num > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Value must be between ${min} and ${max}`,
        });
        return undefined;
      }
      return num;
    }

    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        return undefined;
      }
      if (value < min || value > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Value must be between ${min} and ${max}`,
        });
        return undefined;
      }
      return value;
    }

    if (value === "") return undefined;

    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Expected a numeric value" });
    return undefined;
  });

const normalizeString = () =>
  z
    .preprocess((value) => {
      if (typeof value !== "string") return undefined;
      const trimmed = value.trim();
      return trimmed.length ? trimmed : undefined;
    }, z.string())
    .optional();

const normalizeBoolean = () =>
  z.any().transform((value, ctx) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const trimmed = value.trim().toLowerCase();
      if (!trimmed) return undefined;
      if (["true", "1", "yes", "y"].includes(trimmed)) return true;
      if (["false", "0", "no", "n"].includes(trimmed)) return false;
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid boolean value" });
      return undefined;
    }
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid boolean value" });
    return undefined;
  });

const normalizeScale = (allowed: readonly string[]) =>
  z.any().transform((value, ctx) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      const upper = trimmed.toUpperCase();
      if (allowed.includes(upper)) {
        return upper as (typeof allowed)[number];
      }
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Value must be one of: ${allowed.join(", ")}`,
      });
      return undefined;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Value must be one of: ${allowed.join(", ")}`,
    });
    return undefined;
  });

const VitalsSchema = z
  .object({
    hr: normalizeNumeric(30, 220),
    rr: normalizeNumeric(5, 60),
    temp: normalizeNumeric(30, 45),
    spo2: normalizeNumeric(50, 100),
    sbp: normalizeNumeric(50, 260),
    dbp: normalizeNumeric(30, 160),
    bgMgDl: normalizeNumeric(20, 600),
    bgMmolL: normalizeNumeric(0, 100),
    o2: normalizeBoolean(),
    o2Device: normalizeString(),
    o2FlowLpm: normalizeNumeric(0, 100),
    fio2: normalizeNumeric(0, 100),
    acvpu: normalizeScale(ACVPU_ALLOWED),
    avpu: normalizeScale(AVPU_ALLOWED),
  })
  .passthrough();

type NormalizedVitals = z.infer<typeof VitalsSchema>;

type NormalizeMode = 'strict' | 'lenient';

function normalizeVitalsInput(
  vitals: HandoverValues["vitals"] | undefined,
  opts: { mode?: NormalizeMode } = {},
): NormalizedVitals {
  const input = vitals ?? {};
  const result = VitalsSchema.safeParse(input);
  if (result.success) {
    return result.data;
  }

  if (opts.mode === 'lenient') {
    const clone: Record<string, unknown> = { ...input };
    for (const issue of result.error.issues) {
      if (issue.path.length === 1) {
        const key = issue.path[0];
        if (typeof key === 'string') {
          delete clone[key];
        }
      }
    }
    const retry = VitalsSchema.safeParse(clone);
    if (retry.success) {
      return retry.data;
    }
    throw retry.error;
  }

  throw result.error;
}

////////////////////////////////////////////////////
// Alias de unidades y CODES mínimos para los tests
////////////////////////////////////////////////////

export const __test__ = {
  UNITS: {
    PER_MIN: "/min",
    MMHG: "mm[Hg]",
    MM_HG: "mm[Hg]",          // alias
    PERCENT: "%",
    PCT: "%",
    CEL: "Cel",
    "°C": "°C",
    MGDL: "mg/dL",
    MG_DL: "mg/dL",           // alias
    MMOLL: "mmol/L",
    MMOL_L: "mmol/L"          // alias
  } as const,
  UCUM_SYSTEM,
  LOINC_SYSTEM,
  SNOMED_SYSTEM,
  OBS_CAT_SYSTEM,
  OBS_CAT_VITALS,
  OBS_CAT_LAB,
  LOINC: {
    PANEL_VS: "85353-1",
    BP_PANEL: "85354-9",
    SBP: "8480-6",
    DBP: "8462-4",
    HR: "8867-4",
    RR: "9279-1",
    TEMP: "8310-5",
    SPO2: "59408-5",
    GLUCOSE_MASS: "2339-0",
    GLUCOSE_MOLE: "14743-9",
    FIO2: "3150-0",
    O2_FLOW: "19849-6",
    ACVPU: "67775-7"
  } as const,
  CODES,
  ACVPU_LOINC,
  ACVPU_SNOMED,
  SNOMED: {
    O2_ADMINISTRATION: "243120004", // Administration of oxygen (procedure)
    OXYGEN_THERAPY: "371906007"
  } as const
} as const;

/////////////////////////////////////
// Mínimos tipos FHIR usados aquí
/////////////////////////////////////

type FhirRef = { reference: string; display?: string };
type FhirCoding = { system?: string; code?: string; display?: string };
type FhirCodeableConcept = { coding?: FhirCoding[]; text?: string };

type Observation = {
  resourceType: "Observation";
  id?: string;
  status: "final" | "amended" | "registered" | "preliminary";
  category?: { coding: FhirCoding[] }[];
  code: FhirCodeableConcept;
  subject: FhirRef;
  encounter?: FhirRef;
  effectiveDateTime?: string;
  valueQuantity?: {
    value: number;
    unit?: string;
    system?: string;
    code?: string;
  };
  valueCodeableConcept?: FhirCodeableConcept;
  note?: Array<{ text: string }>;
  component?: Array<{
    code: FhirCodeableConcept;
    valueQuantity?: { value: number; unit?: string; system?: string; code?: string };
  }>;
};

type ObsEx = Observation & {
  meta?: { profile?: string[] };
  hasMember?: Array<{ reference: string }>;
};

type Device = {
  resourceType: "Device";
  id?: string;
  status?: "active" | "inactive" | "entered-in-error" | "unknown";
  type?: FhirCodeableConcept;
  identifier?: Array<{ system?: string; value?: string }>;
  deviceName?: Array<{ name: string; type: string }>;
};

type MedicationStatement = {
  resourceType: "MedicationStatement";
  id?: string;
  status: "completed" | "active" | "entered-in-error" | "intended" | "stopped" | "on-hold" | "unknown" | "not-taken";
  subject: FhirRef;
  encounter?: FhirRef;
  effectiveDateTime?: string;
  medicationCodeableConcept: FhirCodeableConcept;
  dosage?: Array<{
    text?: string;
    route?: FhirCodeableConcept;
    doseAndRate?: Array<{ doseQuantity?: { value?: number; unit?: string; system?: string; code?: string } }>;
  }>;
  note?: Array<{ text: string }>;
};

type DocumentReference = {
  resourceType: "DocumentReference";
  id?: string;
  status: "current" | "superseded" | "entered-in-error";
  type?: FhirCodeableConcept;
  subject?: FhirRef;
  date?: string;
  content: Array<{ attachment: { url: string; contentType?: string; title?: string } }>;
  description?: string;
  context?: { encounter?: FhirRef[] };
};

type Procedure = {
  resourceType: "Procedure";
  id?: string;
  status: "completed" | "in-progress" | "not-done" | "stopped" | "on-hold" | "unknown";
  code: FhirCodeableConcept;
  subject: FhirRef;
  encounter?: FhirRef;
  performedDateTime?: string;
  usedCode?: FhirCodeableConcept[]; // para anotar dispositivo (p.ej. "Nasal cannula")
  note?: Array<{ text: string }>;
};

type DeviceUseStatement = {
  resourceType: "DeviceUseStatement";
  id?: string;
  status: "active" | "completed" | "entered-in-error" | "intended" | "stopped" | "on-hold" | "unknown";
  subject: FhirRef;
  encounter?: FhirRef;
  device?: FhirRef;
  whenUsed?: { start?: string; end?: string };
  recordedOn?: string;
  timingDateTime?: string;
  reasonCode?: FhirCodeableConcept[];
  bodySiteCodeableConcept?: FhirCodeableConcept;
  note?: Array<{ text: string }>;
};

type Composition = {
  resourceType: "Composition";
  id?: string;
  status: "preliminary" | "final" | "amended" | "entered-in-error";
  type: FhirCodeableConcept;
  subject: FhirRef;
  encounter?: FhirRef;
  date: string;
  title?: string;
  identifier?: { system?: string; value?: string };
  section?: Array<{ title?: string; entry?: Array<{ reference: string }> }>;
};

type Bundle = {
  resourceType: "Bundle";
  id?: string;
  type: "collection" | "transaction" | "batch";
  entry: Array<{
    fullUrl?: string;
    resource: any;
    request?: { method: string; url: string; ifNoneExist?: string };
  }>;
};

/////////////////////////////////////
// Helpers puros (sin dependencias)
/////////////////////////////////////

const uom = UCUM_SYSTEM;
const nowISO = () => new Date().toISOString();
const resolveNow = (value?: string | Date | (() => string | Date)) => {
  if (typeof value === 'function') {
    const result = value();
    return result instanceof Date ? result.toISOString() : result;
  }
  return value instanceof Date ? value.toISOString() : value;
};
const refPatient = (patientId: string): FhirRef => ({ reference: `Patient/${patientId}` });
const refEncounter = (encounterId?: string): FhirRef | undefined =>
  encounterId ? { reference: `Encounter/${encounterId}` } : undefined;

const categoryVital: Observation["category"] = [
  { coding: [{ system: OBS_CAT_SYSTEM, code: OBS_CAT_VITALS, display: "Vital Signs" }] }
];

const categoryLab: Observation["category"] = [
  { coding: [{ system: OBS_CAT_SYSTEM, code: OBS_CAT_LAB, display: "Laboratory" }] }
];

const codeCC = (system: string, code: string, display?: string, text?: string): FhirCodeableConcept => ({
  coding: [{ system, code, display }],
  ...(text ? { text } : {})
});

const qty = (value: number, unit: string, code = unit, system = uom) => ({ value, unit, system, code });

const pushIf = <T>(arr: T[], v: T | undefined | null) => {
  if (v !== undefined && v !== null) arr.push(v);
};

/////////////////////////////////////
// Vitals → Observation (núcleo)
/////////////////////////////////////

export function mapObservationVitals(
  values: HandoverValues,
  opts: BuildOptions = {},
): Observation[] {
  // optsMerged: única fusión por función; no duplicar (previene bundling error)
  const optsMerged = { ...DEFAULT_OPTS, ...(opts ?? {}) };
  if (!values?.patientId) return [];

  const vitals = normalizeVitalsInput(values.vitals, { mode: 'lenient' });
  const observations: Observation[] = [];

  const subj = refPatient(values.patientId);
  const enc = refEncounter(values.encounterId);
  const effective = resolveNow(optsMerged.now) ?? nowISO();

  const emitIndividuals = optsMerged.emitIndividuals ?? true;

  const normalizeGlucoseOption = optsMerged.normalizeGlucoseToMgDl ?? optsMerged.normalizeGlucoseToMgdl;
  const normalizeGlucose =
    typeof normalizeGlucoseOption === "boolean" ? normalizeGlucoseOption : true;
  const glucoseDecimals = optsMerged.glucoseDecimals ?? 0;

  const buildObservation = (params: {
    code: FhirCodeableConcept;
    category?: Observation["category"];
    valueQuantity?: Observation["valueQuantity"];
    valueCodeableConcept?: FhirCodeableConcept;
    component?: Observation["component"];
    note?: Observation["note"];
    profile?: string[];
  }): Observation => {
    const profiles = params.profile?.filter(Boolean) ?? [];
    return {
      resourceType: "Observation",
      status: "final",
      subject: subj,
      encounter: enc,
      effectiveDateTime: effective,
      category: params.category ?? categoryVital,
      code: params.code,
      ...(profiles.length ? { meta: { profile: Array.from(new Set(profiles)) } } : {}),
      ...(params.valueQuantity ? { valueQuantity: params.valueQuantity } : {}),
      ...(params.valueCodeableConcept ? { valueCodeableConcept: params.valueCodeableConcept } : {}),
      ...(params.component ? { component: params.component } : {}),
      ...(params.note ? { note: params.note } : {})
    };
  };

  if (emitIndividuals && typeof vitals.hr === "number") {
    observations.push(
      buildObservation({
        code: codeCC(LOINC_SYSTEM, __test__.LOINC.HR, "Heart rate", "Heart rate"),
        valueQuantity: qty(vitals.hr, __test__.UNITS.PER_MIN),
        profile: [PROFILE_VITAL_SIGNS],
      })
    );
  }

  if (emitIndividuals && typeof vitals.rr === "number") {
    observations.push(
      buildObservation({
        code: codeCC(LOINC_SYSTEM, __test__.LOINC.RR, "Respiratory rate", "Respiratory rate"),
        valueQuantity: qty(vitals.rr, __test__.UNITS.PER_MIN),
        profile: [PROFILE_VITAL_SIGNS],
      })
    );
  }

  if (emitIndividuals && typeof vitals.temp === "number") {
    observations.push(
      buildObservation({
        code: codeCC(
          LOINC_SYSTEM,
          __test__.LOINC.TEMP,
          "Body temperature",
          "Body temperature"
        ),
        valueQuantity: qty(vitals.temp, __test__.UNITS.CEL, "Cel"),
        profile: [PROFILE_VITAL_SIGNS],
      })
    );
  }

  if (emitIndividuals && typeof vitals.spo2 === "number") {
    observations.push(
      buildObservation({
        code: codeCC(
          LOINC_SYSTEM,
          __test__.LOINC.SPO2,
          "Oxygen saturation in Arterial blood by Pulse oximetry",
          "SpO2"
        ),
        valueQuantity: qty(vitals.spo2, __test__.UNITS.PERCENT, "%"),
        profile: [PROFILE_VITAL_SIGNS],
      })
    );
  }

  if (emitIndividuals && typeof vitals.sbp === "number") {
    observations.push(
      buildObservation({
        code: codeCC(
          LOINC_SYSTEM,
          __test__.LOINC.SBP,
          "Systolic blood pressure",
          "Systolic blood pressure"
        ),
        valueQuantity: qty(vitals.sbp, __test__.UNITS.MMHG),
        profile: [PROFILE_VITAL_SIGNS],
      })
    );
  }

  if (emitIndividuals && typeof vitals.dbp === "number") {
    observations.push(
      buildObservation({
        code: codeCC(
          LOINC_SYSTEM,
          __test__.LOINC.DBP,
          "Diastolic blood pressure",
          "Diastolic blood pressure"
        ),
        valueQuantity: qty(vitals.dbp, __test__.UNITS.MMHG),
        profile: [PROFILE_VITAL_SIGNS],
      })
    );
  }

  const hasBgMgDl = typeof vitals.bgMgDl === "number";
  const hasBgMmolL = typeof vitals.bgMmolL === "number";

  if (hasBgMgDl) {
    observations.push(
      buildObservation({
        category: categoryLab,
        code: codeCC(
          LOINC_SYSTEM,
          __test__.LOINC.GLUCOSE_MASS,
          "Glucose [Mass/volume] in Blood",
          "Blood glucose"
        ),
        valueQuantity: qty(vitals.bgMgDl!, __test__.UNITS.MGDL),
        profile: [PROFILE_LAB],
      })
    );
  } else if (hasBgMmolL) {
    if (normalizeGlucose) {
      const converted = roundTo(vitals.bgMmolL! * GLUCOSE_CONVERSION_FACTOR, glucoseDecimals);
      const factor = GLUCOSE_CONVERSION_FACTOR.toFixed(4);
      observations.push(
        buildObservation({
          category: categoryLab,
          code: codeCC(
            LOINC_SYSTEM,
            __test__.LOINC.GLUCOSE_MASS,
            "Glucose [Mass/volume] in Blood",
            "Blood glucose"
          ),
          valueQuantity: qty(converted, __test__.UNITS.MGDL),
          note: [
            {
              text: `Convertido desde ${vitals.bgMmolL} mmol/L (factor ${factor})`,
            }
          ],
          profile: [PROFILE_LAB],
        })
      );
    } else {
      observations.push(
        buildObservation({
          category: categoryLab,
          code: codeCC(
            LOINC_SYSTEM,
            __test__.LOINC.GLUCOSE_MOLE,
            "Glucose [Moles/volume] in Blood",
            "Blood glucose"
          ),
          valueQuantity: qty(vitals.bgMmolL!, __test__.UNITS.MMOLL, "mmol/L"),
          profile: [PROFILE_LAB],
        })
      );
    }
  }

  const rawAcvpu = (vitals.acvpu ?? vitals.avpu) as NormalizedVitals["acvpu"];

  if (rawAcvpu && (ACVPU_ALLOWED as readonly string[]).includes(rawAcvpu)) {
    const answerLoinc = __test__.ACVPU_LOINC[rawAcvpu as keyof typeof __test__.ACVPU_LOINC];
    const answerSnomed = __test__.ACVPU_SNOMED[rawAcvpu as keyof typeof __test__.ACVPU_SNOMED];
    const coding: FhirCoding[] = [];
    if (answerSnomed) {
      coding.push({
        system: SNOMED_SYSTEM,
        code: answerSnomed.code,
        display: answerSnomed.display
      });
    }
    if (answerLoinc) {
      coding.push({
        system: LOINC_SYSTEM,
        code: answerLoinc.code,
        display: answerLoinc.display
      });
    }

    observations.push(
      buildObservation({
        code: codeCC(
          LOINC_SYSTEM,
          __test__.LOINC.ACVPU,
          __test__.CODES.ACVPU.display,
          __test__.CODES.ACVPU.display
        ),
        valueCodeableConcept: {
          ...(coding.length ? { coding } : {}),
          text: answerSnomed?.display ?? answerLoinc?.display ?? rawAcvpu
        },
        profile: [PROFILE_VITAL_SIGNS],
      })
    );
  }

  const hasO2 = Boolean(vitals.o2) || isNum(vitals.fio2) || isNum(vitals.o2FlowLpm) || !!vitals.o2Device;
  if (hasO2) {
    const oxygenComponents: Observation['component'] = [];
    if (isNum(vitals.fio2)) {
      const fi = normalizeFiO2ToPct(vitals.fio2);
      observations.push(
        buildObservation({
          code: codeCC(
            LOINC_SYSTEM,
            __test__.LOINC.FIO2,
            "Inhaled oxygen concentration",
            "FiO2"
          ),
          valueQuantity: qty(fi, __test__.UNITS.PERCENT, "%"),
          profile: [PROFILE_VITAL_SIGNS],
        })
      );
      oxygenComponents.push({
        code: codeCC(
          LOINC_SYSTEM,
          __test__.LOINC.FIO2,
          "Inhaled oxygen concentration",
          "FiO2",
        ),
        valueQuantity: qty(fi, __test__.UNITS.PERCENT, "%"),
      });
    }
    if (isNum(vitals.o2FlowLpm)) {
      observations.push(
        buildObservation({
          code: codeCC(
            LOINC_SYSTEM,
            __test__.LOINC.O2_FLOW,
            "Oxygen flow rate",
            "Oxygen flow rate"
          ),
          valueQuantity: qty(vitals.o2FlowLpm, "L/min"),
          profile: [PROFILE_VITAL_SIGNS],
        })
      );
      oxygenComponents.push({
        code: codeCC(
          LOINC_SYSTEM,
          __test__.LOINC.O2_FLOW,
          "Oxygen flow rate",
          "Oxygen flow rate",
        ),
        valueQuantity: qty(vitals.o2FlowLpm, "L/min"),
      });
    }

    observations.push(
      buildObservation({
        code: codeCC(
          SNOMED_SYSTEM,
          __test__.SNOMED.OXYGEN_THERAPY,
          "Oxygen therapy (procedure)",
          "Oxygen therapy",
        ),
        component: oxygenComponents.length ? oxygenComponents : undefined,
        profile: [PROFILE_VITAL_SIGNS],
      })
    );
  }

  return observations;
}

// Alias requerido por los tests
export function mapVitalsToObservations(
  values: HandoverValues,
  opts: BuildOptions = {},
) {
  // optsMerged: única fusión por función; no duplicar (previene bundling error)
  const optsMerged = { ...DEFAULT_OPTS, ...(opts ?? {}) };
  return mapObservationVitals(values, optsMerged);
}

/////////////////////////////////////////
// MedicationStatement desde meds[]
/////////////////////////////////////////

type NormalizedMedication = {
  concept: FhirCodeableConcept;
  dosageText?: string;
  route?: string;
  doseQuantity?: { value: number; unit?: string; system?: string; code?: string };
  when?: string;
  note?: string;
};

type NormalizedDevice = {
  concept: FhirCodeableConcept;
  status: DeviceUseStatement["status"];
  start?: string;
  bodySite?: string;
  note?: string;
  identifier?: string;
  name?: string;
};

function normalizeMedicationInputs(meds?: MedicationInput[]): NormalizedMedication[] {
  if (!Array.isArray(meds)) return [];

  const normalized: NormalizedMedication[] = [];

  for (const raw of meds) {
    if (!raw || typeof raw !== "object") continue;

    const text = trimToUndefined((raw as any).text ?? raw.name);
    const topDisplay = trimToUndefined(raw.display);

    let codeSystem: string | undefined;
    let codeValue: string | undefined;
    let codeDisplay: string | undefined;

    if (typeof raw.code === "string") {
      codeValue = trimToUndefined(raw.code);
    } else if (raw.code && typeof raw.code === "object") {
      codeSystem = trimToUndefined(raw.code.system);
      codeValue = trimToUndefined(raw.code.code);
      codeDisplay = trimToUndefined(raw.code.display);
    }

    const display = topDisplay ?? codeDisplay;
    const conceptText = text ?? display ?? codeValue;

    if (!conceptText && !codeValue && !display && !codeSystem) continue;

    const codingEntry = [
      {
        ...(codeSystem ? { system: codeSystem } : {}),
        ...(codeValue ? { code: codeValue } : {}),
        ...(display ? { display } : {}),
      },
    ].filter((c) => Object.keys(c).length > 0);

    const concept: FhirCodeableConcept = codingEntry.length
      ? { coding: codingEntry, text: conceptText ?? "Medication" }
      : { text: conceptText ?? "Medication" };

    const route = trimToUndefined(raw.route);
    const note = trimToUndefined(raw.note);
    const when = trimToUndefined(raw.when);
    const unit = trimToUndefined(raw.unit);

    const doseNumber = coerceNumber(raw.dose);
    const doseQuantity = doseNumber !== undefined
      ? { value: doseNumber, unit, system: uom, code: unit }
      : undefined;

    const doseText = raw.dose !== undefined
      ? [String(raw.dose).trim(), unit].filter(Boolean).join(" ")
      : undefined;
    const dosageText = [doseText, route].filter(Boolean).join(" • ") || undefined;

    normalized.push({
      concept,
      dosageText,
      route,
      doseQuantity,
      when,
      note,
    });
  }

  return normalized;
}

function normalizeDeviceInputs(devices?: DeviceInput[]): NormalizedDevice[] {
  if (!Array.isArray(devices)) return [];

  const normalized: NormalizedDevice[] = [];

  for (const raw of devices) {
    if (!raw || typeof raw !== "object") continue;

    const typeInput = (raw.type ?? raw.code) as DeviceCodeInput | undefined;
    let concept: FhirCodeableConcept | undefined;

    if (typeof typeInput === "string") {
      const text = trimToUndefined(typeInput);
      if (text) {
        concept = { text };
      }
    } else if (typeInput && typeof typeInput === "object") {
      const system = trimToUndefined(typeInput.system);
      const code = trimToUndefined(typeInput.code);
      const display = trimToUndefined(typeInput.display);
      const coding = [
        {
          ...(system ? { system } : {}),
          ...(code ? { code } : {}),
          ...(display ? { display } : {}),
        },
      ].filter((entry) => Object.keys(entry).length > 0);

      if (coding.length > 0) {
        concept = { coding, text: display ?? trimToUndefined(raw.text) ?? trimToUndefined(raw.name) };
      }
    }

    if (!concept) {
      const text = trimToUndefined(raw.text) ?? trimToUndefined(raw.name);
      if (text) {
        concept = { text };
      }
    }

    if (!concept) continue;

    const status = normalizeDeviceUseStatus(raw.status);
    const start = trimToUndefined(raw.whenUsedStart ?? raw.startedAt ?? raw.insertedAt);
    const bodySite = trimToUndefined(raw.bodySite);
    const note = trimToUndefined(raw.note);
    const identifier = trimToUndefined(raw.id);
    const name = trimToUndefined(raw.name) ?? concept.text;

    normalized.push({ concept, status, start, bodySite, note, identifier, name });
  }

  return normalized;
}

function mapMedicationStatements(values: HandoverValues, medsArg: MedicationInput[] | undefined, now: string): MedicationStatement[] {
  const meds = normalizeMedicationInputs(medsArg ?? values.meds);
  if (meds.length === 0) return [];

  const subj = refPatient(values.patientId);
  const enc = refEncounter(values.encounterId);
  const tFallback = now;

  return meds.map<MedicationStatement>((m, i) => {
    const ms: MedicationStatement = {
      resourceType: "MedicationStatement",
      status: "completed",
      subject: subj,
      encounter: enc,
      effectiveDateTime: m.when ?? tFallback,
      medicationCodeableConcept: m.concept,
      dosage: [
        {
          text: m.dosageText,
          route: m.route ? { text: m.route } : undefined,
          doseAndRate: m.doseQuantity ? [{ doseQuantity: m.doseQuantity }] : undefined
        }
      ],
      note: m.note ? [{ text: m.note }] : undefined
    };
    return ms;
  });
}

/////////////////////////////////////////
// Oxigenoterapia → DeviceUseStatement (opcional)
/////////////////////////////////////////

function mapOxygenDevice(values: HandoverValues): Device | undefined {
  const vitals = normalizeVitalsInput(values.vitals, { mode: 'lenient' });
  const hasO2 = Boolean(vitals.o2) || isNum(vitals.fio2) || isNum(vitals.o2FlowLpm) || !!vitals.o2Device;
  if (!hasO2) return undefined;

  const display = trimToUndefined(values.vitals?.o2Device) ?? "Oxygen delivery device";
  const status = vitals.o2 ? "active" : "inactive";

  const device: Device = {
    resourceType: "Device",
    status,
    type: { text: display },
    deviceName: display ? [{ name: display, type: "user-friendly-name" }] : undefined,
  };

  return device;
}

function resolveOxygenStart(values: HandoverValues, fallback: string): string | undefined {
  const vitalsRaw = values.vitals ?? {};
  return (
    trimToUndefined((vitalsRaw as any).o2Start) ??
    trimToUndefined((vitalsRaw as any).o2StartedAt) ??
    trimToUndefined((vitalsRaw as any).o2Since) ??
    trimToUndefined((vitalsRaw as any).insertedAt) ??
    trimToUndefined((vitalsRaw as any).recordedAt) ??
    trimToUndefined(values.recordedAt) ??
    fallback
  );
}

function mapOxygenProcedure(
  values: HandoverValues,
  opts: BuildOptions = {},
  deviceReference?: string,
): DeviceUseStatement[] {
  // optsMerged: única fusión por función; no duplicar (previene bundling error)
  const optsMerged = { ...DEFAULT_OPTS, ...(opts ?? {}) };
  const vitals = normalizeVitalsInput(values.vitals, { mode: 'lenient' });
  const hasO2 = Boolean(vitals.o2) || isNum(vitals.fio2) || isNum(vitals.o2FlowLpm) || !!vitals.o2Device;
  if (!hasO2) return [];

  const subj = refPatient(values.patientId);
  const enc = refEncounter(values.encounterId);
  const when = resolveNow(optsMerged.now) ?? nowISO();
  const start = resolveOxygenStart(values, when);

  const note = buildO2Note(vitals);

  const reason = codeCC(
    "http://snomed.info/sct",
    "46680005",
    "Need for supplemental oxygen",
    "Oxygen support"
  );

  const status = vitals.o2 ? "active" : "completed";

  return [
    {
      resourceType: "DeviceUseStatement",
      status,
      subject: subj,
      encounter: enc,
      device: deviceReference ? { reference: deviceReference } : undefined,
      whenUsed: start ? { start } : undefined,
      recordedOn: when,
      timingDateTime: when,
      reasonCode: [reason],
      note
    }
  ];
}

function buildO2Note(vitals: NormalizedVitals) {
  const parts: string[] = [];
  if (vitals.o2Device) parts.push(`Device: ${vitals.o2Device}`);
  if (isNum(vitals.o2FlowLpm)) parts.push(`Flow: ${vitals.o2FlowLpm} L/min`);
  if (isNum(vitals.fio2)) parts.push(`FiO2: ${normalizeFiO2ToPct(vitals.fio2)}%`);
  return parts.length ? [{ text: parts.join(" | ") }] : undefined;
}

/////////////////////////////////////////
// DocumentReference desde attachments[]
/////////////////////////////////////////

function mapDocumentReference(
  values: HandoverValues,
  attachments: AttachmentInput[] | undefined,
  now?: string
): DocumentReference[] {
  if (!attachments || attachments.length === 0) return [];
  const dr: DocumentReference = {
    resourceType: "DocumentReference",
    status: "current",
    type: { text: "Nursing handover attachments" },
    subject: refPatient(values.patientId),
    date: now ?? nowISO(),
    content: attachments.map(a => ({
      attachment: {
        url: a.url,
        contentType: resolveAttachmentContentType(a),
        title: a.description // opcional; si undefined, los visores usan filename del URL
      }
    })),
    context: values.encounterId ? { encounter: [refEncounter(values.encounterId)!] } : undefined
  };
  return [dr];
}

/////////////////////////////////////////
// buildHandoverBundle (núcleo de tests)
/////////////////////////////////////////

export function buildHandoverBundle(
  input: HandoverInput | HandoverValues,
  opts: BuildOptions = {},
): Bundle {
  const isWrapped = typeof input === 'object' && input !== null && 'values' in (input as HandoverInput);
  const values: HandoverValues = isWrapped
    ? (input as HandoverInput).values
    : (input as HandoverValues);

  // optsMerged: única fusión por función; no duplicar (previene bundling error)
  const optsMerged = { ...DEFAULT_OPTS, ...(opts ?? {}) };

  if (!values.patientId) {
    return {
      resourceType: 'Bundle',
      id: 'bundle-empty',
      type: 'transaction',
      entry: [],
    };
  }

  const patientId = values.patientId;
  const resolvedNow = resolveNow(optsMerged.now);
  const now =
    resolvedNow ??
    trimToUndefined(values.recordedAt) ??
    trimToUndefined(values.vitals?.recordedAt) ??
    '1970-01-01T00:00:00Z';

  const attachmentsFromValues = Array.isArray(values.attachments) ? values.attachments : [];
  const attachmentsFromInput = isWrapped && Array.isArray((input as HandoverInput).attachments)
    ? ((input as HandoverInput).attachments as AttachmentInput[])
    : [];
  const attachmentsFromOptions = Array.isArray(optsMerged.attachments) ? optsMerged.attachments : [];

  const mergedAttachments = [...attachmentsFromValues, ...attachmentsFromInput, ...attachmentsFromOptions].filter(
    (att): att is AttachmentInput => Boolean(att),
  );

  const audioUri = trimToUndefined(values.audioUri ?? values.close?.audioUri);
  const audioTitle = trimToUndefined(values.close?.audioTitle);
  if (audioUri) {
    mergedAttachments.unshift({
      url: audioUri,
      contentType: 'audio/m4a',
      description: audioTitle ?? 'Nursing handover audio note',
    });
  }
  const attachments = mergedAttachments.length > 0
    ? AttachmentArraySchema.parse(mergedAttachments)
    : undefined;

  const medsInput: MedicationInput[] | undefined = isWrapped
    ? (input as HandoverInput).meds ?? values.meds
    : values.meds;
  const normalizedMeds = normalizeMedicationInputs(medsInput);
  const normalizedVitals = normalizeVitalsInput(values.vitals);
  const normalizedDevices = normalizeDeviceInputs(values.devices);
  const profileExtras = normalizeProfileOptions(optsMerged.profileUrls);

  const observationOptions: BuildOptions = {
    now,
    emitIndividuals: optsMerged.emitIndividuals,
    normalizeGlucoseToMgDl: optsMerged.normalizeGlucoseToMgDl,
    normalizeGlucoseToMgdl: optsMerged.normalizeGlucoseToMgdl,
    glucoseDecimals: optsMerged.glucoseDecimals,
  };

  const observationResources = mapVitalsToObservations(values, observationOptions);
  const entries: Array<{
    fullUrl: string;
    resource: any;
    request: { method: string; url: string };
  }> = [];

  const sectionOrder = ['Vitals', 'Medications', 'Devices', 'Oxygen therapy', 'Attachments'];
  const sections = new Map<string, { title: string; entry: Array<{ reference: string }> }>();
  const addSectionEntry = (title: string, reference: string) => {
    if (!reference) return;
    const section = sections.get(title) ?? { title, entry: [] };
    section.entry.push({ reference });
    sections.set(title, section);
  };

  const observationInfo = new Map<string, { resource: Observation; fullUrl: string }>();
  let acvpuMember: string | undefined;
  const glucoseMembers: string[] = [];
  const glucoseMemberSet = new Set<string>();
  const loincCandidates: Array<unknown> = [
    __test__.LOINC?.GLUCOSE_MASS,
    __test__.LOINC?.GLUCOSE_MOLE,
  ];
  const glucoseLoincCodes = new Set<string>(loincCandidates.filter(isNonEmptyString));
  const acvpuCode = __test__.CODES?.ACVPU?.code ?? __test__.LOINC?.ACVPU;

  const addEntry = (
    resourceType: string,
    resource: any,
    key: unknown,
    sectionTitle?: string,
    options: { prepend?: boolean } = {},
  ): string => {
    const id = resolveResourceId(resourceType, resource, patientId, key, now);
    resource.id = id;
    applyExtraProfiles(resource, resourceType, profileExtras);
    const fullUrl = `urn:uuid:${id}`;
    const entry = {
      fullUrl,
      resource,
      request: {
        method: 'PUT',
        url: `${resourceType}/${id}`,
      },
    };
    if (options.prepend) {
      entries.unshift(entry);
    } else {
      entries.push(entry);
    }
    if (sectionTitle) addSectionEntry(sectionTitle, fullUrl);
    return fullUrl;
  };

  for (const obs of observationResources) {
    const loincCode = getObservationLoincCode(obs);
    const hasOxygenTherapy = (obs.code?.coding ?? []).some(
      (coding) => coding.system === SNOMED_SYSTEM && coding.code === __test__.SNOMED.OXYGEN_THERAPY,
    );
    const sectionTitle = hasOxygenTherapy ? 'Oxygen therapy' : 'Vitals';
    const key = {
      code: loincCode ?? obs.code,
      effective: obs.effectiveDateTime ?? now,
      value: obs.valueQuantity,
      component: obs.component,
      note: obs.note,
    };
    const fullUrl = addEntry('Observation', obs, key, sectionTitle);

    if (loincCode) {
      observationInfo.set(loincCode, { resource: obs, fullUrl });
      if (acvpuCode && loincCode === acvpuCode) {
        acvpuMember = fullUrl;
      }
      if (glucoseLoincCodes.has(loincCode) && !glucoseMemberSet.has(fullUrl)) {
        glucoseMemberSet.add(fullUrl);
        glucoseMembers.push(fullUrl);
      }
    }
  }

  const explicitEmitPanel = typeof opts?.emitPanel === 'boolean' ? opts.emitPanel : undefined;
  const emitVitalsPanel =
    typeof opts?.emitVitalsPanel === 'boolean'
      ? opts.emitVitalsPanel
      : explicitEmitPanel ?? DEFAULT_OPTS.emitVitalsPanel;
  const emitBpPanel =
    typeof opts?.emitBpPanel === 'boolean'
      ? opts.emitBpPanel
      : explicitEmitPanel ?? DEFAULT_OPTS.emitBpPanel;
  const emitHasMember =
    typeof opts?.emitHasMember === 'boolean'
      ? opts.emitHasMember
      : DEFAULT_OPTS.emitHasMember;

  const codeDisplayMap = new Map<string, string>([
    [__test__.CODES.HR.code, __test__.CODES.HR.display],
    [__test__.CODES.RR.code, __test__.CODES.RR.display],
    [__test__.CODES.TEMP.code, __test__.CODES.TEMP.display],
    [__test__.CODES.SPO2.code, __test__.CODES.SPO2.display],
    [__test__.CODES.SBP.code, __test__.CODES.SBP.display],
    [__test__.CODES.DBP.code, __test__.CODES.DBP.display],
  ]);

  const vitalComponentCodes = [
    __test__.CODES.HR.code,
    __test__.CODES.RR.code,
    __test__.CODES.TEMP.code,
    __test__.CODES.SPO2.code,
    __test__.CODES.SBP.code,
    __test__.CODES.DBP.code,
  ];

  if (emitVitalsPanel) {
    const components: Observation['component'] = [];
    for (const code of vitalComponentCodes) {
      const info = observationInfo.get(code);
      if (!info?.resource.valueQuantity) continue;
      const display = codeDisplayMap.get(code);
      components.push({
        code: codeCC(LOINC_SYSTEM, code, display, display),
        valueQuantity: info.resource.valueQuantity,
      });
    }

    if (components.length > 0) {
      const panel: ObsEx = {
        resourceType: 'Observation',
        status: 'final',
        subject: refPatient(patientId),
        encounter: refEncounter(values.encounterId),
        effectiveDateTime: now,
        category: categoryVital,
        code: codeCC(
          LOINC_SYSTEM,
          __test__.CODES.PANEL_VS.code,
          __test__.CODES.PANEL_VS.display,
          __test__.CODES.PANEL_VS.display,
        ),
        component: components,
        meta: { profile: [PROFILE_VITAL_SIGNS] },
      };

      if (emitHasMember) {
        const members: Array<{ reference: string }> = [];
        for (const code of vitalComponentCodes) {
          const info = observationInfo.get(code);
          if (info) members.push({ reference: info.fullUrl });
        }
        for (const ref of glucoseMembers) members.push({ reference: ref });
        if (acvpuMember) members.push({ reference: acvpuMember });
        if (members.length) panel.hasMember = members;
      }

      addEntry('Observation', panel, {
        code: __test__.CODES.PANEL_VS.code,
        effective: now,
        component: components,
      }, 'Vitals');
    }
  }

  if (emitBpPanel) {
    const bpCodes = [__test__.CODES.SBP.code, __test__.CODES.DBP.code];
    const bpComponents: Observation['component'] = [];
    for (const code of bpCodes) {
      const info = observationInfo.get(code);
      if (!info?.resource.valueQuantity) continue;
      const display = codeDisplayMap.get(code);
      bpComponents.push({
        code: codeCC(LOINC_SYSTEM, code, display, display),
        valueQuantity: info.resource.valueQuantity,
      });
    }

    if (bpComponents.length > 0) {
      const bpPanel: ObsEx = {
        resourceType: 'Observation',
        status: 'final',
        subject: refPatient(patientId),
        encounter: refEncounter(values.encounterId),
        effectiveDateTime: now,
        category: categoryVital,
        code: codeCC(
          LOINC_SYSTEM,
          __test__.CODES.PANEL_BP.code,
          __test__.CODES.PANEL_BP.display,
          __test__.CODES.PANEL_BP.display,
        ),
        component: bpComponents,
        meta: { profile: [PROFILE_VITAL_SIGNS, PROFILE_BP] },
      };

      if (emitHasMember) {
        const members: Array<{ reference: string }> = [];
        for (const code of bpCodes) {
          const info = observationInfo.get(code);
          if (info) members.push({ reference: info.fullUrl });
        }
        if (members.length) bpPanel.hasMember = members;
      }

      addEntry('Observation', bpPanel, {
        code: __test__.CODES.PANEL_BP.code,
        effective: now,
        component: bpComponents,
      }, 'Vitals');
    }
  }

  const oxygenDevice = mapOxygenDevice(values);
  const oxygenDeviceFullUrl = oxygenDevice
    ? addEntry('Device', oxygenDevice, {
        type: oxygenDevice.type,
        status: oxygenDevice.status,
        name: oxygenDevice.deviceName,
      }, 'Oxygen therapy')
    : undefined;

  const oxygenResources = mapOxygenProcedure(values, { now }, oxygenDeviceFullUrl);
  oxygenResources.forEach((resource) => {
    addEntry('DeviceUseStatement', resource, {
      device: resource.device?.reference ?? oxygenDeviceFullUrl,
      status: resource.status,
      whenUsed: resource.whenUsed,
      recordedOn: resource.recordedOn,
    }, 'Oxygen therapy');
  });

  normalizedDevices.forEach((device) => {
    const deviceResource: Device = {
      resourceType: 'Device',
      status: device.status === 'active' ? 'active' : 'inactive',
      type: device.concept,
      deviceName: device.name ? [{ name: device.name, type: 'user-friendly-name' }] : undefined,
      identifier: device.identifier ? [{ value: device.identifier }] : undefined,
    };

    const deviceFullUrl = addEntry('Device', deviceResource, {
      concept: device.concept,
      identifier: device.identifier,
      name: device.name,
    });

    const deviceUse: DeviceUseStatement = {
      resourceType: 'DeviceUseStatement',
      status: device.status,
      subject: refPatient(patientId),
      encounter: refEncounter(values.encounterId),
      device: { reference: deviceFullUrl, display: device.name ?? device.concept.text },
      whenUsed: device.start ? { start: device.start } : undefined,
      recordedOn: now,
      bodySiteCodeableConcept: device.bodySite ? { text: device.bodySite } : undefined,
      note: device.note ? [{ text: device.note }] : undefined,
    };

    addEntry('DeviceUseStatement', deviceUse, {
      device: deviceFullUrl,
      status: device.status,
      whenUsed: deviceUse.whenUsed,
      recordedOn: deviceUse.recordedOn,
      bodySite: device.bodySite,
      note: device.note,
    }, 'Devices');
  });

  const medicationResources = mapMedicationStatements(values, medsInput, now);
  medicationResources.forEach((resource, index) => {
    addEntry('MedicationStatement', resource, {
      concept: resource.medicationCodeableConcept,
      when: resource.effectiveDateTime,
      dosage: resource.dosage,
    }, 'Medications');
  });

  const documentRefs = mapDocumentReference(values, attachments, now);
  documentRefs.forEach((resource, index) => {
    addEntry('DocumentReference', resource, {
      content: resource.content,
      date: resource.date,
      description: resource.description,
    }, 'Attachments');
  });

  const identifierSeed = {
    patientId,
    encounterId: values.encounterId ?? null,
    now,
    vitals: normalizedVitals,
    meds: normalizedMeds,
    devices: normalizedDevices,
    attachments: attachments ?? [],
  };
  const identifierValue = deterministicHash(identifierSeed);

  const compositionSections = sectionOrder
    .map((title) => sections.get(title))
    .filter((section): section is { title: string; entry: Array<{ reference: string }> } =>
      Boolean(section && section.entry.length),
    );

  const composition: Composition = {
    resourceType: 'Composition',
    status: 'final',
    type: { text: 'Nursing handover' },
    subject: refPatient(patientId),
    encounter: refEncounter(values.encounterId),
    date: now,
    title: 'Nursing handover',
    identifier: { system: 'urn:uuid', value: identifierValue },
    section: compositionSections,
  };

  const compositionId = deterministicResourceId('Composition', patientId, identifierValue);
  composition.id = compositionId;
  applyExtraProfiles(composition, 'Composition', profileExtras);

  const compositionFullUrl = `urn:uuid:${compositionId}`;

  entries.unshift({
    fullUrl: compositionFullUrl,
    resource: composition,
    request: {
      method: 'PUT',
      url: `Composition/${compositionId}`,
    },
  });

  return {
    resourceType: 'Bundle',
    id: deterministicResourceId('Bundle', patientId, identifierValue),
    type: 'transaction',
    entry: entries,
  };
}

///////////////////////////
// Utilidades internas
///////////////////////////

function isNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function normalizeFiO2ToPct(fio2: number): number {
  // Acepta 0..1 (multiplica x100) o 21..100 (dejar igual); clamp 21..100 por seguridad
  const val = fio2 <= 1 ? fio2 * 100 : fio2;
  return Math.min(100, Math.max(21, Math.round(val)));
}

function normalizeDeviceUseStatus(status: unknown): DeviceUseStatement["status"] {
  if (typeof status === "string") {
    const normalized = status.trim().toLowerCase();
    switch (normalized) {
      case "active":
      case "in-progress":
        return "active";
      case "intended":
        return "intended";
      case "stopped":
        return "stopped";
      case "on-hold":
        return "on-hold";
      case "unknown":
        return "unknown";
      case "completed":
      case "inactive":
      case "removed":
      case "finished":
        return "completed";
    }
  }
  return "completed";
}

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function coerceNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : undefined;
  }
  return undefined;
}

function normalizeProfileOptions(input: BuildOptions["profileUrls"]): ProfileUrlMap {
  if (!input) return {};
  const result: ProfileUrlMap = {};

  const assignList = (resourceType: string, list: string[] | undefined) => {
    if (!list) return;
    const filtered = list
      .map(trimToUndefined)
      .filter((v): v is string => Boolean(v));
    if (filtered.length) {
      result[resourceType] = Array.from(new Set(filtered));
    }
  };

  if (Array.isArray(input)) {
    assignList('Observation', input);
    return result;
  }

  for (const [resourceType, urls] of Object.entries(input)) {
    assignList(resourceType, Array.isArray(urls) ? urls : []);
  }

  return result;
}

function applyExtraProfiles(resource: any, resourceType: string, extras: ProfileUrlMap) {
  const list = extras[resourceType];
  if (!list || list.length === 0) return;
  const existing = Array.isArray(resource?.meta?.profile) ? resource.meta.profile : [];
  const combined = Array.from(new Set([...existing, ...list]));
  if (combined.length) {
    resource.meta = resource.meta ?? {};
    resource.meta.profile = combined;
  }
}

function getObservationLoincCode(obs: Observation): string | undefined {
  const coding = obs.code?.coding ?? [];
  const loinc = coding.find((c) => c.system === LOINC_SYSTEM && c.code);
  return loinc?.code;
}

function stableStringify(value: any): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(',')}}`;
}

function deterministicHash(value: any): string {
  const hash = createHash('sha256');
  hash.update(stableStringify(value));
  return hash.digest('hex');
}

function deterministicResourceId(resourceType: string, patientId: string, key: unknown): string {
  const hash = deterministicHash({ patientId, resourceType, key });
  return `${resourceType.toLowerCase()}-${hash.slice(0, 24)}`;
}

function resolveResourceId(
  resourceType: string,
  resource: any,
  patientId: string,
  key: unknown,
  now: string,
): string {
  if (resourceType === 'Observation') {
    const loincCode = getObservationLoincCode(resource);
    const acvpuCode = __test__.CODES?.ACVPU?.code ?? __test__.LOINC?.ACVPU;
    if (acvpuCode && loincCode === acvpuCode) {
      const effective = (resource.effectiveDateTime ?? now).slice(0, 10);
      return `obs-acvpu-${patientId}-${effective}`;
    }
    if (loincCode) {
      return `obs-${loincCode}-${patientId}`;
    }
    const oxygenCoding = (resource.code?.coding ?? []).find(
      (coding: FhirCoding) => coding.system === SNOMED_SYSTEM && coding.code === __test__.SNOMED.OXYGEN_THERAPY,
    );
    if (oxygenCoding) {
      return `obs-oxygen-${patientId}`;
    }
  }

  if (resourceType === 'MedicationStatement') {
    return `med-${deterministicHash({ patientId, key }).slice(0, 24)}`;
  }

  if (resourceType === 'Device') {
    return `device-${deterministicHash({ patientId, key }).slice(0, 24)}`;
  }

  if (resourceType === 'DeviceUseStatement') {
    return `deviceuse-${deterministicHash({ patientId, key }).slice(0, 24)}`;
  }

  if (resourceType === 'DocumentReference') {
    return `doc-${deterministicHash({ patientId, key }).slice(0, 24)}`;
  }

  if (resourceType === 'Composition') {
    return `composition-${deterministicHash({ patientId, key }).slice(0, 24)}`;
  }

  return deterministicResourceId(resourceType, patientId, key);
}

