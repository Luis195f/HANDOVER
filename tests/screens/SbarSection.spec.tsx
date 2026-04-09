import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';

import { SbarSection } from '@/src/screens/handover/SbarSection';
import { SNOMED_SYSTEM } from '@/src/data/snomed-dict';
import type { HandoverValues } from '@/src/validation/schemas';

const defaultValues: HandoverValues = {
  administrativeData: {
    unit: 'icu-a',
    census: 1,
    staffIn: [],
    staffOut: [],
    shiftStart: '2024-01-01T08:00:00Z',
    shiftEnd: '2024-01-01T20:00:00Z',
    shiftType: 'Manana',
    incidents: [],
  },
  patientId: 'pat-001',
  status: 'draft',
  dxMedical: { system: SNOMED_SYSTEM, code: '195967001', display: 'Neumonia' },
  dxNursing: { system: SNOMED_SYSTEM, code: '386661006', display: 'Fiebre' },
  dxMedicalStructured: [],
  dxNursingStructured: [],
  bedsideChecklist: {
    patientIdentityConfirmed: true,
    allergiesReviewed: true,
    linesAndDevicesChecked: false,
    medicationPlanReviewed: false,
    safetyMeasuresApplied: false,
    questionsAnswered: false,
  },
  medications: [],
  treatments: [],
  risksStructured: [],
  closingSummary: '',
};

const styles = {
  inlineActions: {},
  secondaryButton: {},
  helperText: {},
  dictationError: {},
  sbarPreview: {},
  sbarTitle: {},
  sbarText: {},
  field: {},
  label: {},
  input: {},
  textArea: {},
  error: {},
};

function renderSection() {
  const onAcceptPendingSbarSuggestion = vi.fn();
  const onRejectPendingSbarSuggestion = vi.fn();

  function Wrapper() {
    const methods = useForm<HandoverValues>({ defaultValues });
    return (
      <FormProvider {...methods}>
        <SbarSection
          styles={styles}
          aiSbarAvailable
          isRefiningSbarWithAI={false}
          aiSbarGenerationAvailable
          isGeneratingSbarWithAI={false}
          handleGenerateSbarWithAi={vi.fn()}
          handleGenerateSbarSuggestion={vi.fn()}
          handleRefineSbarWithAi={vi.fn()}
          pendingSbarSuggestionPreview={'S: Situacion\nB: Antecedentes\nA: Evaluacion\nR: Recomendacion'}
          onAcceptPendingSbarSuggestion={onAcceptPendingSbarSuggestion}
          onRejectPendingSbarSuggestion={onRejectPendingSbarSuggestion}
          sbarHelperMessage={null}
          sbarAiError={null}
        />
      </FormProvider>
    );
  }

  const utils = render(<Wrapper />);
  return { ...utils, onAcceptPendingSbarSuggestion, onRejectPendingSbarSuggestion };
}

describe('SbarSection', () => {
  it('muestra una revision humana explicita y permite aceptar o descartar', () => {
    const { getByText, onAcceptPendingSbarSuggestion, onRejectPendingSbarSuggestion } = renderSection();

    expect(getByText('Sugerencia SBAR en revisión humana')).toBeTruthy();

    fireEvent.press(getByText('Aceptar sugerencia'));
    fireEvent.press(getByText('Descartar sugerencia'));

    expect(onAcceptPendingSbarSuggestion).toHaveBeenCalledTimes(1);
    expect(onRejectPendingSbarSuggestion).toHaveBeenCalledTimes(1);
  });
});
