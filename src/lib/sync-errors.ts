import type { OperationIssue } from '@/src/lib/fhir-outcome';
import { t } from '@/src/i18n';
import { getUserFacingNetworkMessage } from '@/src/lib/net-errors';

export function parseErrorIssuesJson(raw?: string | null): OperationIssue[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((issue): issue is OperationIssue => !!issue && typeof issue === 'object');
  } catch {
    return [];
  }
}

export function formatIssueLine(issue: OperationIssue): string | null {
  if (!issue || typeof issue !== 'object') return null;
  const expression = Array.isArray(issue.expression)
    ? issue.expression.filter((it): it is string => typeof it === 'string').join(', ')
    : typeof issue.expression === 'string'
    ? issue.expression
    : null;
  const detail = issue.diagnostics ?? issue.details?.text ?? issue.code;
  if (expression && detail) return `${expression}: ${detail}`;
  return detail ?? expression ?? null;
}

export function buildIssuesText(issues: OperationIssue[]): string {
  const lines = issues.map(formatIssueLine).filter(Boolean) as string[];
  if (lines.length === 0) return '';
  return lines.map((line) => `• ${line}`).join('\n');
}

export function getValidationErrorDetails(issues?: OperationIssue[] | null): string {
  if (!issues || issues.length === 0) return '';
  return buildIssuesText(issues);
}

export function getSyncErrorMessage(status?: number | null) {
  if (status === 422) {
    return {
      title: t('handover.fhirValidationTitle'),
      message: t('handover.fhirValidationMessage'),
    };
  }
  const ui = getUserFacingNetworkMessage(
    typeof status === 'number' ? { kind: 'HTTP', status } : { kind: 'UNKNOWN' },
    { log: false },
  );
  return { title: ui.title, message: ui.message };
}

export function resolveSyncErrorMessage(status?: number | null, fallback?: string): string {
  if (status === 422) {
    return t('sync.validationFailedMessage');
  }
  if (status === 401) {
    return t('sync.authRequiredMessage');
  }
  if (status === 403) {
    return t('sync.authFailedMessage');
  }
  if (typeof status === 'number') {
    return t('sync.syncErrorStatusMessage', { status });
  }
  return fallback ?? t('sync.syncErrorTitle');
}
