// src/lib/fhir-outcome.ts

export type OperationIssue = {
  severity?: string;
  diagnostics?: string;
  details?: { text?: string };
  expression?: string[];
  code?: string;
};

export type OperationOutcome = { resourceType: 'OperationOutcome'; issue?: OperationIssue[] };

export function isOperationOutcome(value: unknown): value is OperationOutcome {
  return Boolean(
    value &&
    typeof value === 'object' &&
    (value as { resourceType?: unknown }).resourceType === 'OperationOutcome' &&
    Array.isArray((value as { issue?: unknown }).issue),
  );
}

export function getIssueText(issue: OperationIssue): string {
  if (!issue) return 'Error de validación';
  return (
    issue.diagnostics ||
    issue.details?.text ||
    issue.code ||
    'Error de validación'
  );
}

export function hasFatalOutcome(issues?: OperationIssue[]): OperationIssue | undefined {
  if (!Array.isArray(issues)) return undefined;
  return issues.find((issue) => issue?.severity === 'fatal' || issue?.severity === 'error');
}

export function formatIssuesForUser(
  issues?: OperationIssue[],
  opts: { max?: number } = {},
): { title: string; message: string } {
  const max = opts.max ?? 10;
  if (!Array.isArray(issues) || issues.length === 0) {
    return { title: 'Error de validación', message: 'El servidor rechazó el Bundle por errores de validación.' };
  }

  const seen = new Set<string>();
  const lines: string[] = [];

  for (const issue of issues) {
    const text = getIssueText(issue);
    const prefix = issue.expression?.[0];
    const line = prefix ? `${prefix}: ${text}` : text;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
    if (lines.length >= max) break;
  }

  const extra = issues.length - lines.length;
  if (extra > 0) {
    lines.push(`…y ${extra} más`);
  }

  return {
    title: 'Error de validación',
    message: lines.join('\n'),
  };
}
