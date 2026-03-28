import { describe, expect, it } from 'vitest';

import {
  baseChecklistDefaults,
  buildCompletedChecklist,
  findActiveSection,
  normalizeSignatureInfo,
  resolveCanonicalPilotContextUnitId,
  resolveEffectiveHandoverUnitId,
} from '@/src/screens/handover/formUtils';

describe('handover form utils', () => {
  it('keeps human unit text separate from canonical pilot resolution', () => {
    expect(resolveEffectiveHandoverUnitId('  Sala 2  ', 'unit-route')).toBe('Sala 2');
    expect(resolveCanonicalPilotContextUnitId('all', ' unit-route ')).toBe('unit-route');
    expect(resolveCanonicalPilotContextUnitId('  ', 'all')).toBeUndefined();
  });

  it('completes only configured checklist items and preserves bedside notes', () => {
    expect(
      buildCompletedChecklist(
        {
          ...baseChecklistDefaults,
          patientIdentityConfirmed: true,
          bedsideNotes: 'doble verificación',
        },
        [{ key: 'allergiesReviewed' }, { key: 'questionsAnswered' }],
      ),
    ).toEqual({
      patientIdentityConfirmed: true,
      allergiesReviewed: true,
      linesAndDevicesChecked: false,
      medicationPlanReviewed: false,
      safetyMeasuresApplied: false,
      questionsAnswered: true,
      bedsideNotes: 'doble verificación',
    });
  });

  it('normalizes outgoing signatures with a default session method', () => {
    expect(
      normalizeSignatureInfo({
        outgoing: {
          userId: 'nurse-1',
          fullName: 'Nurse One',
          unitId: 'unit-1',
          signedAt: '2025-01-01T00:00:00.000Z',
        },
      }),
    ).toEqual({
      outgoing: {
        userId: 'nurse-1',
        fullName: 'Nurse One',
        unitId: 'unit-1',
        signedAt: '2025-01-01T00:00:00.000Z',
        method: 'session',
      },
    });
  });

  it('resolves the active section from the current scroll offset', () => {
    expect(
      findActiveSection(
        180,
        { turno: 0, paciente: 120, sbar: 260 },
        [{ key: 'turno' }, { key: 'paciente' }, { key: 'sbar' }],
      ),
    ).toBe('paciente');
  });
});
