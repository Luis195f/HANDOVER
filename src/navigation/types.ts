type LegacyHandoverParams = {
  patientId?: string;
  unitId?: string;
};

type HandoverFormParams = {
  patientIdParam?: string;
  unitIdParam?: string;
  specialtyId?: string;
} & LegacyHandoverParams;

type QRScanParams = {
  returnTo?: 'HandoverForm' | 'PatientList' | 'AudioNote';
  unitIdParam?: string;
  specialtyId?: string;
};

export type RootStackParamList = {
  PatientList: undefined;
  AudioNote: { onDoneRoute?: string } | undefined;
  HandoverForm: HandoverFormParams;
  QRScan: QRScanParams | undefined;
  SyncCenter: undefined;
};
