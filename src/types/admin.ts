export interface IceaDashboardUnitSummary {
  unitId: string;
  totalHandovers: number;
  accepted: number;
  queued: number;
  running: number;
  delivered: number;
  succeeded: number;
  retry: number;
  failed: number;
  lastUpdatedAt: string | null;
  lastDashboardRefreshAt: string | null;
  cachedSummary?: Record<string, unknown> | null;
}

export interface IceaPipelineEventSummary {
  id: number;
  requestId: string | null;
  bundleId: string | null;
  patientId: string | null;
  unitId: string | null;
  stage: string;
  action: string | null;
  status: string;
  source: string | null;
  actorSub: string | null;
  detail: string | null;
  httpStatus: number | null;
  payload?: Record<string, unknown> | null;
  createdAt: string;
}

export interface IceaDashboardSummary {
  generatedAt: string;
  units: IceaDashboardUnitSummary[];
  recentEvents: IceaPipelineEventSummary[];
}

export interface UnitSummary {
  unitId: string;
  unitName: string;
  totalHandovers: number;
  completedHandovers: number;
  pendingHandovers: number;
  criticalPatients: number;
}

export interface StaffActivity {
  staffId: string;
  name: string;
  role: 'nurse' | 'supervisor' | 'admin' | 'other';
  unitId: string;
  handoversCompleted: number;
  handoversReceived: number;
  lastHandoverAt: string | null;
}

export type AlertType = 'NEWS2_HIGH' | 'PENDING_CRITICAL_TASKS' | 'INCIDENT_REPORTED';

export interface AlertSummary {
  id: string;
  unitId: string;
  patientId: string;
  patientDisplay?: string;
  type: AlertType;
  message: string;
  createdAt: string;
}
