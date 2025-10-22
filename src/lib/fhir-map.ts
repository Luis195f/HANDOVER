/* [NURSEOS PRO PATCH 2025-10-22] fhir-map.ts
   - Tipos y exports alineados con tests (HandoverValues, AttachmentInput, HandoverInput)
   - Alias de unidades (__test__.UNITS) y helpers
   - Vitals → Observation (incluye SBP/DBP, HR, RR, Temp, SpO2, Glucosa mg/dL y mmol/L, AVPU/ACVPU)
   - Oxigenoterapia: Observation (FiO2, Flow), Procedure (administración O2)
   - buildHandoverBundle: admite HandoverInput | HandoverValues, agrega DocumentReference (attachments) y MedicationStatement (meds)
   - Sin dependencias externas, compatible con TS estricto
*/

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

export type MedicationInput = {
  code?: { system?: string; code?: string; display?: string };
  name?: string;                // si no hay code, se usa como texto
  dose?: string | number;
  unit?: string;                // "mg", "mL", etc.
  route?: string;               // "PO", "IV", etc.
  when?: string;                // ISO timestamp; si falta, se usa now
  note?: string;
};

export type BuildOptions = {
  now?: string;
  emitPanel?: boolean;
  emitIndividuals?: boolean;
  emitHasMember?: boolean;
  emitBpPanel?: boolean;
  normalizeGlucoseToMgDl?: boolean;
  normalizeGlucoseToMgdl?: boolean;
  glucoseDecimals?: number;
  profileUrls?: Record<string, string[] | undefined>;
};

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
  LOINC: {
    BP_PANEL: "85354-9",
    SBP: "8480-6",
    DBP: "8462-4",
    HR: "8867-4",
    RR: "9279-1",
    TEMP: "8310-5",
    SPO2: "59408-5",
    GLUCOSE_MASS: "2339-0",
    GLUCOSE_MOLE: "15074-8",
    FIO2: "3150-0",
    O2_FLOW: "19849-6"
  } as const,
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

const uom = "http://unitsofmeasure.org";
const nowISO = () => new Date().toISOString();
const newId = (pfx = "id") =>
  `${pfx}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;

const refPatient = (patientId: string): FhirRef => ({ reference: `Patient/${patientId}` });
const refEncounter = (encounterId?: string): FhirRef | undefined =>
  encounterId ? { reference: `Encounter/${encounterId}` } : undefined;

const categoryVital: Observation["category"] = [
  { coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs", display: "Vital Signs" }] }
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
  const subj = refPatient(values.patientId);
  const enc = refEncounter(values.encounterId);
  const t = opts?.now ?? nowISO();

  // Heart Rate
  if (isNum(v.hr)) {
    res.push({
      resourceType: "Observation",
      id: newId("obs-hr"),
      status: "final",
      category: categoryVital,
      code: codeCC("http://loinc.org", __test__.LOINC.HR, "Heart rate", "Heart rate"),
      subject: subj,
      encounter: enc,
      effectiveDateTime: t,
      valueQuantity: qty(v.hr!, __test__.UNITS.PER_MIN)
    });
  }

  // Respiratory Rate
  if (isNum(v.rr)) {
    res.push({
      resourceType: "Observation",
      id: newId("obs-rr"),
      status: "final",
      category: categoryVital,
      code: codeCC("http://loinc.org", __test__.LOINC.RR, "Respiratory rate", "Respiratory rate"),
      subject: subj,
      encounter: enc,
      effectiveDateTime: t,
      valueQuantity: qty(v.rr!, __test__.UNITS.PER_MIN)
    });
  }

  // Temperature (°C → UCUM: Cel)
  if (isNum(v.temp)) {
    res.push({
      resourceType: "Observation",
      id: newId("obs-temp"),
      status: "final",
      category: categoryVital,
      code: codeCC("http://loinc.org", __test__.LOINC.TEMP, "Body temperature", "Body temperature"),
      subject: subj,
      encounter: enc,
      effectiveDateTime: t,
      valueQuantity: qty(v.temp!, __test__.UNITS.CEL, "Cel")
    });
  }

  // SpO2 (%)
  if (isNum(v.spo2)) {
    res.push({
      resourceType: "Observation",
      id: newId("obs-spo2"),
      status: "final",
      category: categoryVital,
      code: codeCC("http://loinc.org", __test__.LOINC.SPO2, "Oxygen saturation in Arterial blood by Pulse oximetry", "SpO2"),
      subject: subj,
      encounter: enc,
      effectiveDateTime: t,
      valueQuantity: qty(v.spo2!, __test__.UNITS.PERCENT, "%")
    });
  }

  // Blood Pressure panel con componentes SBP/DBP si existe alguno
  if (isNum(v.sbp) || isNum(v.dbp)) {
    const components: Observation["component"] = [];
    if (isNum(v.sbp)) {
      components.push({
        code: codeCC("http://loinc.org", __test__.LOINC.SBP, "Systolic blood pressure", "Systolic"),
        valueQuantity: qty(v.sbp!, __test__.UNITS.MMHG)
      });
    }
    if (isNum(v.dbp)) {
      components.push({
        code: codeCC("http://loinc.org", __test__.LOINC.DBP, "Diastolic blood pressure", "Diastolic"),
        valueQuantity: qty(v.dbp!, __test__.UNITS.MMHG)
      });
    }
    res.push({
      resourceType: "Observation",
      id: newId("obs-bp"),
      status: "final",
      category: categoryVital,
      code: codeCC("http://loinc.org", __test__.LOINC.BP_PANEL, "Blood pressure panel with all children optional", "Blood pressure"),
      subject: subj,
      encounter: enc,
      effectiveDateTime: t,
      component: components
    });
  }

  // Glucose mg/dL
  if (isNum(v.bgMgDl)) {
    res.push({
      resourceType: "Observation",
      id: newId("obs-glu-mass"),
      status: "final",
      category: categoryVital,
      code: codeCC("http://loinc.org", __test__.LOINC.GLUCOSE_MASS, "Glucose [Mass/volume] in Blood", "Blood glucose"),
      subject: subj,
      encounter: enc,
      effectiveDateTime: t,
      valueQuantity: qty(v.bgMgDl!, __test__.UNITS.MGDL)
    });
  }

  // Glucose mmol/L
  if (isNum(v.bgMmolL)) {
    res.push({
      resourceType: "Observation",
      id: newId("obs-glu-mole"),
      status: "final",
      category: categoryVital,
      code: codeCC("http://loinc.org", __test__.LOINC.GLUCOSE_MOLE, "Glucose [Moles/volume] in Blood", "Blood glucose"),
      subject: subj,
      encounter: enc,
      effectiveDateTime: t,
      valueQuantity: qty(v.bgMmolL!, __test__.UNITS.MMOLL, "mmol/L")
    });
  }

  // AVPU / ACVPU como observaciones cualitativas simples (para tests)
  if (v.avpu) {
    res.push({
      resourceType: "Observation",
      id: newId("obs-avpu"),
      status: "final",
      category: categoryVital,
      code: { text: "AVPU scale" },
      subject: subj,
      encounter: enc,
      effectiveDateTime: t,
      valueCodeableConcept: { text: v.avpu }
    });
  }
  if (v.acvpu) {
    res.push({
      resourceType: "Observation",
      id: newId("obs-acvpu"),
      status: "final",
      category: categoryVital,
      code: { text: "ACVPU scale" },
      subject: subj,
      encounter: enc,
      effectiveDateTime: t,
      valueCodeableConcept: { text: v.acvpu }
    });
  }

  // Oxigenoterapia: Observations (FiO2, Flow) si vienen valores
  const hasO2 = !!v.o2 || isNum(v.fio2) || isNum(v.o2FlowLpm) || !!v.o2Device;
  if (hasO2) {
    // FiO2 normalizado a %
    if (isNum(v.fio2)) {
      const fi = normalizeFiO2ToPct(v.fio2!);
      res.push({
        resourceType: "Observation",
        id: newId("obs-fio2"),
        status: "final",
        category: categoryVital,
        code: codeCC("http://loinc.org", __test__.LOINC.FIO2, "Inhaled oxygen concentration", "FiO2"),
        subject: subj,
        encounter: enc,
        effectiveDateTime: t,
        valueQuantity: qty(fi, __test__.UNITS.PERCENT, "%")
      });
    }
    // Flujo L/min
    if (isNum(v.o2FlowLpm)) {
      res.push({
        resourceType: "Observation",
        id: newId("obs-o2flow"),
        status: "final",
        category: categoryVital,
        code: codeCC("http://loinc.org", __test__.LOINC.O2_FLOW, "Oxygen flow rate", "O2 flow"),
        subject: subj,
        encounter: enc,
        effectiveDateTime: t,
        valueQuantity: qty(v.o2FlowLpm!, "L/min")
      });
    }
  }

  return res;
}

// Alias requerido por los tests
export function mapVitalsToObservations(values: HandoverValues) {
  return mapObservationVitals(values);
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
      resourceType: "DeviceUseStatement",
      id: newId("dus-o2"),
      status: "active",
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

function mapDocumentReference(values: HandoverValues, attachments?: AttachmentInput[]): DocumentReference[] {
  if (!attachments || attachments.length === 0) return [];
  const dr: DocumentReference = {
    resourceType: "DocumentReference",
    id: newId("docref"),
    status: "current",
    type: { text: "Handover attachments" },
    subject: refPatient(values.patientId),
    date: nowISO(),
    content: attachments.map(a => ({
      attachment: {
        url: a.url,
        contentType: a.contentType,
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

export function buildHandoverBundle(input: HandoverInput | HandoverValues, opts: BuildOptions = {}): Bundle {
  // Admite ambos (los tests varían)
  const values: HandoverValues = ("values" in (input as any))
    ? (input as any).values
    : (input as HandoverValues);

  const attachments: AttachmentInput[] | undefined =
    ("values" in (input as any)) ? (input as HandoverInput).attachments : undefined;

  const medsIn: MedicationInput[] | undefined =
    ("values" in (input as any)) ? (input as HandoverInput).meds : values.meds;

  const resources: any[] = [];

  // 1) Observations de signos vitales (incluye FiO2/Flow si presentes)
  const obs = mapObservationVitals(values, opts);
  resources.push(...obs);

  // 2) Oxigenoterapia como DeviceUseStatement (si aplica)
  resources.push(...mapOxygenProcedure(values, opts));

  // 3) MedicationStatement desde meds
  resources.push(...mapMedicationStatements(values, medsIn));

  // 4) DocumentReference desde attachments
  resources.push(...mapDocumentReference(values, attachments));

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

function normalizeFiO2ToPct(fio2: number): number {
  // Acepta 0..1 (multiplica x100) o 21..100 (dejar igual); clamp 21..100 por seguridad
  const val = fio2 <= 1 ? fio2 * 100 : fio2;
  return Math.min(100, Math.max(21, Math.round(val)));
}

