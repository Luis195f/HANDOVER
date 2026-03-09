export type IceaBridgeStatus =
  | 'queued'
  | 'sent'
  | 'accepted'
  | 'pending'
  | 'scored'
  | 'failed'
  | 'stale';

export type IceaBridgeScoringMode = 'immediate_provisional' | 'enriched_followup';

export type IceaClinicalRiskStatus = 'no_data' | 'pending' | 'provisional' | 'complete' | 'insufficient_evidence' | 'failed';

export interface IceaBridgeWarning {
  code: string;
  message: string;
}

export interface IceaBridgeRequest {
  id: number;
  bridgeRequestId: string;
  handoverId: string;
  bundleId: string;
  requestId: string;
  patientId: string;
  unitId: string;
  encounterId?: string | null;
  compositionId?: string | null;
  episodeId?: string | null;
  shift?: string | null;
  status: IceaBridgeStatus;
  scoringMode: IceaBridgeScoringMode;
  payloadHash: string;
  idempotencyKey: string;
  contractVersion?: string | null;
  formulaVersion?: string | null;
  provisional: boolean;
  insufficientEvidence: boolean;
  scoreSummary?: Record<string, unknown> | null;
  warnings: IceaBridgeWarning[];
  lastError?: string | null;
  lastHttpStatus?: number | null;
  source: string;
  sentAt?: string | null;
  receivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IceaBridgeSummary {
  handoverId: string;
  status: IceaBridgeStatus;
  scoringMode: IceaBridgeScoringMode;
  provisional: boolean;
  insufficientEvidence: boolean;
  scoreSummary?: Record<string, unknown> | null;
  warnings: IceaBridgeWarning[];
  formulaVersion?: string | null;
  lastUpdated: string;
  source: string;
}

export interface IceaBridgeResponseError {
  code: string;
  detail?: string;
  remoteStatus?: number;
}

export interface IceaBridgeStatusResponse {
  bridgeRequest: IceaBridgeRequest;
  summary: IceaBridgeSummary;
  remoteStatusSupported: boolean;
  remoteRefreshAttempted: boolean;
  localStatusIsAuthoritative: boolean;
  remoteError?: IceaBridgeResponseError;
  configurationError?: IceaBridgeResponseError;
}

export interface IceaBridgeListResponse {
  results: IceaBridgeRequest[];
  count: number;
}

export interface IceaPatientRiskConfidence {
  value?: number | null;
  label?: string | null;
}

export interface IceaPatientRiskProvenance {
  source: string;
  provider: string;
  scoringMode: IceaBridgeScoringMode;
  contractVersion?: string | null;
  formulaVersion?: string | null;
  bridgeStatus?: IceaBridgeStatus | null;
  localStatusIsAuthoritative: boolean;
}

export interface IceaPatientRiskCausalSummary {
  available: boolean;
  summary?: string | null;
  updatedAt?: string | null;
}

export interface IceaPatientRiskSummary {
  patientId: string;
  unitId: string;
  handoverId: string;
  requestId: string;
  clinicalStatus: IceaClinicalRiskStatus;
  stale: boolean;
  score?: number | null;
  scoreLabel?: string | null;
  confidence?: IceaPatientRiskConfidence | null;
  warnings: IceaBridgeWarning[];
  message: string;
  calculatedAt?: string | null;
  lastUpdatedAt: string;
  provenance: IceaPatientRiskProvenance;
  causalSummary?: IceaPatientRiskCausalSummary | null;
}

export interface IceaPatientRiskListResponse {
  enabled: boolean;
  results: IceaPatientRiskSummary[];
  count: number;
}
