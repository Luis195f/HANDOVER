import { apiGet, apiPost } from '@/src/lib/api';
import type {
  IceaBridgeListResponse,
  IceaBridgeRequest,
  IceaBridgeResponseError,
  IceaBridgeScoringMode,
  IceaBridgeStatusResponse,
  IceaBridgeSummary,
  IceaPatientRiskCausalSummary,
  IceaPatientRiskConfidence,
  IceaPatientRiskListResponse,
  IceaPatientRiskProvenance,
  IceaPatientRiskSummary,
} from '@/src/types/icea';

function normalizeWarnings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const code = typeof (item as { code?: unknown }).code === 'string' ? (item as { code: string }).code : '';
      const message = typeof (item as { message?: unknown }).message === 'string' ? (item as { message: string }).message : '';
      return code || message ? { code, message } : null;
    })
    .filter((item): item is { code: string; message: string } => item !== null);
}

function normalizeResponseError(value: unknown): IceaBridgeResponseError | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const code = typeof (value as { code?: unknown }).code === 'string' ? (value as { code: string }).code : '';
  if (!code) return undefined;
  const detail = typeof (value as { detail?: unknown }).detail === 'string' ? (value as { detail: string }).detail : undefined;
  const remoteStatus = typeof (value as { remoteStatus?: unknown }).remoteStatus === 'number' ? (value as { remoteStatus: number }).remoteStatus : undefined;
  return { code, detail, remoteStatus };
}

function normalizeBridgeRequest(payload: Partial<IceaBridgeRequest> | null | undefined): IceaBridgeRequest {
  return {
    id: typeof payload?.id === 'number' ? payload.id : 0,
    bridgeRequestId: typeof payload?.bridgeRequestId === 'string' ? payload.bridgeRequestId : '',
    handoverId: typeof payload?.handoverId === 'string' ? payload.handoverId : '',
    bundleId: typeof payload?.bundleId === 'string' ? payload.bundleId : '',
    requestId: typeof payload?.requestId === 'string' ? payload.requestId : '',
    patientId: typeof payload?.patientId === 'string' ? payload.patientId : '',
    unitId: typeof payload?.unitId === 'string' ? payload.unitId : '',
    encounterId: typeof payload?.encounterId === 'string' ? payload.encounterId : null,
    compositionId: typeof payload?.compositionId === 'string' ? payload.compositionId : null,
    episodeId: typeof payload?.episodeId === 'string' ? payload.episodeId : null,
    shift: typeof payload?.shift === 'string' ? payload.shift : null,
    status: (payload?.status as IceaBridgeRequest['status']) ?? 'queued',
    scoringMode: (payload?.scoringMode as IceaBridgeScoringMode) ?? 'immediate_provisional',
    payloadHash: typeof payload?.payloadHash === 'string' ? payload.payloadHash : '',
    idempotencyKey: typeof payload?.idempotencyKey === 'string' ? payload.idempotencyKey : '',
    contractVersion: typeof payload?.contractVersion === 'string' ? payload.contractVersion : null,
    formulaVersion: typeof payload?.formulaVersion === 'string' ? payload.formulaVersion : null,
    provisional: Boolean(payload?.provisional),
    insufficientEvidence: Boolean(payload?.insufficientEvidence),
    scoreSummary: payload?.scoreSummary && typeof payload.scoreSummary === 'object' ? payload.scoreSummary : null,
    warnings: normalizeWarnings(payload?.warnings),
    lastError: typeof payload?.lastError === 'string' ? payload.lastError : null,
    lastHttpStatus: typeof payload?.lastHttpStatus === 'number' ? payload.lastHttpStatus : null,
    source: typeof payload?.source === 'string' ? payload.source : 'HANDOVER',
    sentAt: typeof payload?.sentAt === 'string' ? payload.sentAt : null,
    receivedAt: typeof payload?.receivedAt === 'string' ? payload.receivedAt : null,
    createdAt: typeof payload?.createdAt === 'string' ? payload.createdAt : '',
    updatedAt: typeof payload?.updatedAt === 'string' ? payload.updatedAt : '',
  };
}

function normalizeBridgeSummary(payload: Partial<IceaBridgeSummary> | null | undefined): IceaBridgeSummary {
  return {
    handoverId: typeof payload?.handoverId === 'string' ? payload.handoverId : '',
    status: (payload?.status as IceaBridgeSummary['status']) ?? 'queued',
    scoringMode: (payload?.scoringMode as IceaBridgeScoringMode) ?? 'immediate_provisional',
    provisional: Boolean(payload?.provisional),
    insufficientEvidence: Boolean(payload?.insufficientEvidence),
    scoreSummary: payload?.scoreSummary && typeof payload.scoreSummary === 'object' ? payload.scoreSummary : null,
    warnings: normalizeWarnings(payload?.warnings),
    formulaVersion: typeof payload?.formulaVersion === 'string' ? payload.formulaVersion : null,
    lastUpdated: typeof payload?.lastUpdated === 'string' ? payload.lastUpdated : '',
    source: typeof payload?.source === 'string' ? payload.source : 'HANDOVER',
  };
}

function normalizePatientRiskConfidence(value: unknown): IceaPatientRiskConfidence | null {
  if (!value || typeof value !== 'object') return null;
  const normalizedValue = typeof (value as { value?: unknown }).value === 'number' ? (value as { value: number }).value : null;
  const label = typeof (value as { label?: unknown }).label === 'string' ? (value as { label: string }).label : null;
  if (normalizedValue === null && !label) return null;
  return { value: normalizedValue, label };
}

function normalizePatientRiskProvenance(value: unknown): IceaPatientRiskProvenance {
  const payload = value && typeof value === 'object' ? (value as Partial<IceaPatientRiskProvenance>) : {};
  return {
    source: typeof payload.source === 'string' ? payload.source : 'HANDOVER',
    provider: typeof payload.provider === 'string' ? payload.provider : 'ICEA+',
    scoringMode: (payload.scoringMode as IceaBridgeScoringMode) ?? 'immediate_provisional',
    contractVersion: typeof payload.contractVersion === 'string' ? payload.contractVersion : null,
    formulaVersion: typeof payload.formulaVersion === 'string' ? payload.formulaVersion : null,
    bridgeStatus: payload.bridgeStatus ?? null,
    localStatusIsAuthoritative:
      typeof payload.localStatusIsAuthoritative === 'boolean' ? payload.localStatusIsAuthoritative : true,
  };
}

function normalizePatientRiskCausalSummary(value: unknown): IceaPatientRiskCausalSummary | null {
  if (!value || typeof value !== 'object') return null;
  const payload = value as Partial<IceaPatientRiskCausalSummary>;
  const available = Boolean(payload.available);
  const summary = typeof payload.summary === 'string' ? payload.summary : null;
  const updatedAt = typeof payload.updatedAt === 'string' ? payload.updatedAt : null;
  if (!available && !summary && !updatedAt) return null;
  return { available, summary, updatedAt };
}

function normalizePatientRiskSummary(payload: Partial<IceaPatientRiskSummary> | null | undefined): IceaPatientRiskSummary {
  return {
    patientId: typeof payload?.patientId === 'string' ? payload.patientId : '',
    unitId: typeof payload?.unitId === 'string' ? payload.unitId : '',
    handoverId: typeof payload?.handoverId === 'string' ? payload.handoverId : '',
    requestId: typeof payload?.requestId === 'string' ? payload.requestId : '',
    clinicalStatus: payload?.clinicalStatus ?? 'no_data',
    stale: Boolean(payload?.stale),
    score: typeof payload?.score === 'number' ? payload.score : null,
    scoreLabel: typeof payload?.scoreLabel === 'string' ? payload.scoreLabel : null,
    confidence: normalizePatientRiskConfidence(payload?.confidence),
    warnings: normalizeWarnings(payload?.warnings),
    message: typeof payload?.message === 'string' ? payload.message : 'Apoyo analitico ICEA+ no disponible.',
    calculatedAt: typeof payload?.calculatedAt === 'string' ? payload.calculatedAt : null,
    lastUpdatedAt: typeof payload?.lastUpdatedAt === 'string' ? payload.lastUpdatedAt : '',
    provenance: normalizePatientRiskProvenance(payload?.provenance),
    causalSummary: normalizePatientRiskCausalSummary(payload?.causalSummary),
  };
}

export async function fetchIceaBridgeStatus(handoverId: string, options?: { scoringMode?: IceaBridgeScoringMode; refresh?: boolean }): Promise<IceaBridgeStatusResponse> {
  const params = new URLSearchParams();
  if (options?.scoringMode) params.set('scoringMode', options.scoringMode);
  if (options?.refresh === true) params.set('refresh', 'true');
  if (options?.refresh === false) params.set('refresh', 'false');
  const qs = params.toString() ? `?${params.toString()}` : '';
  const payload = (await apiGet(`/api/icea/bridge/status/${encodeURIComponent(handoverId)}${qs}`)) as Partial<IceaBridgeStatusResponse>;
  return {
    bridgeRequest: normalizeBridgeRequest(payload?.bridgeRequest),
    summary: normalizeBridgeSummary(payload?.summary),
    remoteStatusSupported: Boolean(payload?.remoteStatusSupported),
    remoteRefreshAttempted: Boolean(payload?.remoteRefreshAttempted),
    localStatusIsAuthoritative:
      typeof payload?.localStatusIsAuthoritative === 'boolean' ? payload.localStatusIsAuthoritative : true,
    remoteError: normalizeResponseError(payload?.remoteError),
    configurationError: normalizeResponseError(payload?.configurationError),
  };
}

export async function fetchIceaBridgeRequests(filters?: { patientId?: string; unitId?: string; shift?: string; status?: string; scoringMode?: IceaBridgeScoringMode; limit?: number }): Promise<IceaBridgeListResponse> {
  const params = new URLSearchParams();
  if (filters?.patientId) params.set('patientId', filters.patientId);
  if (filters?.unitId) params.set('unitId', filters.unitId);
  if (filters?.shift) params.set('shift', filters.shift);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.scoringMode) params.set('scoringMode', filters.scoringMode);
  if (typeof filters?.limit === 'number') params.set('limit', String(filters.limit));
  const qs = params.toString() ? `?${params.toString()}` : '';
  const payload = (await apiGet(`/api/icea/bridge/status${qs}`)) as Partial<IceaBridgeListResponse>;
  return {
    results: Array.isArray(payload?.results) ? payload.results.map((item) => normalizeBridgeRequest(item)) : [],
    count: typeof payload?.count === 'number' ? payload.count : 0,
  };
}

export async function fetchIceaPatientRiskSummaries(filters?: { patientId?: string; unitId?: string; limit?: number }): Promise<IceaPatientRiskListResponse> {
  const params = new URLSearchParams();
  if (filters?.patientId) params.set('patientId', filters.patientId);
  if (filters?.unitId) params.set('unitId', filters.unitId);
  if (typeof filters?.limit === 'number') params.set('limit', String(filters.limit));
  const qs = params.toString() ? `?${params.toString()}` : '';
  const payload = (await apiGet(`/api/icea/patient-risk${qs}`)) as Partial<IceaPatientRiskListResponse>;
  return {
    enabled: typeof payload?.enabled === 'boolean' ? payload.enabled : true,
    results: Array.isArray(payload?.results) ? payload.results.map((item) => normalizePatientRiskSummary(item)) : [],
    count: typeof payload?.count === 'number' ? payload.count : 0,
  };
}

export async function retryIceaBridgeRequest(bridgeId: number, scoringMode?: IceaBridgeScoringMode): Promise<IceaBridgeRequest> {
  const payload = (await apiPost(`/api/icea/bridge/retry/${bridgeId}`, {
    body: JSON.stringify(scoringMode ? { scoringMode } : {}),
  })) as { bridgeRequest?: Partial<IceaBridgeRequest> | null };
  return normalizeBridgeRequest(payload?.bridgeRequest);
}
