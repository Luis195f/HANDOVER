import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { FormProvider, useForm, type UseFormReturn } from 'react-hook-form';

import OutcomesSection from '../OutcomesSection';
import type { HandoverValues as HandoverFormValues } from '@/src/validation/schemas';
import { SNOMED_SYSTEM } from '@/src/data/snomed-dict';

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
});

