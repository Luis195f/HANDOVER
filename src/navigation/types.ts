export type RootStackParamList = {
  PatientList: undefined;
  HandoverForm: { patientId: string; unitId: string; specialtyId: string };
  QRScan: { returnTo?: 'HandoverForm' } | undefined;
  SyncCenter: undefined;
};
