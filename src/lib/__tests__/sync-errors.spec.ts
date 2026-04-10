import { describe, expect, it } from 'vitest';

import type { OperationIssue } from '@/src/lib/fhir-outcome';
import { getValidationErrorDetails, resolveSyncErrorMessage } from '@/src/lib/sync-errors';
import { t } from '@/src/i18n';

describe('sync-errors', () => {
  it('resume detalles de validación FHIR', () => {
    const issues: OperationIssue[] = [
      { diagnostics: 'Campo obligatorio ausente', expression: ['Bundle.entry[0]'] },
    ];
    const details = getValidationErrorDetails(issues);
    expect(details).toContain('Bundle.entry[0]: Campo obligatorio ausente');
  });

  it('usa el mensaje de validación remota para 422', () => {
    expect(resolveSyncErrorMessage(422)).toBe(t('sync.validationFailedMessage'));
  });

  it('distingue 401 de 403 en el copy de replay', () => {
    expect(resolveSyncErrorMessage(401)).toBe(t('sync.authRequiredMessage'));
    expect(resolveSyncErrorMessage(403)).toBe(t('sync.authFailedMessage'));
  });
});
