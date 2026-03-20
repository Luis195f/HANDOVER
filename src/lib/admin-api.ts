import { ApiClientError, apiGet, apiPost } from '@/src/lib/api';
import { buildDemoAdminDashboardSummary } from '@/src/mock/admin/dashboard-fixture';
import type {
  IceaDashboardAlert,
  IceaDashboardClinicalPatient,
  IceaDashboardBridgeUnitSummary,
  IceaDashboardOperationalActivity,
  IceaDashboardOutboxSummary,
  IceaDashboardOutboxUnitSummary,
  IceaDashboardPipelineSummary,
  IceaDashboardSummary,
  IceaDashboardTimingSummary,
  IceaDashboardUnitSummary,
  IceaPipelineEventSummary,
} from '@/src/types/admin';

export type AdminDashboardData = IceaDashboardSummary;

export interface AdminDashboardRequestOptions {
  demoMode?: boolean;
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

function normalizeTimingSummary(payload: unknown): IceaDashboardTimingSummary[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      return {
        unitId: typeof (item as { unitId?: unknown }).unitId === 'string' ? (item as { unitId: string }).unitId : '',
        sectionId: typeof (item as { sectionId?: unknown }).sectionId === 'string' ? (item as { sectionId: string }).sectionId : '',
        avgDurationMs: typeof (item as { avgDurationMs?: unknown }).avgDurationMs === 'number' ? (item as { avgDurationMs: number }).avgDurationMs : 0,
        samples: typeof (item as { samples?: unknown }).samples === 'number' ? (item as { samples: number }).samples : 0,
      };
    })
    .filter((item): item is IceaDashboardTimingSummary => item !== null);
}

function normalizeActivity(payload: unknown): IceaDashboardOperationalActivity {
  if (!payload || typeof payload !== 'object') {
    return {
      status: 'empty',
      handoversLast24h: 0,
      eventsLast24h: 0,
      activePipeline: 0,
      lastActivityAt: null,
    };
  }
  return {
    status: typeof (payload as { status?: unknown }).status === 'string' ? (payload as { status: string }).status : 'empty',
    handoversLast24h:
      typeof (payload as { handoversLast24h?: unknown }).handoversLast24h === 'number'
        ? (payload as { handoversLast24h: number }).handoversLast24h
        : 0,
    eventsLast24h:
      typeof (payload as { eventsLast24h?: unknown }).eventsLast24h === 'number'
        ? (payload as { eventsLast24h: number }).eventsLast24h
        : 0,
    activePipeline:
      typeof (payload as { activePipeline?: unknown }).activePipeline === 'number'
        ? (payload as { activePipeline: number }).activePipeline
        : 0,
    lastActivityAt:
      typeof (payload as { lastActivityAt?: unknown }).lastActivityAt === 'string'
        ? (payload as { lastActivityAt: string }).lastActivityAt
        : null,
  };
}

function normalizeOutboxUnitSummary(payload: unknown): IceaDashboardOutboxUnitSummary {
  if (!payload || typeof payload !== 'object') {
    return {
      total: 0,
      queued: 0,
      retry: 0,
      delivered: 0,
      failed: 0,
      lastAttemptAt: null,
      lastDeliveredAt: null,
    };
  }
  return {
    total: typeof (payload as { total?: unknown }).total === 'number' ? (payload as { total: number }).total : 0,
    queued: typeof (payload as { queued?: unknown }).queued === 'number' ? (payload as { queued: number }).queued : 0,
    retry: typeof (payload as { retry?: unknown }).retry === 'number' ? (payload as { retry: number }).retry : 0,
    delivered: typeof (payload as { delivered?: unknown }).delivered === 'number' ? (payload as { delivered: number }).delivered : 0,
    failed: typeof (payload as { failed?: unknown }).failed === 'number' ? (payload as { failed: number }).failed : 0,
    lastAttemptAt:
      typeof (payload as { lastAttemptAt?: unknown }).lastAttemptAt === 'string'
        ? (payload as { lastAttemptAt: string }).lastAttemptAt
        : null,
    lastDeliveredAt:
      typeof (payload as { lastDeliveredAt?: unknown }).lastDeliveredAt === 'string'
        ? (payload as { lastDeliveredAt: string }).lastDeliveredAt
        : null,
  };
}

function normalizeBridgeUnitSummary(payload: unknown): IceaDashboardBridgeUnitSummary {
  const base: IceaDashboardBridgeUnitSummary = {
    total: 0,
    queued: 0,
    sent: 0,
    accepted: 0,
    pending: 0,
    scored: 0,
    failed: 0,
    stale: 0,
    provisional: 0,
    insufficientEvidence: 0,
    lastUpdatedAt: null,
  };
  if (!payload || typeof payload !== 'object') return base;
  return {
    ...base,
    total: typeof (payload as { total?: unknown }).total === 'number' ? (payload as { total: number }).total : 0,
    queued: typeof (payload as { queued?: unknown }).queued === 'number' ? (payload as { queued: number }).queued : 0,
    sent: typeof (payload as { sent?: unknown }).sent === 'number' ? (payload as { sent: number }).sent : 0,
    accepted: typeof (payload as { accepted?: unknown }).accepted === 'number' ? (payload as { accepted: number }).accepted : 0,
    pending: typeof (payload as { pending?: unknown }).pending === 'number' ? (payload as { pending: number }).pending : 0,
    scored: typeof (payload as { scored?: unknown }).scored === 'number' ? (payload as { scored: number }).scored : 0,
    failed: typeof (payload as { failed?: unknown }).failed === 'number' ? (payload as { failed: number }).failed : 0,
    stale: typeof (payload as { stale?: unknown }).stale === 'number' ? (payload as { stale: number }).stale : 0,
    provisional:
      typeof (payload as { provisional?: unknown }).provisional === 'number'
        ? (payload as { provisional: number }).provisional
        : 0,
    insufficientEvidence:
      typeof (payload as { insufficientEvidence?: unknown }).insufficientEvidence === 'number'
        ? (payload as { insufficientEvidence: number }).insufficientEvidence
        : 0,
    lastUpdatedAt:
      typeof (payload as { lastUpdatedAt?: unknown }).lastUpdatedAt === 'string'
        ? (payload as { lastUpdatedAt: string }).lastUpdatedAt
        : null,
  };
}

function normalizeClinicalPatients(payload: unknown): IceaDashboardClinicalPatient[] {
  if (!Array.isArray(payload)) return [];
  const normalized: IceaDashboardClinicalPatient[] = [];
  for (const item of payload) {
    if (!item || typeof item !== 'object') continue;
    normalized.push({
      id: typeof (item as { id?: unknown }).id === 'string' ? (item as { id: string }).id : '',
      name: typeof (item as { name?: unknown }).name === 'string' ? (item as { name: string }).name : 'Paciente',
      unitId: typeof (item as { unitId?: unknown }).unitId === 'string' ? (item as { unitId: string }).unitId : '',
      bedLabel:
        typeof (item as { bedLabel?: unknown }).bedLabel === 'string'
          ? (item as { bedLabel: string }).bedLabel
          : '',
      vitals:
        (item as { vitals?: unknown }).vitals && typeof (item as { vitals?: unknown }).vitals === 'object'
          ? ((item as { vitals: IceaDashboardClinicalPatient['vitals'] }).vitals ?? {})
          : {},
      devices: Array.isArray((item as { devices?: unknown }).devices)
        ? ((item as { devices: IceaDashboardClinicalPatient['devices'] }).devices ?? [])
        : [],
      risks:
        (item as { risks?: unknown }).risks && typeof (item as { risks?: unknown }).risks === 'object'
          ? ((item as { risks: IceaDashboardClinicalPatient['risks'] }).risks ?? {})
          : {},
      pendingTasks: Array.isArray((item as { pendingTasks?: unknown }).pendingTasks)
        ? ((item as { pendingTasks: IceaDashboardClinicalPatient['pendingTasks'] }).pendingTasks ?? [])
        : [],
      lastIncidentAt:
        typeof (item as { lastIncidentAt?: unknown }).lastIncidentAt === 'string'
          ? (item as { lastIncidentAt: string }).lastIncidentAt
          : null,
      recentIncidentFlag: Boolean((item as { recentIncidentFlag?: unknown }).recentIncidentFlag),
    });
  }
  return normalized;
}

function normalizeUnitSummary(payload: unknown): IceaDashboardUnitSummary[] {
  if (!Array.isArray(payload)) return [];
  const normalized: IceaDashboardUnitSummary[] = [];
  for (const item of payload) {
    if (!item || typeof item !== 'object') continue;
    normalized.push({
      unitId: typeof (item as { unitId?: unknown }).unitId === 'string' ? (item as { unitId: string }).unitId : '',
      totalHandovers:
        typeof (item as { totalHandovers?: unknown }).totalHandovers === 'number'
          ? (item as { totalHandovers: number }).totalHandovers
          : 0,
      accepted: typeof (item as { accepted?: unknown }).accepted === 'number' ? (item as { accepted: number }).accepted : 0,
      queued: typeof (item as { queued?: unknown }).queued === 'number' ? (item as { queued: number }).queued : 0,
      running: typeof (item as { running?: unknown }).running === 'number' ? (item as { running: number }).running : 0,
      delivered:
        typeof (item as { delivered?: unknown }).delivered === 'number' ? (item as { delivered: number }).delivered : 0,
      succeeded:
        typeof (item as { succeeded?: unknown }).succeeded === 'number' ? (item as { succeeded: number }).succeeded : 0,
      retry: typeof (item as { retry?: unknown }).retry === 'number' ? (item as { retry: number }).retry : 0,
      failed: typeof (item as { failed?: unknown }).failed === 'number' ? (item as { failed: number }).failed : 0,
      lastUpdatedAt:
        typeof (item as { lastUpdatedAt?: unknown }).lastUpdatedAt === 'string'
          ? (item as { lastUpdatedAt: string }).lastUpdatedAt
          : null,
      lastDashboardRefreshAt:
        typeof (item as { lastDashboardRefreshAt?: unknown }).lastDashboardRefreshAt === 'string'
          ? (item as { lastDashboardRefreshAt: string }).lastDashboardRefreshAt
          : null,
      cachedSummary:
        (item as { cachedSummary?: unknown }).cachedSummary && typeof (item as { cachedSummary?: unknown }).cachedSummary === 'object'
          ? ((item as { cachedSummary: Record<string, unknown> }).cachedSummary ?? null)
          : null,
      activity: normalizeActivity((item as { activity?: unknown }).activity),
      outbox: normalizeOutboxUnitSummary((item as { outbox?: unknown }).outbox),
      bridge: normalizeBridgeUnitSummary((item as { bridge?: unknown }).bridge),
      clinicalPatients: normalizeClinicalPatients((item as { clinicalPatients?: unknown }).clinicalPatients),
      handoverTiming: normalizeTimingSummary((item as { handoverTiming?: unknown }).handoverTiming),
      alertsOpen:
        typeof (item as { alertsOpen?: unknown }).alertsOpen === 'number' ? (item as { alertsOpen: number }).alertsOpen : 0,
      degraded: Boolean((item as { degraded?: unknown }).degraded),
      degradationReasons: Array.isArray((item as { degradationReasons?: unknown }).degradationReasons)
        ? ((item as { degradationReasons: string[] }).degradationReasons ?? [])
        : [],
    });
  }
  return normalized;
}

function normalizeAlertSummary(payload: unknown): IceaDashboardAlert[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      return {
        id: typeof (item as { id?: unknown }).id === 'string' ? (item as { id: string }).id : '',
        unitId: typeof (item as { unitId?: unknown }).unitId === 'string' ? (item as { unitId: string }).unitId : null,
        source: typeof (item as { source?: unknown }).source === 'string' ? (item as { source: string }).source : 'pipeline',
        severity:
          typeof (item as { severity?: unknown }).severity === 'string' ? (item as { severity: string }).severity : 'medium',
        status: typeof (item as { status?: unknown }).status === 'string' ? (item as { status: string }).status : '',
        title: typeof (item as { title?: unknown }).title === 'string' ? (item as { title: string }).title : '',
        message: typeof (item as { message?: unknown }).message === 'string' ? (item as { message: string }).message : '',
        requestId:
          typeof (item as { requestId?: unknown }).requestId === 'string'
            ? (item as { requestId: string }).requestId
            : null,
        createdAt: typeof (item as { createdAt?: unknown }).createdAt === 'string' ? (item as { createdAt: string }).createdAt : '',
      };
    })
    .filter((item): item is IceaDashboardAlert => item !== null);
}

function normalizePipelineEvent(payload: unknown): IceaPipelineEventSummary[] {
  if (!Array.isArray(payload)) return [];
  const normalized: IceaPipelineEventSummary[] = [];
  for (const item of payload) {
    if (!item || typeof item !== 'object') continue;
    normalized.push({
      id: typeof (item as { id?: unknown }).id === 'number' ? (item as { id: number }).id : 0,
      requestId:
        typeof (item as { requestId?: unknown }).requestId === 'string'
          ? (item as { requestId: string }).requestId
          : null,
      bundleId:
        typeof (item as { bundleId?: unknown }).bundleId === 'string' ? (item as { bundleId: string }).bundleId : null,
      patientId:
        typeof (item as { patientId?: unknown }).patientId === 'string'
          ? (item as { patientId: string }).patientId
          : null,
      unitId: typeof (item as { unitId?: unknown }).unitId === 'string' ? (item as { unitId: string }).unitId : null,
      stage: typeof (item as { stage?: unknown }).stage === 'string' ? (item as { stage: string }).stage : '',
      action: typeof (item as { action?: unknown }).action === 'string' ? (item as { action: string }).action : null,
      status: typeof (item as { status?: unknown }).status === 'string' ? (item as { status: string }).status : '',
      source: typeof (item as { source?: unknown }).source === 'string' ? (item as { source: string }).source : null,
      actorSub:
        typeof (item as { actorSub?: unknown }).actorSub === 'string' ? (item as { actorSub: string }).actorSub : null,
      detail: typeof (item as { detail?: unknown }).detail === 'string' ? (item as { detail: string }).detail : null,
      httpStatus:
        typeof (item as { httpStatus?: unknown }).httpStatus === 'number'
          ? (item as { httpStatus: number }).httpStatus
          : null,
      payload:
        (item as { payload?: unknown }).payload && typeof (item as { payload?: unknown }).payload === 'object'
          ? ((item as { payload: Record<string, unknown> }).payload ?? null)
          : null,
      createdAt: typeof (item as { createdAt?: unknown }).createdAt === 'string' ? (item as { createdAt: string }).createdAt : '',
    });
  }
  return normalized;
}

function normalizeOutboxSummary(payload: unknown): IceaDashboardOutboxSummary {
  const empty: IceaDashboardOutboxSummary = {
    enabled: false,
    configured: false,
    totals: { queued: 0, retry: 0, delivered: 0, failed: 0 },
    lastAttemptAt: null,
    lastDeliveredAt: null,
  };
  if (!payload || typeof payload !== 'object') return empty;
  const totals = (payload as { totals?: unknown }).totals;
  return {
    enabled: Boolean((payload as { enabled?: unknown }).enabled),
    configured: Boolean((payload as { configured?: unknown }).configured),
    totals: {
      queued: typeof (totals as { queued?: unknown })?.queued === 'number' ? (totals as { queued: number }).queued : 0,
      retry: typeof (totals as { retry?: unknown })?.retry === 'number' ? (totals as { retry: number }).retry : 0,
      delivered:
        typeof (totals as { delivered?: unknown })?.delivered === 'number' ? (totals as { delivered: number }).delivered : 0,
      failed: typeof (totals as { failed?: unknown })?.failed === 'number' ? (totals as { failed: number }).failed : 0,
    },
    lastAttemptAt:
      typeof (payload as { lastAttemptAt?: unknown }).lastAttemptAt === 'string'
        ? (payload as { lastAttemptAt: string }).lastAttemptAt
        : null,
    lastDeliveredAt:
      typeof (payload as { lastDeliveredAt?: unknown }).lastDeliveredAt === 'string'
        ? (payload as { lastDeliveredAt: string }).lastDeliveredAt
        : null,
  };
}

function normalizePipelineSummary(payload: unknown): IceaDashboardPipelineSummary {
  const emptyBridge = {
    queued: 0,
    sent: 0,
    accepted: 0,
    pending: 0,
    scored: 0,
    failed: 0,
    stale: 0,
    provisional: 0,
    insufficientEvidence: 0,
  };
  if (!payload || typeof payload !== 'object') {
    return {
      configured: false,
      remoteActionsEnabled: false,
      remoteStatusEnabled: false,
      bridgeEnabled: false,
      bridgeConfigured: false,
      snapshots: 0,
      running: 0,
      retry: 0,
      failed: 0,
      bridge: emptyBridge,
      lastEventAt: null,
      degradationReasons: [],
    };
  }
  const bridge = (payload as { bridge?: unknown }).bridge;
  return {
    configured: Boolean((payload as { configured?: unknown }).configured),
    remoteActionsEnabled: Boolean((payload as { remoteActionsEnabled?: unknown }).remoteActionsEnabled),
    remoteStatusEnabled: Boolean((payload as { remoteStatusEnabled?: unknown }).remoteStatusEnabled),
    bridgeEnabled: Boolean((payload as { bridgeEnabled?: unknown }).bridgeEnabled),
    bridgeConfigured: Boolean((payload as { bridgeConfigured?: unknown }).bridgeConfigured),
    snapshots: typeof (payload as { snapshots?: unknown }).snapshots === 'number' ? (payload as { snapshots: number }).snapshots : 0,
    running: typeof (payload as { running?: unknown }).running === 'number' ? (payload as { running: number }).running : 0,
    retry: typeof (payload as { retry?: unknown }).retry === 'number' ? (payload as { retry: number }).retry : 0,
    failed: typeof (payload as { failed?: unknown }).failed === 'number' ? (payload as { failed: number }).failed : 0,
    bridge: {
      queued: typeof (bridge as { queued?: unknown })?.queued === 'number' ? (bridge as { queued: number }).queued : 0,
      sent: typeof (bridge as { sent?: unknown })?.sent === 'number' ? (bridge as { sent: number }).sent : 0,
      accepted: typeof (bridge as { accepted?: unknown })?.accepted === 'number' ? (bridge as { accepted: number }).accepted : 0,
      pending: typeof (bridge as { pending?: unknown })?.pending === 'number' ? (bridge as { pending: number }).pending : 0,
      scored: typeof (bridge as { scored?: unknown })?.scored === 'number' ? (bridge as { scored: number }).scored : 0,
      failed: typeof (bridge as { failed?: unknown })?.failed === 'number' ? (bridge as { failed: number }).failed : 0,
      stale: typeof (bridge as { stale?: unknown })?.stale === 'number' ? (bridge as { stale: number }).stale : 0,
      provisional:
        typeof (bridge as { provisional?: unknown })?.provisional === 'number'
          ? (bridge as { provisional: number }).provisional
          : 0,
      insufficientEvidence:
        typeof (bridge as { insufficientEvidence?: unknown })?.insufficientEvidence === 'number'
          ? (bridge as { insufficientEvidence: number }).insufficientEvidence
          : 0,
    },
    lastEventAt:
      typeof (payload as { lastEventAt?: unknown }).lastEventAt === 'string'
        ? (payload as { lastEventAt: string }).lastEventAt
        : null,
    degradationReasons: Array.isArray((payload as { degradationReasons?: unknown }).degradationReasons)
      ? ((payload as { degradationReasons: string[] }).degradationReasons ?? [])
      : [],
  };
}

function isContractLike(payload: unknown): payload is Partial<IceaDashboardSummary> {
  return Boolean(payload && typeof payload === 'object' && 'units' in payload && 'recentEvents' in payload && 'pipeline' in payload);
}

function normalizeDashboardSummary(payload: Partial<IceaDashboardSummary> | null | undefined): IceaDashboardSummary {
  return {
    generatedAt: typeof payload?.generatedAt === 'string' ? payload.generatedAt : '',
    source: typeof payload?.source === 'string' ? payload.source : 'live',
    demoMode: Boolean(payload?.demoMode),
    empty: Boolean(payload?.empty),
    stale: Boolean(payload?.stale),
    degraded: Boolean(payload?.degraded),
    degradationReasons: Array.isArray(payload?.degradationReasons) ? payload.degradationReasons : [],
    latestActivityAt: typeof payload?.latestActivityAt === 'string' ? payload.latestActivityAt : null,
    units: normalizeUnitSummary(payload?.units),
    alerts: normalizeAlertSummary(payload?.alerts),
    outbox: normalizeOutboxSummary(payload?.outbox),
    pipeline: normalizePipelineSummary(payload?.pipeline),
    recentEvents: normalizePipelineEvent(payload?.recentEvents),
  };
}

function mapApiError(error: unknown): AdminDashboardApiError {
  if (error instanceof AdminDashboardApiError) return error;
  if (error instanceof ApiClientError) {
    if (error.status === 401 || error.status === 403) {
      return new AdminDashboardApiError('forbidden', 'No tienes permisos para ver el dashboard administrativo.', {
        status: error.status,
        details: error.details,
      });
    }
    return new AdminDashboardApiError('remote', 'El backend devolvio un error al cargar el dashboard.', {
      status: error.status,
      details: error.details,
    });
  }
  return new AdminDashboardApiError('network', 'No se pudo conectar con el backend del dashboard.');
}

function demoDashboardData(): IceaDashboardSummary {
  return buildDemoAdminDashboardSummary();
}

export async function fetchAdminDashboardData(unitId?: string, options?: AdminDashboardRequestOptions): Promise<IceaDashboardSummary> {
  const qs = unitId ? `?unitId=${encodeURIComponent(unitId)}` : '';
  try {
    const response = (await apiGet(`/api/icea/dashboard-summary${qs}`)) as Partial<IceaDashboardSummary> | { mode?: string } | null | undefined;
    if (options?.demoMode && typeof response === 'object' && response && (response as { mode?: string }).mode === 'demo') {
      return demoDashboardData();
    }
    if (!isContractLike(response)) {
      if (options?.demoMode) {
        return demoDashboardData();
      }
      throw new AdminDashboardApiError('invalid_payload', 'El backend devolvio un contrato de dashboard invalido.');
    }
    const normalized = normalizeDashboardSummary(response);
    if (!normalized.generatedAt && !options?.demoMode) {
      throw new AdminDashboardApiError('invalid_payload', 'El backend devolvio un contrato de dashboard incompleto.');
    }
    return normalized;
  } catch (error) {
    if (options?.demoMode) {
      return demoDashboardData();
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
            generatedAt: demoDashboardData().generatedAt,
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
