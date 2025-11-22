export const TERMINOLOGY_SYSTEMS = {
  LOINC: 'http://loinc.org',
  SNOMED: 'http://snomed.info/sct',
  UCUM: 'http://unitsofmeasure.org',
  OBSERVATION_CATEGORY: 'http://terminology.hl7.org/CodeSystem/observation-category',
  HANDOVER_CARE: 'urn:handover-pro:care',
  HANDOVER_TREATMENT_TYPE: 'urn:handover-pro:care:treatment-type',
} as const;

export type TerminologySystem =
  (typeof TERMINOLOGY_SYSTEMS)[keyof typeof TERMINOLOGY_SYSTEMS];

export type TerminologyCode<TCode extends string = string> = Readonly<{
  system: TerminologySystem;
  code: TCode;
  display?: string;
}>;

export const LOINC = {
  hr: '8867-4',
  rr: '9279-1',
  temp: '8310-5',
  spo2: '59408-5',
  bpPanel: '85354-9',
  sbp: '8480-6',
  dbp: '8462-4',
  vitalSignsPanel: '85353-1',
  glucoseMgDl: '2339-0',
  glucoseMmolL: '15074-8',
  fio2: '3151-8',
  o2Flow: '3150-0',
  acvpu: '67775-7',
  painEva: '38208-5',
  bradenScale: '38876-5',
  glasgowTotal: '9267-6',
} as const;

export type LoincCode = (typeof LOINC)[keyof typeof LOINC];

export const SNOMED = {
  oxygenTherapy: '371907003',
  avpuAssessment: '450063008',
  avpuAlert: '248234009',
  avpuVoice: '248235005',
  avpuPain: '248236006',
  avpuUnresponsive: '248237002',
  avpuConfusion: '162846003',
} as const;

export type SnomedCode = (typeof SNOMED)[keyof typeof SNOMED];

export const CATEGORY = {
  vitalSigns: {
    system: TERMINOLOGY_SYSTEMS.OBSERVATION_CATEGORY,
    code: 'vital-signs',
    display: 'Vital Signs',
  },
  laboratory: {
    system: TERMINOLOGY_SYSTEMS.OBSERVATION_CATEGORY,
    code: 'laboratory',
    display: 'Laboratory',
  },
} as const satisfies Record<string, TerminologyCode<string>>;

export type ObservationCategory =
  (typeof CATEGORY)[keyof typeof CATEGORY];

export type FhirCode = TerminologyCode<string>;

type FhirCodeGroup = Record<string, TerminologyCode<string>>;

export const FHIR_CODES = {
  VITALS: {
    VITAL_SIGNS_PANEL: {
      system: TERMINOLOGY_SYSTEMS.LOINC,
      code: LOINC.vitalSignsPanel,
      display: 'Vital signs panel',
    },
    BP_PANEL: {
      system: TERMINOLOGY_SYSTEMS.LOINC,
      code: LOINC.bpPanel,
      display: 'Blood pressure panel',
    },
    BP_SYSTOLIC: {
      system: TERMINOLOGY_SYSTEMS.LOINC,
      code: LOINC.sbp,
      display: 'Systolic blood pressure',
    },
    BP_DIASTOLIC: {
      system: TERMINOLOGY_SYSTEMS.LOINC,
      code: LOINC.dbp,
      display: 'Diastolic blood pressure',
    },
    HEART_RATE: {
      system: TERMINOLOGY_SYSTEMS.LOINC,
      code: LOINC.hr,
      display: 'Heart rate',
    },
    RESP_RATE: {
      system: TERMINOLOGY_SYSTEMS.LOINC,
      code: LOINC.rr,
      display: 'Respiratory rate',
    },
    TEMPERATURE: {
      system: TERMINOLOGY_SYSTEMS.LOINC,
      code: LOINC.temp,
      display: 'Body temperature',
    },
    SPO2: {
      system: TERMINOLOGY_SYSTEMS.LOINC,
      code: LOINC.spo2,
      display: 'Oxygen saturation',
    },
    GLUCOSE_MASS_BLD: {
      system: TERMINOLOGY_SYSTEMS.LOINC,
      code: LOINC.glucoseMgDl,
      display: 'Glucose [Mass/volume] in Blood',
    },
    GLUCOSE_MOLES_BLD: {
      system: TERMINOLOGY_SYSTEMS.LOINC,
      code: LOINC.glucoseMmolL,
      display: 'Glucose [Moles/volume] in Blood',
    },
    FIO2: {
      system: TERMINOLOGY_SYSTEMS.LOINC,
      code: LOINC.fio2,
      display: 'Fraction of inspired oxygen',
    },
    O2_FLOW: {
      system: TERMINOLOGY_SYSTEMS.LOINC,
      code: LOINC.o2Flow,
      display: 'Oxygen flow rate',
    },
    ACVPU: {
      system: TERMINOLOGY_SYSTEMS.LOINC,
      code: LOINC.acvpu,
      display: 'ACVPU scale',
    },
  },
  SCALES: {
    EVA: {
      system: TERMINOLOGY_SYSTEMS.LOINC,
      code: LOINC.painEva,
      display: 'Pain severity visual analogue score',
    },
    BRADEN: {
      system: TERMINOLOGY_SYSTEMS.LOINC,
      code: LOINC.bradenScale,
      display: 'Braden scale total score',
    },
    GLASGOW: {
      system: TERMINOLOGY_SYSTEMS.LOINC,
      code: LOINC.glasgowTotal,
      display: 'Glasgow coma scale total score',
    },
  },
  CARE: {
    NUTRITION: {
      system: TERMINOLOGY_SYSTEMS.HANDOVER_CARE,
      code: 'nutrition-care',
      display: 'Nutrition care assessment',
    },
    URINE_OUTPUT: {
      system: TERMINOLOGY_SYSTEMS.HANDOVER_CARE,
      code: 'urine-output',
      display: 'Urine output',
    },
    STOOL_PATTERN: {
      system: TERMINOLOGY_SYSTEMS.HANDOVER_CARE,
      code: 'stool-pattern',
      display: 'Stool pattern',
    },
    RECTAL_TUBE: {
      system: TERMINOLOGY_SYSTEMS.HANDOVER_CARE,
      code: 'rectal-tube-status',
      display: 'Rectal tube status',
    },
    MOBILITY: {
      system: TERMINOLOGY_SYSTEMS.HANDOVER_CARE,
      code: 'mobility-assessment',
      display: 'Mobility assessment',
    },
    SKIN: {
      system: TERMINOLOGY_SYSTEMS.HANDOVER_CARE,
      code: 'skin-assessment',
      display: 'Skin assessment',
    },
    FLUID_BALANCE: {
      system: TERMINOLOGY_SYSTEMS.HANDOVER_CARE,
      code: 'fluid-balance',
      display: 'Fluid balance',
    },
  },
  RISK: {
    FALL: {
      system: TERMINOLOGY_SYSTEMS.SNOMED,
      code: '129839007',
      display: 'At risk for falls (finding)',
    },
    PRESSURE_ULCER: {
      system: TERMINOLOGY_SYSTEMS.SNOMED,
      code: '714658008',
      display: 'At risk of pressure ulcer (finding)',
    },
    SOCIAL_ISOLATION: {
      system: TERMINOLOGY_SYSTEMS.SNOMED,
      code: '1144779008',
      display: 'At increased risk for social isolation (finding)',
    },
  },
} as const satisfies Record<string, FhirCodeGroup>;

export type FhirVitalCode = (typeof FHIR_CODES.VITALS)[keyof typeof FHIR_CODES.VITALS];
export type FhirScaleCode = (typeof FHIR_CODES.SCALES)[keyof typeof FHIR_CODES.SCALES];
export type FhirRiskCode = (typeof FHIR_CODES.RISK)[keyof typeof FHIR_CODES.RISK];

export const MEDICATIONS_QUICKPICK_ICU = [
  {
    id: 'med-paracetamol',
    name: 'Paracetamol',
    code: {
      system: 'http://www.whocc.no/atc',
      code: 'N02BE01',
      display: 'Paracetamol',
    },
  },
  {
    id: 'med-omeprazole',
    name: 'Omeprazol',
    code: {
      system: 'http://www.whocc.no/atc',
      code: 'A02BC01',
      display: 'Omeprazole',
    },
  },
  {
    id: 'med-norepinephrine',
    name: 'Noradrenalina',
    code: {
      system: 'http://snomed.info/sct',
      code: '111397005',
      display: 'Product containing noradrenaline (medicinal product)',
    },
  },
  {
    id: 'med-vancomycin',
    name: 'Vancomicina',
    code: {
      system: 'http://www.whocc.no/atc',
      code: 'J01XA01',
      display: 'Vancomycin',
    },
  },
] as const;

export const ALERT_CODES = {
  news2: 'alert.news2',
  catheterOverdue: 'alert.catheter.overdue',
  allergyConflict: 'alert.allergy.medication',
  dressingOverdue: 'alert.dressing.overdue',
  drainOverdue: 'alert.drain.overdue',
  oxygenProlonged: 'alert.oxygen.prolonged',
} as const;
