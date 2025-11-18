import type { AdministrativeData } from './administrative';

export const DIET_TYPES = ['oral', 'enteral', 'parenteral', 'npo', 'other'] as const;
export type DietType = (typeof DIET_TYPES)[number];

export const STOOL_PATTERNS = ['normal', 'diarrhea', 'constipation', 'no_stool'] as const;
export type StoolPattern = (typeof STOOL_PATTERNS)[number];

export const MOBILITY_LEVELS = ['independent', 'assisted', 'bedbound'] as const;
export type MobilityLevel = (typeof MOBILITY_LEVELS)[number];

export type NutritionInfo = {
  dietType: DietType;
  tolerance?: string;
  intakeMl?: number;
};

export type EliminationInfo = {
  urineMl?: number;
  stoolPattern?: StoolPattern;
  hasRectalTube?: boolean;
};

export type MobilityInfo = {
  mobilityLevel: MobilityLevel;
  repositioningPlan?: string;
};

export type SkinInfo = {
  skinStatus: string;
  hasPressureInjury?: boolean;
};

export type FluidBalanceInfo = {
  intakeMl: number;
  outputMl: number;
  netBalanceMl?: number;
};

export type Vitals = {
  hr?: number;
  rr?: number;
  tempC?: number;
  spo2?: number;
  sbp?: number;
  dbp?: number;
  glucoseMgDl?: number;
  glucoseMmolL?: number;
  avpu?: 'A' | 'C' | 'V' | 'P' | 'U';
};

export type OxygenTherapy = {
  flowLMin?: number;
  device?: string;
  fio2?: number;
};

export type HandoverValues = {
  administrativeData: AdministrativeData;
  patientId: string;
  vitals?: Vitals;
  dxMedical?: string;
  dxNursing?: string;
  evolution?: string;
  sbarSituation?: string;
  sbarBackground?: string;
  sbarAssessment?: string;
  sbarRecommendation?: string;
  meds?: string;
  oxygenTherapy?: OxygenTherapy;
  audioUri?: string;
  nutrition?: NutritionInfo;
  elimination?: EliminationInfo;
  mobility?: MobilityInfo;
  skin?: SkinInfo;
  fluidBalance?: FluidBalanceInfo;
};
