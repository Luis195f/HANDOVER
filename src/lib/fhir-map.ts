import { z } from 'zod';

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
  };
  // Opcional: medicaciones administradas durante el turno
  meds?: MedicationInput[];
  attachments?: AttachmentInput[];
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

export type BuildOptions = {
  now?: string;
  authorId?: string;
  attachments?: AttachmentInput[];
  emitPanel?: boolean;
  emitIndividuals?: boolean;
  emitHasMember?: boolean;
  emitBpPanel?: boolean;
  normalizeGlucoseToMgdl?: boolean;
  glucoseDecimals?: number;
  profileUrls?: string[];
};

export type MedicationInput = {
  code?: { system?: string; code?: string; display?: string };
  name?: string;                // si no hay code, se usa como texto
  dose?: string | number;
  unit?: string;                // "mg", "mL", etc.
  route?: string;               // "PO", "IV", etc.
  when?: string;                // ISO timestamp; si falta, se usa now
  note?: string;
};

/////////////////////////////////////
// Adjuntos (validación y helpers)
/////////////////////////////////////

const HTTP_URL_RE = /^https?:\/\//i;

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
    O2_ADMINISTRATION: "243120004" // Administration of oxygen (procedure)
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
  timingDateTime?: string;
  reasonCode?: FhirCodeableConcept[];
  note?: Array<{ text: string }>;
};

type Bundle = {
  resourceType: "Bundle";
  id?: string;
  type: "collection" | "transaction" | "batch";
  entry: Array<{ resource: any }>;
};

/////////////////////////////////////
// Helpers puros (sin dependencias)
/////////////////////////////////////

const uom = UCUM_SYSTEM;
const nowISO = () => new Date().toISOString();
const newId = (pfx = "id") =>
  `${pfx}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;

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

export function mapObservationVitals(values: HandoverValues, opts?: BuildOptions): Observation[] {
  const res: Observation[] = [];
  const v = values?.vitals ?? {};
  if (!values?.patientId) return res;

  const subj = refPatient(values.patientId);
  const enc = refEncounter(values.encounterId);
  const effective = opts?.now ?? nowISO();

  const emitIndividuals = opts?.emitIndividuals ?? true;
  const emitPanel = opts?.emitPanel ?? false;
  const emitBpPanel = opts?.emitBpPanel ?? emitPanel;

  const normalizeGlucoseOption = opts?.normalizeGlucoseToMgDl ?? opts?.normalizeGlucoseToMgdl;
  const normalizeGlucose =
    typeof normalizeGlucoseOption === "boolean" ? normalizeGlucoseOption : true;
  const glucoseDecimals = opts?.glucoseDecimals ?? 0;

  const buildObservation = (params: {
    code: FhirCodeableConcept;
    category?: Observation["category"];
    valueQuantity?: Observation["valueQuantity"];
    valueCodeableConcept?: FhirCodeableConcept;
    component?: Observation["component"];
    note?: Observation["note"];
  }): Observation => ({
    resourceType: "Observation",
    status: "final",
    subject: subj,
    encounter: enc,
    effectiveDateTime: effective,
    category: params.category ?? categoryVital,
    code: params.code,
    ...(params.valueQuantity ? { valueQuantity: params.valueQuantity } : {}),
    ...(params.valueCodeableConcept ? { valueCodeableConcept: params.valueCodeableConcept } : {}),
    ...(params.component ? { component: params.component } : {}),
    ...(params.note ? { note: params.note } : {})
  });

  if (emitIndividuals && isNum(v.hr)) {
    res.push(
      buildObservation({
        code: codeCC(LOINC_SYSTEM, __test__.LOINC.HR, "Heart rate", "Heart rate"),
        valueQuantity: qty(v.hr, __test__.UNITS.PER_MIN)
      })
    );
  }

  if (emitIndividuals && isNum(v.rr)) {
    res.push(
      buildObservation({
        code: codeCC(LOINC_SYSTEM, __test__.LOINC.RR, "Respiratory rate", "Respiratory rate"),
        valueQuantity: qty(v.rr, __test__.UNITS.PER_MIN)
      })
    );
  }

  if (emitIndividuals && isNum(v.temp)) {
    res.push(
      buildObservation({
        code: codeCC(
          LOINC_SYSTEM,
          __test__.LOINC.TEMP,
          "Body temperature",
          "Body temperature"
        ),
        valueQuantity: qty(v.temp, __test__.UNITS.CEL, "Cel")
      })
    );
  }

  if (emitIndividuals && isNum(v.spo2)) {
    res.push(
      buildObservation({
        code: codeCC(
          LOINC_SYSTEM,
          __test__.LOINC.SPO2,
          "Oxygen saturation in Arterial blood by Pulse oximetry",
          "SpO2"
        ),
        valueQuantity: qty(v.spo2, __test__.UNITS.PERCENT, "%")
      })
    );
  }

  if (emitIndividuals && isNum(v.sbp)) {
    res.push(
      buildObservation({
        code: codeCC(
          LOINC_SYSTEM,
          __test__.LOINC.SBP,
          "Systolic blood pressure",
          "Systolic blood pressure"
        ),
        valueQuantity: qty(v.sbp, __test__.UNITS.MMHG)
      })
    );
  }

  if (emitIndividuals && isNum(v.dbp)) {
    res.push(
      buildObservation({
        code: codeCC(
          LOINC_SYSTEM,
          __test__.LOINC.DBP,
          "Diastolic blood pressure",
          "Diastolic blood pressure"
        ),
        valueQuantity: qty(v.dbp, __test__.UNITS.MMHG)
      })
    );
  }

  if (emitBpPanel && (isNum(v.sbp) || isNum(v.dbp))) {
    const components: Observation["component"] = [];
    if (isNum(v.sbp)) {
      components.push({
        code: codeCC(
          LOINC_SYSTEM,
          __test__.LOINC.SBP,
          "Systolic blood pressure",
          "Systolic blood pressure"
        ),
        valueQuantity: qty(v.sbp, __test__.UNITS.MMHG)
      });
    }
    if (isNum(v.dbp)) {
      components.push({
        code: codeCC(
          LOINC_SYSTEM,
          __test__.LOINC.DBP,
          "Diastolic blood pressure",
          "Diastolic blood pressure"
        ),
        valueQuantity: qty(v.dbp, __test__.UNITS.MMHG)
      });
    }
    res.push(
      buildObservation({
        code: codeCC(
          LOINC_SYSTEM,
          __test__.LOINC.BP_PANEL,
          "Blood pressure panel with all children optional",
          "Blood pressure panel"
        ),
        component: components
      })
    );
  }

  const hasBgMgDl = isNum(v.bgMgDl);
  const hasBgMmolL = isNum(v.bgMmolL);

  if (hasBgMgDl) {
    res.push(
      buildObservation({
        category: categoryLab,
        code: codeCC(
          LOINC_SYSTEM,
          __test__.LOINC.GLUCOSE_MASS,
          "Glucose [Mass/volume] in Blood",
          "Blood glucose"
        ),
        valueQuantity: qty(v.bgMgDl!, __test__.UNITS.MGDL)
      })
    );
  } else if (hasBgMmolL) {
    if (normalizeGlucose) {
      const converted = roundTo(v.bgMmolL! * GLUCOSE_CONVERSION_FACTOR, glucoseDecimals);
      const factor = GLUCOSE_CONVERSION_FACTOR.toFixed(4);
      res.push(
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
              text: `Convertido desde ${v.bgMmolL} mmol/L (factor ${factor})`
            }
          ]
        })
      );
    } else {
      res.push(
        buildObservation({
          category: categoryLab,
          code: codeCC(
            LOINC_SYSTEM,
            __test__.LOINC.GLUCOSE_MOLE,
            "Glucose [Moles/volume] in Blood",
            "Blood glucose"
          ),
          valueQuantity: qty(v.bgMmolL!, __test__.UNITS.MMOLL, "mmol/L")
        })
      );
    }
  }

  const rawAcvpu = v.acvpu ?? v.avpu;
  const acvpuValue =
    rawAcvpu === "A" ||
    rawAcvpu === "C" ||
    rawAcvpu === "V" ||
    rawAcvpu === "P" ||
    rawAcvpu === "U"
      ? (rawAcvpu as "A" | "C" | "V" | "P" | "U")
      : undefined;

  if (acvpuValue) {
    const answerLoinc = __test__.ACVPU_LOINC[acvpuValue];
    const answerSnomed = __test__.ACVPU_SNOMED[acvpuValue];
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

    res.push(
      buildObservation({
        code: codeCC(
          LOINC_SYSTEM,
          __test__.LOINC.ACVPU,
          __test__.CODES.ACVPU.display,
          __test__.CODES.ACVPU.display
        ),
        valueCodeableConcept: {
          ...(coding.length ? { coding } : {}),
          text: answerSnomed?.display ?? answerLoinc?.display ?? acvpuValue
        }
      })
    );
  }

  const hasO2 = !!v.o2 || isNum(v.fio2) || isNum(v.o2FlowLpm) || !!v.o2Device;
  if (hasO2) {
    if (isNum(v.fio2)) {
      const fi = normalizeFiO2ToPct(v.fio2);
      res.push(
        buildObservation({
          code: codeCC(
            LOINC_SYSTEM,
            __test__.LOINC.FIO2,
            "Inhaled oxygen concentration",
            "FiO2"
          ),
          valueQuantity: qty(fi, __test__.UNITS.PERCENT, "%")
        })
      );
    }
    if (isNum(v.o2FlowLpm)) {
      res.push(
        buildObservation({
          code: codeCC(
            LOINC_SYSTEM,
            __test__.LOINC.O2_FLOW,
            "Oxygen flow rate",
            "Oxygen flow rate"
          ),
          valueQuantity: qty(v.o2FlowLpm, "L/min")
        })
      );
    }
  }

  return res;
}

// Alias requerido por los tests
export function mapVitalsToObservations(values: HandoverValues, opts?: BuildOptions) {
  return mapObservationVitals(values, opts);
}

/////////////////////////////////////////
// MedicationStatement desde meds[]
/////////////////////////////////////////

function mapMedicationStatements(values: HandoverValues, medsArg?: MedicationInput[]): MedicationStatement[] {
  const meds = medsArg ?? values.meds ?? [];
  if (!meds || meds.length === 0) return [];

  const subj = refPatient(values.patientId);
  const enc = refEncounter(values.encounterId);
  const tFallback = nowISO();

  return meds.map<MedicationStatement>((m, i) => {
    const medCC: FhirCodeableConcept =
      m.code?.code || m.code?.display
        ? { coding: [{ system: m.code?.system, code: m.code?.code, display: m.code?.display }], text: m.name ?? m.code?.display }
        : { text: m.name ?? "Medication" };

    const dosageText = [
      m.dose !== undefined ? String(m.dose) : undefined,
      m.unit,
      m.route
    ]
      .filter(Boolean)
      .join(" ");

    const doseQuantity =
      m.dose !== undefined
        ? { value: Number(m.dose), unit: m.unit, system: uom, code: m.unit }
        : undefined;

    const ms: MedicationStatement = {
      resourceType: "MedicationStatement",
      id: newId("ms"),
      status: "completed",
      subject: subj,
      encounter: enc,
      effectiveDateTime: m.when ?? tFallback,
      medicationCodeableConcept: medCC,
      dosage: [
        {
          text: dosageText || undefined,
          route: m.route ? { text: m.route } : undefined,
          doseAndRate: doseQuantity ? [{ doseQuantity }] : undefined
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

function mapOxygenProcedure(values: HandoverValues, opts?: BuildOptions): DeviceUseStatement[] {
  const v = values.vitals ?? {};
  const hasO2 = !!v.o2 || isNum(v.fio2) || isNum(v.o2FlowLpm) || !!v.o2Device;
  if (!hasO2) return [];

  const subj = refPatient(values.patientId);
  const enc = refEncounter(values.encounterId);
  const when = opts?.now ?? nowISO();

  const note = buildO2Note(values);

  const reason = codeCC(
    "http://snomed.info/sct",
    "46680005",
    "Need for supplemental oxygen",
    "Oxygen support"
  );

  return [
    {
      resourceType: "Procedure",
      id: newId("proc-o2"),
      status: "completed",
      code: codeCC(SNOMED_SYSTEM, __test__.SNOMED.O2_ADMINISTRATION, "Administration of oxygen", "Oxygen therapy"),
      subject: subj,
      encounter: enc,
      timingDateTime: when,
      reasonCode: [reason],
      note
    }
  ];
}

function buildO2Note(values: HandoverValues) {
  const v = values.vitals ?? {};
  if (!v) return undefined;
  const parts: string[] = [];
  if (v.o2Device) parts.push(`Device: ${v.o2Device}`);
  if (isNum(v.o2FlowLpm)) parts.push(`Flow: ${v.o2FlowLpm} L/min`);
  if (isNum(v.fio2)) parts.push(`FiO2: ${normalizeFiO2ToPct(v.fio2)}%`);
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
    id: newId("docref"),
    status: "current",
    type: { text: "Handover attachments" },
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
  options: BuildOptions = {}
): Bundle {
  const isWrapped = typeof input === 'object' && input !== null && 'values' in (input as HandoverInput);
  const values: HandoverValues = isWrapped
    ? (input as HandoverInput).values
    : (input as HandoverValues);

  const attachmentsFromValues = Array.isArray(values.attachments)
    ? values.attachments
    : [];
  const attachmentsFromInput = isWrapped && Array.isArray((input as HandoverInput).attachments)
    ? ((input as HandoverInput).attachments as AttachmentInput[])
    : [];
  const attachmentsFromOptions = Array.isArray(options.attachments)
    ? options.attachments
    : [];

  const mergedAttachments = [...attachmentsFromValues, ...attachmentsFromInput, ...attachmentsFromOptions].filter(
    (att): att is AttachmentInput => Boolean(att)
  );
  const attachments = mergedAttachments.length > 0
    ? AttachmentArraySchema.parse(mergedAttachments)
    : undefined;

  const medsIn: MedicationInput[] | undefined = isWrapped
    ? (input as HandoverInput).meds ?? values.meds
    : values.meds;

  const resources: any[] = [];

  const opts = options ?? {};

  // 1) Observations de signos vitales (incluye FiO2/Flow si presentes)
  const obs = mapObservationVitals(values, opts);
  resources.push(...obs);

  // 2) Oxigenoterapia como DeviceUseStatement (si aplica)
  resources.push(...mapOxygenProcedure(values, opts));

  // 3) MedicationStatement desde meds
  resources.push(...mapMedicationStatements(values, medsIn));

  // 4) DocumentReference desde attachments
  resources.push(...mapDocumentReference(values, attachments, options.now));

  // Devuelve Bundle tipo collection (seguro para tests)
  return {
    resourceType: "Bundle",
    id: newId("bundle"),
    type: "collection",
    entry: resources.map(r => ({ resource: r }))
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

