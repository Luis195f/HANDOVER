import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { FormProvider, useForm, type UseFormReturn } from 'react-hook-form';
import { describe, expect, it } from 'vitest';

import EliminationSection from '@/src/screens/components/EliminationSection';
import { SNOMED_SYSTEM } from '@/src/data/snomed-dict';
import type { HandoverValues as HandoverFormValues } from '@/src/validation/schemas';

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
  dxNursing: { system: SNOMED_SYSTEM, code: '386661006', display: 'Fiebre' },
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
  exams: [],
  procedures: [],
  meds: '',
  devices: [],
  risksStructured: [],
};

const parseNumber = (value: string) => {
  if (!value) return undefined;
  const parsed = Number(value.replace(',', '.'));
  return Number.isNaN(parsed) ? undefined : parsed;
};

function renderWithForm(children: React.ReactNode) {
  let methodsReturn: UseFormReturn<HandoverFormValues> | undefined;

  function Wrapper() {
    const methods = useForm<HandoverFormValues>({ defaultValues });
    methodsReturn = methods;
    return <FormProvider {...methods}>{children}</FormProvider>;
  }

  const result = render(<Wrapper />);
  return { ...result, methods: methodsReturn! };
}

describe('EliminationSection', () => {
  it('registra diuresis, patrón deposicional y sonda rectal', async () => {
    const { getByPlaceholderText, getByTestId, getByLabelText, methods } = renderWithForm(
      <EliminationSection parseNumber={parseNumber} />,
    );

    fireEvent.changeText(getByPlaceholderText('800'), '950');
    fireEvent.press(getByTestId('elimination.stoolPattern.trigger'));
    fireEvent.press(getByTestId('elimination.stoolPattern.option.diarrhea'));
    fireEvent(getByLabelText('Sonda rectal'), 'valueChange', true);

    await waitFor(() => {
      expect(methods.getValues('elimination')).toEqual({
        urineMl: 950,
        stoolPattern: 'diarrhea',
        hasRectalTube: true,
      });
    });
  });
});
