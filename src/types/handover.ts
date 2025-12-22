import { z } from 'zod';

import type { AdministrativeData } from './administrative';
import type {
  zExamItem,
  zMedicationItem,
  zProcedureItem,
  zRiskItem,
  zRiskType,
  zTreatmentItem,
} from '../validation/schemas';
// BEGIN HANDOVER D3 – StructuredDiagnosis types
import type { DiagnosisSystem } from '../catalogs/diagnosisCodes';
// END HANDOVER D3 – StructuredDiagnosis types
import { DIET_TYPES, MOBILITY_LEVELS, STOOL_PATTERNS } from './handover-constants';

// BEGIN HANDOVER: SIGNATURES_DUAL_TYPES
export type HandoverSignature = {
  userId: string;
  fullName: string;
  role?: 'nurse' | 'admin' | 'supervisor';
  unitId: string;
  signedAt: string;
  deviceInfo?: string;
  method?: 'session' | 'pin' | 'biometric';
};
// END HANDOVER: SIGNATURES_DUAL_TYPES

export type DietType = (typeof DIET_TYPES)[number];

export type StoolPattern = (typeof STOOL_PATTERNS)[number];

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

// BEGIN HANDOVER D3 – StructuredDiagnosis types
export interface HandoverStructuredDiagnosis {
  system: DiagnosisSystem;
  code: string;
  display: string;
  freeTextNote?: string;
}
// END HANDOVER D3 – StructuredDiagnosis types

export type SkinInfo = {
  skinStatus: string;
  hasPressureInjury?: boolean;
};

export type RiskType = z.infer<typeof zRiskType>;
export type RiskItem = z.infer<typeof zRiskItem>;

export type RiskFlags = {
  fall?: boolean;
  pressureUlcer?: boolean;
  isolation?: boolean;
};

// BEGIN HANDOVER D1 – BedsideChecklist types
export interface HandoverBedsideChecklist {
  patientIdentityConfirmed: boolean;
  allergiesReviewed: boolean;
  linesAndDevicesChecked: boolean;
  medicationPlanReviewed: boolean;
  safetyMeasuresApplied: boolean;
  questionsAnswered: boolean;
  bedsideNotes?: string;
}
// END HANDOVER D1 – BedsideChecklist types

export type FluidBalanceInfo = {
  intakeMl: number;
  outputMl: number;
  netBalanceMl?: number;
  notes?: string;
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

export type VitalsSnapshot = {
  hr?: number;
  rr?: number;
  tempC?: number;
  temp?: number;
  spo2?: number;
  sbp?: number;
  o2?: boolean;
  avpu?: 'A' | 'C' | 'V' | 'P' | 'U';
  scale2?: boolean;
};

export type DeviceItem = {
  name: string;
  active: boolean;
};

export type DeviceSummary = {
  id: string;
  label: string;
  category?: 'invasive' | 'support' | 'monitoring';
  critical?: boolean;
};

export type PendingTaskSummary = {
  id: string;
  title: string;
  urgent?: boolean;
  critical?: boolean;
};

export type OxygenTherapy = {
  flowLMin?: number;
  device?: string;
  fio2?: number;
};

export type PainAssessment = {
  hasPain: boolean;
  evaScore?: number | null;
  location?: string | null;
  actionsTaken?: string | null;
};

export type BradenSubscaleScore = 1 | 2 | 3 | 4;

// Aunque la subescala de fricción/cizalla suele ir de 1 a 3, dejamos 1–4 para
// mantener la consistencia con el resto y simplificar la entrada en la app.
export type BradenScale = {
  sensoryPerception: BradenSubscaleScore;
  moisture: BradenSubscaleScore;
  activity: BradenSubscaleScore;
  mobility: BradenSubscaleScore;
  nutrition: BradenSubscaleScore;
  frictionShear: 1 | 2 | 3 | 4;
  totalScore: number;
  riskLevel: 'alto' | 'moderado' | 'bajo' | 'sin_riesgo';
};

export type GlasgowScale = {
  eye: 1 | 2 | 3 | 4;
  verbal: 1 | 2 | 3 | 4 | 5;
  motor: 1 | 2 | 3 | 4 | 5 | 6;
  total: number;
  severity: 'grave' | 'moderado' | 'leve';
};

// BEGIN HANDOVER D7 – MedicationModule
export type MedicationItem = z.infer<typeof zMedicationItem> & {
  startTime?: string;
  endTime?: string;
  // alias to highlight continuous infusion semantics without breaking existing UI
  isContinuousInfusion?: boolean;
  signature?: HandoverSignature;
};
// END HANDOVER D7 – MedicationModule
export type TreatmentItem = z.infer<typeof zTreatmentItem>;
export type ExamItem = z.infer<typeof zExamItem>;
export type ProcedureItem = z.infer<typeof zProcedureItem>;

export type HandoverValues = {
  administrativeData: AdministrativeData;
  patientId: string;
  status?: 'draft' | 'final';
  vitals?: Vitals;
  dxMedical?: string;
  dxNursing?: string;
  // BEGIN HANDOVER D3 – StructuredDiagnosis types
  dxMedicalStructured?: HandoverStructuredDiagnosis[];
  dxNursingStructured?: HandoverStructuredDiagnosis[];
  // END HANDOVER D3 – StructuredDiagnosis types
  evolution?: string;
  closingSummary?: string;
  sbarSituation?: string;
  sbarBackground?: string;
  sbarAssessment?: string;
  sbarRecommendation?: string;
  meds?: string;
  medications?: MedicationItem[];
  treatments?: TreatmentItem[];
  exams?: ExamItem[];
  procedures?: ProcedureItem[];
  oxygenTherapy?: OxygenTherapy;
  devices?: DeviceItem[];
  audioUri?: string;
  nutrition?: NutritionInfo;
  elimination?: EliminationInfo;
  mobility?: MobilityInfo;
  skin?: SkinInfo;
  fluidBalance?: FluidBalanceInfo;
  painAssessment?: PainAssessment;
  braden?: BradenScale;
  glasgow?: GlasgowScale;
  // BEGIN HANDOVER D1 – BedsideChecklist types
  bedsideChecklist: HandoverBedsideChecklist;
  // END HANDOVER D1 – BedsideChecklist types
  risks?: RiskFlags;
  risksStructured?: RiskItem[];
  signatures?: {
    outgoing?: HandoverSignature;
    incoming?: HandoverSignature;
  };
};

export type Handover = HandoverValues;

export { DIET_TYPES, MOBILITY_LEVELS, STOOL_PATTERNS };
