export type RootStackParamList = {
  PatientList: undefined;
  AudioNote: { onDoneRoute?: string } | undefined;
  HandoverForm: { patientId: string; unitId: string; specialtyId: string };
  QRScan: { returnTo?: 'HandoverForm' } | undefined;
  SyncCenter: undefined;
};
