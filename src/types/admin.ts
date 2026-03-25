export type IceaOperationalState = 'healthy' | 'degraded' | 'backlog' | 'stale' | 'failed';

export interface IceaOpsLatencySummary {
  count: number;
  avgMs: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  lastMeasuredAt: string | null;
}

export interface IceaOpsErrorSummary {
  source: 'outbox' | 'bridge' | 'pipeline' | string;
  errorFamily: string;
  count: number;
  lastSeenAt: string | null;
}

export interface IceaOpsEventSummary {
  eventId: string;
  source: 'outbox' | 'bridge' | 'pipeline' | string;
  requestId: string | null;
  bundleId: string | null;
  unitId: string | null;
  payloadHash: string | null;
  status: string;
  statusFamily: string | null;
  errorFamily: string | null;
  attempts?: number;
  httpStatus: number | null;
  latencyMs: number | null;
  nextRetryAt?: string | null;
  stage?: string | null;
  action?: string | null;
  scoringMode?: string | null;
  provisional?: boolean;
  insufficientEvidence?: boolean;
  detail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IceaOpsFreshnessSummary {
  lastOutboundAttemptAt: string | null;
  lastOutboundDeliveredAt: string | null;
  lastBridgeUpdatedAt: string | null;
  lastBridgeReceivedAt: string | null;
  lastPipelineEventAt: string | null;
}

export interface IceaOpsOutboxCounts {
  total: number;
  queued: number;
  retry: number;
  delivered: number;
  failed: number;
  retries: number;
}

export interface IceaOpsBridgeCounts {
  total: number;
  queued: number;
  sent: number;
  accepted: number;
  pending: number;
  scored: number;
  failed: number;
  stale: number;
  retries: number;
  provisional: number;
  immediate: number;
  enriched: number;
  insufficientEvidence: number;
}

export interface IceaOpsPipelineCounts {
  snapshots: number;
  running: number;
  retry: number;
  failed: number;
  events: number;
}

export interface IceaOpsShiftSummary {
  shift: string;
  state: IceaOperationalState;
  pendingCount: number;
  lastUpdatedAt: string | null;
}

export interface IceaOpsUnitSummary {
  unitId: string;
  available: boolean;
  state: IceaOperationalState;
  lastUpdatedAt: string | null;
  pendingCount: number;
  unavailableReason?: string;
  freshness: IceaOpsFreshnessSummary;
  counts: {
    handoversExported: number;
    outbox: IceaOpsOutboxCounts;
    bridge: IceaOpsBridgeCounts;
    pipeline: IceaOpsPipelineCounts;
  };
  latencies: {
    outboxDelivery: IceaOpsLatencySummary;
    bridgeResponse: IceaOpsLatencySummary;
  };
  errors: IceaOpsErrorSummary[];
  shifts: IceaOpsShiftSummary[];
}

export interface IceaOpsUnitDetail extends IceaOpsUnitSummary {
  generatedAt: string;
  enabled: boolean;
  scope: 'unit' | string;
  recentEvents: IceaOpsEventSummary[];
}

export interface IceaOpsSummary {
  generatedAt: string;
  available: boolean;
  enabled: boolean;
  scope: 'summary' | string;
  empty?: boolean;
  state?: IceaOperationalState;
  lastUpdatedAt?: string | null;
  pendingCount?: number;
  unavailableReason?: string;
  flags: {
    summaryEnabled: boolean;
    eventsEnabled: boolean;
    bridgeEnabled: boolean;
    bridgeStatusEnabled?: boolean;
    remoteActionsEnabled?: boolean;
    remoteStatusEnabled?: boolean;
    outboxEnabled?: boolean;
  };
  freshness?: IceaOpsFreshnessSummary;
  counts?: {
    handoversExported: number;
    outbox: IceaOpsOutboxCounts;
    bridge: IceaOpsBridgeCounts;
    pipeline: IceaOpsPipelineCounts;
  };
  latencies?: {
    outboxDelivery: IceaOpsLatencySummary;
    bridgeResponse: IceaOpsLatencySummary;
  };
  errors?: IceaOpsErrorSummary[];
  units: IceaOpsUnitSummary[];
}

export interface IceaOpsEventsResponse {
  generatedAt: string;
  available: boolean;
  enabled: boolean;
  scope: 'events' | string;
  unitId?: string | null;
  count: number;
  results: IceaOpsEventSummary[];
  unavailableReason?: string;
}

export interface IceaOpsDashboardData {
  summary: IceaOpsSummary;
  unit: IceaOpsUnitDetail | null;
  events: IceaOpsEventSummary[];
}
