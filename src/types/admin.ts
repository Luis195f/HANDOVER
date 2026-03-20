import type { DeviceSummary, PendingTaskSummary, RiskFlags, VitalsSnapshot } from '@/src/types/handover';

export interface IceaDashboardTimingSummary {
  unitId: string;
  sectionId: string;
  avgDurationMs: number;
  samples: number;
}

export interface IceaDashboardClinicalPatient {
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
}

export interface IceaDashboardOperationalActivity {
  status: 'degraded' | 'attention' | 'active' | 'nominal' | 'empty' | string;
  handoversLast24h: number;
  eventsLast24h: number;
  activePipeline: number;
  lastActivityAt: string | null;
}

export interface IceaDashboardOutboxUnitSummary {
  total: number;
  queued: number;
  retry: number;
  delivered: number;
  failed: number;
  lastAttemptAt: string | null;
  lastDeliveredAt: string | null;
}

export interface IceaDashboardBridgeUnitSummary {
  total: number;
  queued: number;
  sent: number;
  accepted: number;
  pending: number;
  scored: number;
  failed: number;
  stale: number;
  provisional: number;
  insufficientEvidence: number;
  lastUpdatedAt: string | null;
}

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
  activity: IceaDashboardOperationalActivity;
  outbox: IceaDashboardOutboxUnitSummary;
  bridge: IceaDashboardBridgeUnitSummary;
  clinicalPatients: IceaDashboardClinicalPatient[];
  handoverTiming: IceaDashboardTimingSummary[];
  alertsOpen: number;
  degraded: boolean;
  degradationReasons: string[];
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

export interface IceaDashboardAlert {
  id: string;
  unitId: string | null;
  source: 'outbox' | 'bridge' | 'pipeline' | string;
  severity: 'high' | 'medium' | 'low' | string;
  status: string;
  title: string;
  message: string;
  requestId: string | null;
  createdAt: string;
}

export interface IceaDashboardOutboxSummary {
  enabled: boolean;
  configured: boolean;
  totals: {
    queued: number;
    retry: number;
    delivered: number;
    failed: number;
  };
  lastAttemptAt: string | null;
  lastDeliveredAt: string | null;
}

export interface IceaDashboardPipelineSummary {
  configured: boolean;
  remoteActionsEnabled: boolean;
  remoteStatusEnabled: boolean;
  bridgeEnabled: boolean;
  bridgeConfigured: boolean;
  snapshots: number;
  running: number;
  retry: number;
  failed: number;
  bridge: {
    queued: number;
    sent: number;
    accepted: number;
    pending: number;
    scored: number;
    failed: number;
    stale: number;
    provisional: number;
    insufficientEvidence: number;
  };
  lastEventAt: string | null;
  degradationReasons: string[];
}

export interface IceaDashboardSummary {
  generatedAt: string;
  source: 'live' | 'demo' | string;
  demoMode: boolean;
  empty: boolean;
  stale: boolean;
  degraded: boolean;
  degradationReasons: string[];
  latestActivityAt: string | null;
  units: IceaDashboardUnitSummary[];
  alerts: IceaDashboardAlert[];
  outbox: IceaDashboardOutboxSummary;
  pipeline: IceaDashboardPipelineSummary;
  recentEvents: IceaPipelineEventSummary[];
}
