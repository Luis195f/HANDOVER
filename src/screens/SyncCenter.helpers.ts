import type { OperationIssue } from '@/src/lib/fhir-outcome';

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

export function resolveErrorCopy(errorStatus?: number | null): {
  title: string;
  subtitle: string;
} {
  const isValidation = errorStatus === 422;
  return {
    title: isValidation ? 'Error de validación FHIR' : 'Error de sincronización',
    subtitle: isValidation ? 'Error de validación FHIR (422)' : 'Error de sincronización',
  };
}
