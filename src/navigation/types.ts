import type { AdministrativeData } from "@/src/types/administrative";
import type { PrefillOutput } from "@/src/lib/prefill";
import type { PatientSummary } from "@/src/lib/fhir-client";

type LegacyHandoverParams = {
  patientId?: string;
  unitId?: string;
};

type PrefillMeta = {
  server?: string;
  unit?: string;
  bed?: string;
  visitId?: string;
};

type HandoverFormParams = {
  patientIdParam?: string;
  unitIdParam?: string;
  specialtyId?: string;
  administrativeData?: AdministrativeData;
  prefilledValues?: PrefillOutput | null;
  patientSummary?: PatientSummary | null;
  prefillMeta?: PrefillMeta;
} & LegacyHandoverParams;

type ShiftDetailsParams = {
  returnTo?: "HandoverForm" | "HandoverMain" | "PatientList";
  administrativeData?: AdministrativeData;
};

type QRScanParams = {
  returnTo?: 'HandoverForm' | 'PatientList' | 'AudioNote';
  unitIdParam?: string;
  specialtyId?: string;
  prefillMeta?: PrefillMeta;
};

export type RootStackParamList = {
  PatientList: undefined;
  AudioNote: { onDoneRoute?: string } | undefined;
  HandoverMain: { patientId: string };
  HandoverForm: HandoverFormParams;
  ShiftDetails: ShiftDetailsParams | undefined;
  QRScan: QRScanParams | undefined;
  SyncCenter: undefined;
  SupervisorDashboard: undefined;
  AdminDashboard: undefined;
  PatientDashboard: { patientId: string };
  Login: undefined;
  Unauthorized: undefined;
  Onboarding: undefined;
};
