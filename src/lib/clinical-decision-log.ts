import { apiPost } from '@/src/lib/api';

export type ClinicalDecisionSource =
  | 'ai_generate_sbar'
  | 'ai_refine_sbar'
  | 'ai_nic_suggestions'
  | 'ai_noc_suggestions';

export type ClinicalDecisionValue = 'shown' | 'accepted' | 'applied' | 'rejected' | 'dismissed';

export type ClinicalDecisionReasonCode =
  | 'direct_apply'
  | 'selection_applied'
  | 'replace_existing'
  | 'user_discarded_batch'
  | 'not_relevant'
  | 'insufficient_quality'
  | 'other';

export interface ClinicalDecisionMetadata {
  selectedCodes?: string[];
  selectedCount?: number;
  section?: 'sbar' | 'treatments' | 'outcomes';
  suggestionCount?: number;
  suggestionHashes?: string[];
  replaceExisting?: boolean;
}

export interface ClinicalDecisionInput {
  patientId: string;
  unitId: string;
  handoverId?: string;
  suggestionSource: ClinicalDecisionSource;
  suggestionVersion?: string;
  decision: ClinicalDecisionValue;
  reasonCode?: ClinicalDecisionReasonCode;
  note?: string;
  metadata?: ClinicalDecisionMetadata;
}

const sanitizeStringArray = (value: string[] | undefined, maxItems: number, maxLength: number): string[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
    .slice(0, maxItems)
    .map((item) => item.slice(0, maxLength));
  return normalized.length > 0 ? normalized : undefined;
};

function sanitizeMetadata(metadata?: ClinicalDecisionMetadata): ClinicalDecisionMetadata | undefined {
  if (!metadata) return undefined;

  const normalized: ClinicalDecisionMetadata = {};
  const selectedCodes = sanitizeStringArray(metadata.selectedCodes, 10, 64);
  if (selectedCodes) normalized.selectedCodes = selectedCodes;

  const suggestionHashes = sanitizeStringArray(metadata.suggestionHashes, 10, 64);
  if (suggestionHashes) normalized.suggestionHashes = suggestionHashes;

  if (typeof metadata.selectedCount === 'number' && Number.isInteger(metadata.selectedCount) && metadata.selectedCount >= 0) {
    normalized.selectedCount = metadata.selectedCount;
  }

  if (typeof metadata.suggestionCount === 'number' && Number.isInteger(metadata.suggestionCount) && metadata.suggestionCount >= 0) {
    normalized.suggestionCount = metadata.suggestionCount;
  }

  if (metadata.section) {
    normalized.section = metadata.section;
  }

  if (typeof metadata.replaceExisting === 'boolean') {
    normalized.replaceExisting = metadata.replaceExisting;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export async function logClinicalDecision(input: ClinicalDecisionInput): Promise<void> {
  const patientId = input.patientId.trim();
  const unitId = input.unitId.trim();
  if (!patientId || !unitId) return;
  const metadata = sanitizeMetadata(input.metadata);

  const payload = {
    patientId,
    unitId,
    ...(input.handoverId?.trim() ? { handoverId: input.handoverId.trim() } : {}),
    suggestionSource: input.suggestionSource,
    decision: input.decision,
    ...(input.suggestionVersion?.trim() ? { suggestionVersion: input.suggestionVersion.trim() } : {}),
    ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
    ...(input.note?.trim() ? { note: input.note.trim().slice(0, 240) } : {}),
    ...(metadata ? { metadata } : {}),
  };

  try {
    await apiPost('/api/ai/clinical-decision', { body: JSON.stringify(payload) });
  } catch {
    return;
  }
}
