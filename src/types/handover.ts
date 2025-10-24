export type HandoverValues = {
  patientId: string;
  notes?: string;
  close?: { audioUri?: string };
  vitals?: {
    sbp?: number;
    dbp?: number;
    hr?: number;
    rr?: number;
    temp?: number;
    spo2?: number;
    o2?: boolean;
    o2Device?: string;
    o2FlowLpm?: number;
    fio2?: number;
  };
};
