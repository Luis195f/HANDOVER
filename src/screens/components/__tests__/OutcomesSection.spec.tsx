import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { FormProvider, useForm, type UseFormReturn } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';

import * as nocCatalogModule from '@/src/catalogs/nocCodes';
import OutcomesSection from '../OutcomesSection';
import type { HandoverValues as HandoverFormValues } from '@/src/validation/schemas';
import { SNOMED_SYSTEM } from '@/src/data/snomed-dict';
import { logClinicalDecision } from '@/src/lib/clinical-decision-log';

vi.mock('@/src/lib/clinical-decision-log', () => ({
  logClinicalDecision: vi.fn(async () => undefined),
}));

const defaultValues: HandoverFormValues = {
  administrativeData: {
    unit: '',
    census: 0,
    staffIn: [],
    staffOut: [],
    shiftStart: '',
    shiftEnd: '',
    shiftType: 'Mañana',
    incidents: [],
  },
  attachments: [],
  patientId: 'pat-001',
  status: 'draft',
  dxMedical: { system: SNOMED_SYSTEM, code: '195967001', display: 'Neumonía' },
  dxNursing: 'Deterioro del intercambio gaseoso',
  dxMedicalStructured: [],
  dxNursingStructured: [],
  bedsideChecklist: {
    patientIdentityConfirmed: true,
    allergiesReviewed: true,
    linesAndDevicesChecked: false,
    medicationPlanReviewed: false,
    safetyMeasuresApplied: false,
    questionsAnswered: false,
    bedsideNotes: '',
  },
  medications: [],
  treatments: [],
  outcomes: [],
  exams: [],
  procedures: [],
  meds: '',
  devices: [],
  risks: {},
  risksStructured: [],
  vitals: {},
  oxygenTherapy: {},
  evolution: '',
  closingSummary: '',
  sbarSituation: '',
  sbarBackground: '',
  sbarAssessment: '',
  sbarRecommendation: '',
  sbarFullText: '',
};

function renderWithForm(props?: Partial<React.ComponentProps<typeof OutcomesSection>>) {
  let methodsReturn: UseFormReturn<HandoverFormValues> | undefined;

  function Wrapper() {
    const methods = useForm<HandoverFormValues>({ defaultValues });
    methodsReturn = methods;

    return (
      <FormProvider {...methods}>
        <OutcomesSection control={methods.control} enableAiSuggestions={false} {...props} />
      </FormProvider>
    );
  }

  const utils = render(<Wrapper />);
  return { ...utils, methods: methodsReturn! };
}

describe('OutcomesSection', () => {
  it('muestra el gate de licencia NOC y permite añadir desde el catálogo placeholder', async () => {
    const { getByTestId, getByText, methods } = renderWithForm();

    expect(getByTestId('noc-license-warning')).toBeTruthy();
    expect(getByText('Licencia NOC requerida')).toBeTruthy();

    fireEvent.changeText(getByTestId('noc-catalog-search-input'), 'vias aereas');
    fireEvent.press(getByTestId('noc-catalog-suggestion-NOC-0402'));

    await waitFor(() => {
      expect(methods.getValues('outcomes')).toEqual([
        {
          nocCode: '0402',
          nocDisplay: 'Estado respiratorio: permeabilidad de las vías aéreas',
          baseline: 2,
          target: 4,
        },
      ]);
    });
  });

  it('mantiene el catálogo local si no hay catálogo NOC licenciado', async () => {
    vi.spyOn(nocCatalogModule, 'loadNocCatalog').mockResolvedValue({
      ...nocCatalogModule.getNocPlaceholderCatalog(),
      source: 'backend-placeholder',
      licensed: false,
    });

    const { getByTestId, getByText } = renderWithForm();

    await act(async () => {
      fireEvent.press(getByTestId('enable-full-noc-button'));
    });

    await waitFor(() => {
      expect(getByText('No hay un catálogo NOC licenciado configurado; se mantiene el catálogo local.')).toBeTruthy();
    });
  });

  it('create outcome flow captures noc code/display and scores', async () => {
    const { getByTestId, methods } = renderWithForm();

    fireEvent.press(getByTestId('noc-outcomes-add-button'));

    fireEvent.changeText(getByTestId('noc-outcome-0-display'), 'Estado respiratorio: permeabilidad de vías aéreas');
    fireEvent.changeText(getByTestId('noc-outcome-0-code'), '0402');
    fireEvent.press(getByTestId('noc-outcome-0-baseline-increment'));
    fireEvent.press(getByTestId('noc-outcome-0-target-value-5'));
    fireEvent.press(getByTestId('noc-outcome-0-current-value-4'));

    await waitFor(() => {
      expect(methods.getValues('outcomes')).toEqual([
        {
          nocCode: '0402',
          nocDisplay: 'Estado respiratorio: permeabilidad de vías aéreas',
          baseline: 3,
          target: 5,
          current: 4,
        },
      ]);
    });
  });

  it('enforces score controls in 1-5 range', async () => {
    const { getByTestId, methods } = renderWithForm();

    fireEvent.press(getByTestId('noc-outcomes-add-button'));

    await act(async () => {
      for (let idx = 0; idx < 8; idx += 1) {
        fireEvent.press(getByTestId('noc-outcome-0-baseline-decrement'));
      }
      for (let idx = 0; idx < 8; idx += 1) {
        fireEvent.press(getByTestId('noc-outcome-0-target-increment'));
      }
    });

    await waitFor(() => {
      const outcome = methods.getValues('outcomes')?.[0];
      expect(outcome?.baseline).toBe(1);
      expect(outcome?.target).toBe(5);
    });
  });

  it('requires explicit apply for AI NOC suggestions and logs the decision', async () => {
    const suggestInterventions = vi.fn().mockResolvedValue({
      section: 'outcomes' as const,
      interventions: [],
      outcomes: [
        {
          nocCode: '0402',
          nocDisplay: 'Estado respiratorio: permeabilidad de las vías aéreas',
          baseline: 2,
          target: 4,
        },
      ],
    });

    const { getByTestId, methods, queryByTestId } = renderWithForm({
      enableAiSuggestions: true,
      suggestInterventions,
      clinicalDecisionContext: { patientId: 'pat-001', unitId: 'icu-a' },
    });

    await act(async () => {
      fireEvent.press(getByTestId('noc-outcomes-suggest-button'));
    });

    await waitFor(() => {
      expect(getByTestId('noc-pending-suggestions')).toBeTruthy();
      expect(methods.getValues('outcomes')).toEqual([]);
    });

    fireEvent.press(getByTestId('noc-apply-suggestions'));

    await waitFor(() => {
      expect(queryByTestId('noc-pending-suggestions')).toBeNull();
      expect(methods.getValues('outcomes')).toHaveLength(1);
    });
    expect(logClinicalDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 'pat-001',
        unitId: 'icu-a',
        suggestionSource: 'ai_noc_suggestions',
        decision: 'applied',
        metadata: expect.objectContaining({
          section: 'outcomes',
          suggestionCount: 1,
          selectedCount: 1,
          selectedCodes: ['0402'],
          suggestionHashes: expect.any(Array),
        }),
      }),
    );
    const appliedMetadata = vi.mocked(logClinicalDecision).mock.calls.at(-1)?.[0]?.metadata;
    expect(appliedMetadata?.suggestionHashes).toHaveLength(1);
  });

  it('allows dismissing pending AI NOC suggestions', async () => {
    const suggestInterventions = vi.fn().mockResolvedValue({
      section: 'outcomes' as const,
      interventions: [],
      outcomes: [
        {
          nocCode: '0402',
          nocDisplay: 'Estado respiratorio: permeabilidad de las vías aéreas',
          baseline: 2,
          target: 4,
        },
      ],
    });

    const { getByTestId, queryByTestId, methods } = renderWithForm({
      enableAiSuggestions: true,
      suggestInterventions,
      clinicalDecisionContext: { patientId: 'pat-001', unitId: 'icu-a' },
    });

    await act(async () => {
      fireEvent.press(getByTestId('noc-outcomes-suggest-button'));
    });

    await waitFor(() => {
      expect(getByTestId('noc-dismiss-suggestions')).toBeTruthy();
    });

    fireEvent.press(getByTestId('noc-dismiss-suggestions'));

    await waitFor(() => {
      expect(queryByTestId('noc-pending-suggestions')).toBeNull();
      expect(methods.getValues('outcomes')).toEqual([]);
    });
    expect(logClinicalDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestionSource: 'ai_noc_suggestions',
        decision: 'dismissed',
        metadata: expect.objectContaining({
          section: 'outcomes',
          suggestionCount: 1,
          selectedCount: 0,
        }),
      }),
    );
    const dismissedMetadata = vi.mocked(logClinicalDecision).mock.calls.at(-1)?.[0]?.metadata;
    expect(dismissedMetadata).toBeDefined();
    expect(dismissedMetadata?.selectedCodes).toBeUndefined();
    expect(dismissedMetadata?.suggestionHashes).toBeUndefined();
  });
});
