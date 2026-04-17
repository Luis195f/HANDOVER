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
