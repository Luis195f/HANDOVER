import type { AdministrativeData } from "@/src/types/administrative";

type LegacyHandoverParams = {
  patientId?: string;
  unitId?: string;
};

type HandoverFormParams = {
  patientIdParam?: string;
  unitIdParam?: string;
  specialtyId?: string;
  administrativeData?: AdministrativeData;
} & LegacyHandoverParams;

type ShiftDetailsParams = {
  returnTo?: "HandoverForm" | "HandoverMain" | "PatientList";
  administrativeData?: AdministrativeData;
};

type QRScanParams = {
  returnTo?: 'HandoverForm' | 'PatientList' | 'AudioNote';
  unitIdParam?: string;
  specialtyId?: string;
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
};
