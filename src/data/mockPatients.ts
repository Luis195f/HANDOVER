import type {
  DeviceSummary,
  PendingTaskSummary,
  RiskFlags,
  VitalsSnapshot,
} from '@/src/types/handover';

export type PatientListItem = {
  id: string;
  name: string;
  unitId: string;
  bedLabel?: string;
  vitals?: VitalsSnapshot;
  devices?: DeviceSummary[];
  risks?: RiskFlags;
  pendingTasks?: PendingTaskSummary[];
  lastIncidentAt?: string | null;
  recentIncidentFlag?: boolean;
};

export const PATIENTS_MOCK: PatientListItem[] = [
  {
    id: 'pat-002',
    name: 'María López',
    unitId: 'icu-b',
    bedLabel: 'B2',
    vitals: { rr: 21, spo2: 95, tempC: 38.5, sbp: 108, hr: 98, o2: false, avpu: 'A' },
    devices: [{ id: 'dev-cvc', label: 'Catéter venoso central', category: 'invasive' }],
    risks: { fall: true },
    pendingTasks: [{ id: 'task-2', title: 'Ajuste de perfusión', critical: true }],
  },
  {
    id: 'pat-001',
    name: 'Juan Pérez',
    unitId: 'icu-a',
    bedLabel: 'A1',
    vitals: { rr: 28, spo2: 90, tempC: 39.2, sbp: 88, hr: 135, o2: true, avpu: 'V' },
    devices: [{ id: 'dev-vent', label: 'Ventilación mecánica', category: 'invasive', critical: true }],
    risks: { isolation: true },
    pendingTasks: [{ id: 'task-1', title: 'Gasometría urgente', urgent: true }],
    recentIncidentFlag: true,
  },
  {
    id: 'pat-003',
    name: 'Laura Torres',
    unitId: 'ed-main',
    bedLabel: 'E3',
    vitals: { rr: 20, spo2: 94, tempC: 37.0, sbp: 118, hr: 105, o2: false, avpu: 'A' },
    pendingTasks: [{ id: 'task-3', title: 'Analítica en curso', urgent: false }],
  },
  {
    id: 'pat-004',
    name: 'Carlos Ruiz',
    unitId: 'ed-obs',
    bedLabel: 'E4',
    vitals: { rr: 16, spo2: 97, tempC: 36.8, sbp: 120, hr: 82, o2: false, avpu: 'A' },
    risks: { pressureUlcer: false },
    pendingTasks: [],
  },
  { id: 'pat-005', name: 'Ana Rivas', unitId: 'onc-ward', vitals: { rr: 18, spo2: 96, tempC: 37.1, sbp: 118, hr: 88 } },
  { id: 'pat-006', name: 'Miguel Soto', unitId: 'neph-hd', vitals: { rr: 19, spo2: 95, tempC: 36.9, sbp: 115, hr: 90 } },
  { id: 'pat-007', name: 'Sofía Álvarez', unitId: 'ped-ward', vitals: { rr: 22, spo2: 97, tempC: 37.2, sbp: 110, hr: 100 } },
  { id: 'pat-008', name: 'Paula Fernández', unitId: 'ob-labor', vitals: { rr: 18, spo2: 98, tempC: 37.3, sbp: 112, hr: 88 } },
  { id: 'pat-009', name: 'Raúl Herrera', unitId: 'neuroicu-1', vitals: { rr: 19, spo2: 95, tempC: 37.0, sbp: 118, hr: 92 } },
  { id: 'pat-010', name: 'Lucía Romero', unitId: 'cvicu-1', vitals: { rr: 17, spo2: 99, tempC: 36.9, sbp: 116, hr: 80 } },
];
