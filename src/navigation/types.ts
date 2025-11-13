type LegacyHandoverParams = {
  patientId?: string;
  unitId?: string;
};

type HandoverParams = {
  patientIdParam?: string;
  unitIdParam?: string;
  specialtyId?: string;
} & LegacyHandoverParams;

type QRScanParams = {
  returnTo?: 'Handover' | 'PatientList' | 'AudioNote';
  unitIdParam?: string;
  specialtyId?: string;
};

export type RootStackParamList = {
  PatientList: undefined;
  AudioNote: { onDoneRoute?: string } | undefined;
  HandoverMain: { patientId: string };
  Handover: HandoverParams;
  QRScan: QRScanParams | undefined;
  SyncCenter: undefined;
};
