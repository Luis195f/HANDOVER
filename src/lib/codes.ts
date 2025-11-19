export const TERMINOLOGY_SYSTEMS = {
  LOINC: 'http://loinc.org',
  SNOMED: 'http://snomed.info/sct',
  UCUM: 'http://unitsofmeasure.org',
  OBSERVATION_CATEGORY: 'http://terminology.hl7.org/CodeSystem/observation-category',
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

export const FHIR_CODES = {
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
} as const satisfies {
  RISK: Record<string, TerminologyCode<string>>;
};

export type FhirRiskCode = (typeof FHIR_CODES.RISK)[keyof typeof FHIR_CODES.RISK];

export const ALERT_CODES = {
  news2: 'alert.news2',
  catheterOverdue: 'alert.catheter.overdue',
  allergyConflict: 'alert.allergy.medication',
  dressingOverdue: 'alert.dressing.overdue',
  drainOverdue: 'alert.drain.overdue',
  oxygenProlonged: 'alert.oxygen.prolonged',
} as const;
