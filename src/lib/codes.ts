export const LOINC = {
  hr: '8867-4',
  rr: '9279-1',
  temp: '8310-5',
  spo2: '59408-5',
  bpPanel: '85354-9',
  sbp: '8480-6',
  dbp: '8462-4',
  glucoseMgDl: '2339-0',
  glucoseMmolL: '15074-8',
} as const;

export const SNOMED = {
  oxygenTherapy: '371907003',
} as const;

export const CATEGORY = {
  vitalSigns: {
    system: 'http://terminology.hl7.org/CodeSystem/observation-category',
    code: 'vital-signs',
  },
} as const;
