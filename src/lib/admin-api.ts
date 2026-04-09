import { ApiClientError, apiGet, apiPost } from '@/src/lib/api';
import { buildDemoAdminDashboardSummary } from '@/src/mock/admin/dashboard-fixture';
import type {
  ClinicalDecisionGovernanceDecisionCounts,
  ClinicalDecisionGovernanceFilters,
  ClinicalDecisionGovernanceSectionRow,
  ClinicalDecisionGovernanceSourceRow,
  ClinicalDecisionGovernanceSummary,
  ClinicalDecisionGovernanceTimelineRow,
  ClinicalDecisionGovernanceUnitRow,
  IceaOpsDashboardData,
  IceaOpsEventSummary,
  IceaOpsEventsResponse,
  IceaOpsSummary,
  IceaOpsUnitDetail,
  IceaOpsUnitSummary,
} from '@/src/types/admin';

export interface AdminDashboardData extends IceaOpsDashboardData {
  clinicalDecisionSummary?: ClinicalDecisionGovernanceSummary | null;
}

export interface AdminDashboardRequestOptions {
  demoMode?: boolean;
  includeClinicalDecisionSummary?: boolean;
  clinicalDecisionFilters?: Partial<ClinicalDecisionGovernanceFilters>;
}

export class AdminDashboardApiError extends Error {
  code: 'forbidden' | 'remote' | 'network' | 'invalid_payload';
  status: number | null;
  details: string;

  constructor(code: AdminDashboardApiError['code'], message: string, options?: { status?: number | null; details?: string }) {
    super(message);
    this.name = 'AdminDashboardApiError';
    this.code = code;
    this.status = options?.status ?? null;
    this.details = options?.details ?? '';
  }
}

function normalizeLatency(payload: unknown) {
  return {
    count: typeof (payload as { count?: unknown })?.count === 'number' ? (payload as { count: number }).count : 0,
    avgMs: typeof (payload as { avgMs?: unknown })?.avgMs === 'number' ? (payload as { avgMs: number }).avgMs : null,
    p95Ms: typeof (payload as { p95Ms?: unknown })?.p95Ms === 'number' ? (payload as { p95Ms: number }).p95Ms : null,
    maxMs: typeof (payload as { maxMs?: unknown })?.maxMs === 'number' ? (payload as { maxMs: number }).maxMs : null,
    lastMeasuredAt:
      typeof (payload as { lastMeasuredAt?: unknown })?.lastMeasuredAt === 'string'
        ? (payload as { lastMeasuredAt: string }).lastMeasuredAt
        : null,
  };
}

function normalizeFreshness(payload: unknown) {
  return {
    lastOutboundAttemptAt:
      typeof (payload as { lastOutboundAttemptAt?: unknown })?.lastOutboundAttemptAt === 'string'
        ? (payload as { lastOutboundAttemptAt: string }).lastOutboundAttemptAt
        : null,
    lastOutboundDeliveredAt:
      typeof (payload as { lastOutboundDeliveredAt?: unknown })?.lastOutboundDeliveredAt === 'string'
        ? (payload as { lastOutboundDeliveredAt: string }).lastOutboundDeliveredAt
        : null,
    lastBridgeUpdatedAt:
      typeof (payload as { lastBridgeUpdatedAt?: unknown })?.lastBridgeUpdatedAt === 'string'
        ? (payload as { lastBridgeUpdatedAt: string }).lastBridgeUpdatedAt
        : null,
    lastBridgeReceivedAt:
      typeof (payload as { lastBridgeReceivedAt?: unknown })?.lastBridgeReceivedAt === 'string'
        ? (payload as { lastBridgeReceivedAt: string }).lastBridgeReceivedAt
        : null,
    lastPipelineEventAt:
      typeof (payload as { lastPipelineEventAt?: unknown })?.lastPipelineEventAt === 'string'
        ? (payload as { lastPipelineEventAt: string }).lastPipelineEventAt
        : null,
  };
}

function normalizeErrors(payload: unknown) {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      return {
        source: typeof (item as { source?: unknown }).source === 'string' ? (item as { source: string }).source : 'pipeline',
        errorFamily:
          typeof (item as { errorFamily?: unknown }).errorFamily === 'string'
            ? (item as { errorFamily: string }).errorFamily
            : 'remote_error',
        count: typeof (item as { count?: unknown }).count === 'number' ? (item as { count: number }).count : 0,
        lastSeenAt:
          typeof (item as { lastSeenAt?: unknown }).lastSeenAt === 'string' ? (item as { lastSeenAt: string }).lastSeenAt : null,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

function normalizeEvents(payload: unknown): IceaOpsEventSummary[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((item): IceaOpsEventSummary[] => {
    if (!item || typeof item !== 'object') return [];
    return [
      {
        eventId: typeof (item as { eventId?: unknown }).eventId === 'string' ? (item as { eventId: string }).eventId : '',
        source: typeof (item as { source?: unknown }).source === 'string' ? (item as { source: string }).source : 'pipeline',
        requestId:
          typeof (item as { requestId?: unknown }).requestId === 'string' ? (item as { requestId: string }).requestId : null,
        bundleId:
          typeof (item as { bundleId?: unknown }).bundleId === 'string' ? (item as { bundleId: string }).bundleId : null,
        unitId: typeof (item as { unitId?: unknown }).unitId === 'string' ? (item as { unitId: string }).unitId : null,
        payloadHash:
          typeof (item as { payloadHash?: unknown }).payloadHash === 'string'
            ? (item as { payloadHash: string }).payloadHash
            : null,
        status: typeof (item as { status?: unknown }).status === 'string' ? (item as { status: string }).status : '',
        statusFamily:
          typeof (item as { statusFamily?: unknown }).statusFamily === 'string'
            ? (item as { statusFamily: string }).statusFamily
            : null,
        errorFamily:
          typeof (item as { errorFamily?: unknown }).errorFamily === 'string'
            ? (item as { errorFamily: string }).errorFamily
            : null,
        attempts: typeof (item as { attempts?: unknown }).attempts === 'number' ? (item as { attempts: number }).attempts : undefined,
        httpStatus:
          typeof (item as { httpStatus?: unknown }).httpStatus === 'number'
            ? (item as { httpStatus: number }).httpStatus
            : null,
        latencyMs:
          typeof (item as { latencyMs?: unknown }).latencyMs === 'number' ? (item as { latencyMs: number }).latencyMs : null,
        nextRetryAt:
          typeof (item as { nextRetryAt?: unknown }).nextRetryAt === 'string'
            ? (item as { nextRetryAt: string }).nextRetryAt
            : null,
        stage: typeof (item as { stage?: unknown }).stage === 'string' ? (item as { stage: string }).stage : null,
        action: typeof (item as { action?: unknown }).action === 'string' ? (item as { action: string }).action : null,
        scoringMode:
          typeof (item as { scoringMode?: unknown }).scoringMode === 'string'
            ? (item as { scoringMode: string }).scoringMode
            : null,
        provisional:
          typeof (item as { provisional?: unknown }).provisional === 'boolean'
            ? (item as { provisional: boolean }).provisional
            : undefined,
        insufficientEvidence:
          typeof (item as { insufficientEvidence?: unknown }).insufficientEvidence === 'boolean'
            ? (item as { insufficientEvidence: boolean }).insufficientEvidence
            : undefined,
        detail: typeof (item as { detail?: unknown }).detail === 'string' ? (item as { detail: string }).detail : null,
        createdAt: typeof (item as { createdAt?: unknown }).createdAt === 'string' ? (item as { createdAt: string }).createdAt : '',
        updatedAt: typeof (item as { updatedAt?: unknown }).updatedAt === 'string' ? (item as { updatedAt: string }).updatedAt : '',
      },
    ];
  });
}

function normalizeUnitSummary(payload: unknown): IceaOpsUnitSummary {
  const available = typeof (payload as { available?: unknown })?.available === 'boolean' ? (payload as { available: boolean }).available : false;
  const unavailableReason =
    typeof (payload as { unavailableReason?: unknown })?.unavailableReason === 'string'
      ? (payload as { unavailableReason: string }).unavailableReason
      : undefined;
  return {
    unitId: typeof (payload as { unitId?: unknown })?.unitId === 'string' ? (payload as { unitId: string }).unitId : '',
    available,
    state:
      typeof (payload as { state?: unknown })?.state === 'string'
        ? (payload as { state: IceaOpsUnitSummary['state'] }).state
        : available
          ? 'healthy'
          : 'degraded',
    lastUpdatedAt:
      typeof (payload as { lastUpdatedAt?: unknown })?.lastUpdatedAt === 'string'
        ? (payload as { lastUpdatedAt: string }).lastUpdatedAt
        : null,
    pendingCount:
      typeof (payload as { pendingCount?: unknown })?.pendingCount === 'number'
        ? (payload as { pendingCount: number }).pendingCount
        : 0,
    unavailableReason,
    freshness: normalizeFreshness((payload as { freshness?: unknown })?.freshness),
    counts: {
      handoversExported:
        typeof (payload as { counts?: { handoversExported?: unknown } })?.counts?.handoversExported === 'number'
          ? (payload as { counts: { handoversExported: number } }).counts.handoversExported
          : 0,
      outbox: {
        total: typeof (payload as { counts?: { outbox?: { total?: unknown } } })?.counts?.outbox?.total === 'number' ? (payload as { counts: { outbox: { total: number } } }).counts.outbox.total : 0,
        queued: typeof (payload as { counts?: { outbox?: { queued?: unknown } } })?.counts?.outbox?.queued === 'number' ? (payload as { counts: { outbox: { queued: number } } }).counts.outbox.queued : 0,
        retry: typeof (payload as { counts?: { outbox?: { retry?: unknown } } })?.counts?.outbox?.retry === 'number' ? (payload as { counts: { outbox: { retry: number } } }).counts.outbox.retry : 0,
        delivered: typeof (payload as { counts?: { outbox?: { delivered?: unknown } } })?.counts?.outbox?.delivered === 'number' ? (payload as { counts: { outbox: { delivered: number } } }).counts.outbox.delivered : 0,
        failed: typeof (payload as { counts?: { outbox?: { failed?: unknown } } })?.counts?.outbox?.failed === 'number' ? (payload as { counts: { outbox: { failed: number } } }).counts.outbox.failed : 0,
        retries: typeof (payload as { counts?: { outbox?: { retries?: unknown } } })?.counts?.outbox?.retries === 'number' ? (payload as { counts: { outbox: { retries: number } } }).counts.outbox.retries : 0,
      },
      bridge: {
        total: typeof (payload as { counts?: { bridge?: { total?: unknown } } })?.counts?.bridge?.total === 'number' ? (payload as { counts: { bridge: { total: number } } }).counts.bridge.total : 0,
        queued: typeof (payload as { counts?: { bridge?: { queued?: unknown } } })?.counts?.bridge?.queued === 'number' ? (payload as { counts: { bridge: { queued: number } } }).counts.bridge.queued : 0,
        sent: typeof (payload as { counts?: { bridge?: { sent?: unknown } } })?.counts?.bridge?.sent === 'number' ? (payload as { counts: { bridge: { sent: number } } }).counts.bridge.sent : 0,
        accepted: typeof (payload as { counts?: { bridge?: { accepted?: unknown } } })?.counts?.bridge?.accepted === 'number' ? (payload as { counts: { bridge: { accepted: number } } }).counts.bridge.accepted : 0,
        pending: typeof (payload as { counts?: { bridge?: { pending?: unknown } } })?.counts?.bridge?.pending === 'number' ? (payload as { counts: { bridge: { pending: number } } }).counts.bridge.pending : 0,
        scored: typeof (payload as { counts?: { bridge?: { scored?: unknown } } })?.counts?.bridge?.scored === 'number' ? (payload as { counts: { bridge: { scored: number } } }).counts.bridge.scored : 0,
        failed: typeof (payload as { counts?: { bridge?: { failed?: unknown } } })?.counts?.bridge?.failed === 'number' ? (payload as { counts: { bridge: { failed: number } } }).counts.bridge.failed : 0,
        stale: typeof (payload as { counts?: { bridge?: { stale?: unknown } } })?.counts?.bridge?.stale === 'number' ? (payload as { counts: { bridge: { stale: number } } }).counts.bridge.stale : 0,
        retries: typeof (payload as { counts?: { bridge?: { retries?: unknown } } })?.counts?.bridge?.retries === 'number' ? (payload as { counts: { bridge: { retries: number } } }).counts.bridge.retries : 0,
        provisional:
          typeof (payload as { counts?: { bridge?: { provisional?: unknown } } })?.counts?.bridge?.provisional === 'number'
            ? (payload as { counts: { bridge: { provisional: number } } }).counts.bridge.provisional
            : 0,
        immediate:
          typeof (payload as { counts?: { bridge?: { immediate?: unknown } } })?.counts?.bridge?.immediate === 'number'
            ? (payload as { counts: { bridge: { immediate: number } } }).counts.bridge.immediate
            : 0,
        enriched:
          typeof (payload as { counts?: { bridge?: { enriched?: unknown } } })?.counts?.bridge?.enriched === 'number'
            ? (payload as { counts: { bridge: { enriched: number } } }).counts.bridge.enriched
            : 0,
        insufficientEvidence:
          typeof (payload as { counts?: { bridge?: { insufficientEvidence?: unknown } } })?.counts?.bridge?.insufficientEvidence === 'number'
            ? (payload as { counts: { bridge: { insufficientEvidence: number } } }).counts.bridge.insufficientEvidence
            : 0,
      },
      pipeline: {
        snapshots:
          typeof (payload as { counts?: { pipeline?: { snapshots?: unknown } } })?.counts?.pipeline?.snapshots === 'number'
            ? (payload as { counts: { pipeline: { snapshots: number } } }).counts.pipeline.snapshots
            : 0,
        running:
          typeof (payload as { counts?: { pipeline?: { running?: unknown } } })?.counts?.pipeline?.running === 'number'
            ? (payload as { counts: { pipeline: { running: number } } }).counts.pipeline.running
            : 0,
        retry:
          typeof (payload as { counts?: { pipeline?: { retry?: unknown } } })?.counts?.pipeline?.retry === 'number'
            ? (payload as { counts: { pipeline: { retry: number } } }).counts.pipeline.retry
            : 0,
        failed:
          typeof (payload as { counts?: { pipeline?: { failed?: unknown } } })?.counts?.pipeline?.failed === 'number'
            ? (payload as { counts: { pipeline: { failed: number } } }).counts.pipeline.failed
            : 0,
        events:
          typeof (payload as { counts?: { pipeline?: { events?: unknown } } })?.counts?.pipeline?.events === 'number'
            ? (payload as { counts: { pipeline: { events: number } } }).counts.pipeline.events
            : 0,
      },
    },
    latencies: {
      outboxDelivery: normalizeLatency((payload as { latencies?: { outboxDelivery?: unknown } })?.latencies?.outboxDelivery),
      bridgeResponse: normalizeLatency((payload as { latencies?: { bridgeResponse?: unknown } })?.latencies?.bridgeResponse),
    },
    errors: normalizeErrors((payload as { errors?: unknown }).errors),
    shifts: Array.isArray((payload as { shifts?: unknown }).shifts)
      ? ((payload as { shifts: unknown[] }).shifts ?? [])
          .map((item) => {
            if (!item || typeof item !== 'object') return null;
            return {
              shift: typeof (item as { shift?: unknown }).shift === 'string' ? (item as { shift: string }).shift : '',
              state: typeof (item as { state?: unknown }).state === 'string' ? (item as { state: IceaOpsUnitSummary['state'] }).state : 'healthy',
              pendingCount:
                typeof (item as { pendingCount?: unknown }).pendingCount === 'number'
                  ? (item as { pendingCount: number }).pendingCount
                  : 0,
              lastUpdatedAt:
                typeof (item as { lastUpdatedAt?: unknown }).lastUpdatedAt === 'string'
                  ? (item as { lastUpdatedAt: string }).lastUpdatedAt
                  : null,
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null)
      : [],
  };
}

function normalizeSummary(payload: Partial<IceaOpsSummary> | null | undefined): IceaOpsSummary {
  return {
    generatedAt: typeof payload?.generatedAt === 'string' ? payload.generatedAt : '',
    available: Boolean(payload?.available),
    enabled: Boolean(payload?.enabled),
    scope: typeof payload?.scope === 'string' ? payload.scope : 'summary',
    empty: Boolean(payload?.empty),
    state: typeof payload?.state === 'string' ? payload.state : undefined,
    lastUpdatedAt: typeof payload?.lastUpdatedAt === 'string' ? payload.lastUpdatedAt : null,
    pendingCount: typeof payload?.pendingCount === 'number' ? payload.pendingCount : 0,
    unavailableReason: typeof payload?.unavailableReason === 'string' ? payload.unavailableReason : undefined,
    flags: {
      summaryEnabled: Boolean(payload?.flags?.summaryEnabled),
      eventsEnabled: Boolean(payload?.flags?.eventsEnabled),
      bridgeEnabled: Boolean(payload?.flags?.bridgeEnabled),
      bridgeStatusEnabled: Boolean(payload?.flags?.bridgeStatusEnabled),
      remoteActionsEnabled: Boolean(payload?.flags?.remoteActionsEnabled),
      remoteStatusEnabled: Boolean(payload?.flags?.remoteStatusEnabled),
      outboxEnabled: Boolean(payload?.flags?.outboxEnabled),
    },
    freshness: normalizeFreshness(payload?.freshness),
    counts: {
      handoversExported: typeof payload?.counts?.handoversExported === 'number' ? payload.counts.handoversExported : 0,
      outbox: normalizeUnitSummary({ counts: { outbox: payload?.counts?.outbox ?? {} } }).counts.outbox,
      bridge: normalizeUnitSummary({ counts: { bridge: payload?.counts?.bridge ?? {} } }).counts.bridge,
      pipeline: normalizeUnitSummary({ counts: { pipeline: payload?.counts?.pipeline ?? {} } }).counts.pipeline,
    },
    latencies: {
      outboxDelivery: normalizeLatency(payload?.latencies?.outboxDelivery),
      bridgeResponse: normalizeLatency(payload?.latencies?.bridgeResponse),
    },
    errors: normalizeErrors(payload?.errors),
    units: Array.isArray(payload?.units) ? payload.units.map((item) => normalizeUnitSummary(item)) : [],
  };
}

function normalizeUnit(payload: Partial<IceaOpsUnitDetail> | null | undefined): IceaOpsUnitDetail | null {
  if (!payload || typeof payload !== 'object') return null;
  return {
    ...normalizeUnitSummary(payload),
    generatedAt: typeof payload.generatedAt === 'string' ? payload.generatedAt : '',
    enabled: Boolean(payload.enabled),
    scope: typeof payload.scope === 'string' ? payload.scope : 'unit',
    recentEvents: normalizeEvents(payload.recentEvents),
  };
}

function hasFlags(payload: unknown): boolean {
  return Boolean(payload && typeof payload === 'object' && 'flags' in payload && typeof (payload as { flags?: unknown }).flags === 'object');
}

function isIntentionalUnavailable(payload: unknown): boolean {
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      (payload as { available?: unknown }).available === false &&
      (payload as { enabled?: unknown }).enabled === false &&
      typeof (payload as { unavailableReason?: unknown }).unavailableReason === 'string',
  );
}

function isSummaryLike(payload: unknown): payload is Partial<IceaOpsSummary> {
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      hasFlags(payload) &&
      Array.isArray((payload as { units?: unknown }).units) &&
      Array.isArray((payload as { errors?: unknown }).errors) &&
      (!isIntentionalUnavailable(payload) || (payload as { scope?: unknown }).scope === 'summary'),
  );
}

function isEventsLike(payload: unknown): payload is Partial<IceaOpsEventsResponse> {
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      Array.isArray((payload as { results?: unknown }).results) &&
      (!isIntentionalUnavailable(payload) || (payload as { scope?: unknown }).scope === 'events'),
  );
}

function mapApiError(error: unknown): AdminDashboardApiError {
  if (error instanceof AdminDashboardApiError) return error;
  if (error instanceof ApiClientError) {
    if (error.status === 401 || error.status === 403) {
      return new AdminDashboardApiError('forbidden', 'No tienes permisos para ver la observabilidad operativa.', {
        status: error.status,
        details: error.details,
      });
    }
    return new AdminDashboardApiError('remote', 'El backend devolvio un error al cargar la observabilidad operativa.', {
      status: error.status,
      details: error.details,
    });
  }
  return new AdminDashboardApiError('network', 'No se pudo conectar con el backend de observabilidad.');
}

function demoDashboardData(): IceaOpsDashboardData {
  return buildDemoAdminDashboardSummary();
}

function normalizeDecisionCounts(payload: unknown): ClinicalDecisionGovernanceDecisionCounts {
  return {
    shown:
      typeof (payload as { shown?: unknown })?.shown === 'number' ? (payload as { shown: number }).shown : 0,
    accepted:
      typeof (payload as { accepted?: unknown })?.accepted === 'number' ? (payload as { accepted: number }).accepted : 0,
    applied:
      typeof (payload as { applied?: unknown })?.applied === 'number' ? (payload as { applied: number }).applied : 0,
    rejected:
      typeof (payload as { rejected?: unknown })?.rejected === 'number' ? (payload as { rejected: number }).rejected : 0,
    dismissed:
      typeof (payload as { dismissed?: unknown })?.dismissed === 'number'
        ? (payload as { dismissed: number }).dismissed
        : 0,
  };
}

function normalizeClinicalDecisionUnitRows(payload: unknown): ClinicalDecisionGovernanceUnitRow[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((item): ClinicalDecisionGovernanceUnitRow[] => {
    if (!item || typeof item !== 'object') return [];
    const unitId = typeof (item as { unitId?: unknown }).unitId === 'string' ? (item as { unitId: string }).unitId : '';
    if (!unitId) return [];
    return [
      {
        unitId,
        count: typeof (item as { count?: unknown }).count === 'number' ? (item as { count: number }).count : 0,
      },
    ];
  });
}

function normalizeClinicalDecisionSourceRows(payload: unknown): ClinicalDecisionGovernanceSourceRow[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((item): ClinicalDecisionGovernanceSourceRow[] => {
    if (!item || typeof item !== 'object') return [];
    const suggestionSource =
      typeof (item as { suggestionSource?: unknown }).suggestionSource === 'string'
        ? (item as { suggestionSource: string }).suggestionSource
        : '';
    if (!suggestionSource) return [];
    return [
      {
        suggestionSource,
        count: typeof (item as { count?: unknown }).count === 'number' ? (item as { count: number }).count : 0,
        decisions: normalizeDecisionCounts((item as { decisions?: unknown }).decisions),
      },
    ];
  });
}

function normalizeClinicalDecisionSectionRows(payload: unknown): ClinicalDecisionGovernanceSectionRow[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((item): ClinicalDecisionGovernanceSectionRow[] => {
    if (!item || typeof item !== 'object') return [];
    const section = typeof (item as { section?: unknown }).section === 'string' ? (item as { section: string }).section : '';
    if (!section) return [];
    return [
      {
        section,
        count: typeof (item as { count?: unknown }).count === 'number' ? (item as { count: number }).count : 0,
        decisions: normalizeDecisionCounts((item as { decisions?: unknown }).decisions),
      },
    ];
  });
}

function normalizeClinicalDecisionTimelineRows(payload: unknown): ClinicalDecisionGovernanceTimelineRow[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((item): ClinicalDecisionGovernanceTimelineRow[] => {
    if (!item || typeof item !== 'object') return [];
    const date = typeof (item as { date?: unknown }).date === 'string' ? (item as { date: string }).date : '';
    if (!date) return [];
    return [
      {
        date,
        count: typeof (item as { count?: unknown }).count === 'number' ? (item as { count: number }).count : 0,
        decisions: normalizeDecisionCounts((item as { decisions?: unknown }).decisions),
      },
    ];
  });
}

function normalizeClinicalDecisionSummary(payload: unknown): ClinicalDecisionGovernanceSummary | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.generatedAt !== 'string') return null;
  if (typeof candidate.available !== 'boolean' || typeof candidate.enabled !== 'boolean') return null;
  if (!candidate.filters || typeof candidate.filters !== 'object') return null;
  if (!candidate.totals || typeof candidate.totals !== 'object') return null;
  if (!candidate.feature || typeof candidate.feature !== 'object') return null;
  if (!Array.isArray(candidate.byDecision) || !Array.isArray(candidate.byUnit)) return null;
  if (!Array.isArray(candidate.bySuggestionSource) || !Array.isArray(candidate.bySection) || !Array.isArray(candidate.timeline)) return null;

  return {
    generatedAt: candidate.generatedAt,
    available: candidate.available,
    enabled: candidate.enabled,
    scope: typeof candidate.scope === 'string' ? candidate.scope : 'clinical_decisions_summary',
    filters: {
      unitId: typeof (candidate.filters as { unitId?: unknown }).unitId === 'string' ? ((candidate.filters as { unitId: string }).unitId || null) : null,
      suggestionSource:
        typeof (candidate.filters as { suggestionSource?: unknown }).suggestionSource === 'string'
          ? (((candidate.filters as { suggestionSource: string }).suggestionSource || null) as ClinicalDecisionGovernanceFilters['suggestionSource'])
          : null,
      decision:
        typeof (candidate.filters as { decision?: unknown }).decision === 'string'
          ? (((candidate.filters as { decision: string }).decision || null) as ClinicalDecisionGovernanceFilters['decision'])
          : null,
      section:
        typeof (candidate.filters as { section?: unknown }).section === 'string'
          ? (((candidate.filters as { section: string }).section || null) as ClinicalDecisionGovernanceFilters['section'])
          : null,
      dateFrom:
        typeof (candidate.filters as { dateFrom?: unknown }).dateFrom === 'string'
          ? ((candidate.filters as { dateFrom: string }).dateFrom || null)
          : null,
      dateTo:
        typeof (candidate.filters as { dateTo?: unknown }).dateTo === 'string'
          ? ((candidate.filters as { dateTo: string }).dateTo || null)
          : null,
    },
    queryBounds:
      candidate.queryBounds && typeof candidate.queryBounds === 'object'
        ? {
            createdAtGte:
              typeof (candidate.queryBounds as { createdAtGte?: unknown }).createdAtGte === 'string'
                ? ((candidate.queryBounds as { createdAtGte: string }).createdAtGte || null)
                : null,
            createdAtLt:
              typeof (candidate.queryBounds as { createdAtLt?: unknown }).createdAtLt === 'string'
                ? ((candidate.queryBounds as { createdAtLt: string }).createdAtLt || null)
                : null,
          }
        : undefined,
    empty: Boolean(candidate.empty),
    unavailableReason:
      typeof candidate.unavailableReason === 'string' ? candidate.unavailableReason : undefined,
    feature: {
      key: typeof (candidate.feature as { key?: unknown }).key === 'string' ? (candidate.feature as { key: string }).key : 'admin_analytics',
      mode: typeof (candidate.feature as { mode?: unknown }).mode === 'string' ? (candidate.feature as { mode: string }).mode : 'enabled',
      pilotMode:
        typeof (candidate.feature as { pilotMode?: unknown }).pilotMode === 'string'
          ? (candidate.feature as { pilotMode: string }).pilotMode
          : 'pilot',
      shadowMode:
        typeof (candidate.feature as { shadowMode?: unknown }).shadowMode === 'boolean'
          ? (candidate.feature as { shadowMode: boolean }).shadowMode
          : false,
    },
    totals: {
      events: typeof (candidate.totals as { events?: unknown }).events === 'number' ? (candidate.totals as { events: number }).events : 0,
      units: typeof (candidate.totals as { units?: unknown }).units === 'number' ? (candidate.totals as { units: number }).units : 0,
      suggestionSources:
        typeof (candidate.totals as { suggestionSources?: unknown }).suggestionSources === 'number'
          ? (candidate.totals as { suggestionSources: number }).suggestionSources
          : 0,
      sections:
        typeof (candidate.totals as { sections?: unknown }).sections === 'number'
          ? (candidate.totals as { sections: number }).sections
          : 0,
    },
    byDecision: (candidate.byDecision as unknown[]).flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const decision = typeof (item as { decision?: unknown }).decision === 'string' ? (item as { decision: string }).decision : '';
      if (!decision) return [];
      return [
        {
          decision: decision as ClinicalDecisionGovernanceSummary['byDecision'][number]['decision'],
          count: typeof (item as { count?: unknown }).count === 'number' ? (item as { count: number }).count : 0,
        },
      ];
    }),
    byUnit: normalizeClinicalDecisionUnitRows(candidate.byUnit),
    bySuggestionSource: normalizeClinicalDecisionSourceRows(candidate.bySuggestionSource),
    bySection: normalizeClinicalDecisionSectionRows(candidate.bySection),
    timeline: normalizeClinicalDecisionTimelineRows(candidate.timeline),
    limitations: Array.isArray(candidate.limitations)
      ? candidate.limitations.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

function buildClinicalDecisionSummaryQuery(filters?: Partial<ClinicalDecisionGovernanceFilters>): string {
  if (!filters) return '';
  const params = new URLSearchParams();
  if (filters.unitId?.trim()) params.set('unitId', filters.unitId.trim());
  if (filters.suggestionSource) params.set('suggestionSource', filters.suggestionSource);
  if (filters.decision) params.set('decision', filters.decision);
  if (filters.section) params.set('section', filters.section);
  if (filters.dateFrom?.trim()) params.set('dateFrom', filters.dateFrom.trim());
  if (filters.dateTo?.trim()) params.set('dateTo', filters.dateTo.trim());
  const serialized = params.toString();
  return serialized ? `?${serialized}` : '';
}

export async function fetchAdminDashboardData(unitId?: string, options?: AdminDashboardRequestOptions): Promise<AdminDashboardData> {
  try {
    const [summaryResponse, eventsResponse, unitResponse, clinicalDecisionSummaryResponse] = await Promise.all([
      apiGet('/api/icea/ops/summary') as Promise<Partial<IceaOpsSummary> | { mode?: string } | null | undefined>,
      apiGet(`/api/icea/ops/events${unitId ? `?unitId=${encodeURIComponent(unitId)}` : ''}`) as Promise<
        Partial<IceaOpsEventsResponse> | null | undefined
      >,
      unitId ? (apiGet(`/api/icea/ops/unit/${encodeURIComponent(unitId)}`) as Promise<Partial<IceaOpsUnitDetail> | null | undefined>) : Promise.resolve(null),
      options?.includeClinicalDecisionSummary
        ? (apiGet(`/api/clinical-decisions/summary${buildClinicalDecisionSummaryQuery(options.clinicalDecisionFilters)}`) as Promise<
            ClinicalDecisionGovernanceSummary | null | undefined
          >)
        : Promise.resolve(null),
    ]);

    if (options?.demoMode && typeof summaryResponse === 'object' && summaryResponse && (summaryResponse as { mode?: string }).mode === 'demo') {
      return demoDashboardData();
    }

    if (!isSummaryLike(summaryResponse) || !isEventsLike(eventsResponse)) {
      if (options?.demoMode) return demoDashboardData();
      throw new AdminDashboardApiError('invalid_payload', 'El backend devolvio un contrato ops invalido.');
    }

    const summary = normalizeSummary(summaryResponse);
    const unit = normalizeUnit(unitResponse);
    const events = normalizeEvents(eventsResponse.results);
    const clinicalDecisionSummary = options?.includeClinicalDecisionSummary
      ? normalizeClinicalDecisionSummary(clinicalDecisionSummaryResponse)
      : null;
    if (!summary.generatedAt && !options?.demoMode) {
      throw new AdminDashboardApiError('invalid_payload', 'El backend devolvio un contrato ops incompleto.');
    }
    if (options?.includeClinicalDecisionSummary && !clinicalDecisionSummary) {
      throw new AdminDashboardApiError('invalid_payload', 'El backend devolvio un contrato agregado invalido.');
    }
    return { summary, unit, events, clinicalDecisionSummary };
  } catch (error) {
    if (options?.demoMode) {
      return { ...demoDashboardData(), clinicalDecisionSummary: null };
    }
    throw mapApiError(error);
  }
}

export async function refreshIceaDashboardSummary(unitId: string, options?: AdminDashboardRequestOptions) {
  if (options?.demoMode) {
    return {
      action: 'refresh-dashboard-summary',
      result: {
        statusCode: 200,
        payload: {
          status: 'completed',
          summary: {
            unitId,
            generatedAt: demoDashboardData().summary.generatedAt,
          },
        },
      },
    };
  }
  try {
    return (await apiPost('/api/icea/actions/refresh-dashboard-summary', {
      body: JSON.stringify({ unitId }),
    })) as Promise<{
      action: string;
      result: { statusCode: number; payload?: Record<string, unknown> | null };
    }>;
  } catch (error) {
    throw mapApiError(error);
  }
}
