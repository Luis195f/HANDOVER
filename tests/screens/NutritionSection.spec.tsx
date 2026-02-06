import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { FormProvider, useForm, type UseFormReturn } from 'react-hook-form';
import { describe, expect, it } from 'vitest';

import NutritionSection from '@/src/screens/components/NutritionSection';
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

describe('NutritionSection', () => {
  it('registra dieta, tolerancia e ingesta', async () => {
    const { getByTestId, getByPlaceholderText, methods } = renderWithForm(
      <NutritionSection parseNumber={parseNumber} />,
    );

    fireEvent.press(getByTestId('nutrition.dietType.trigger'));
    fireEvent.press(getByTestId('nutrition.dietType.option.oral'));
    fireEvent.changeText(getByPlaceholderText('Observaciones de tolerancia'), 'Buena');
    fireEvent.changeText(getByPlaceholderText('500'), '750');

    await waitFor(() => {
      expect(methods.getValues('nutrition')).toEqual({
        dietType: 'oral',
        tolerance: 'Buena',
        intakeMl: 750,
      });
    });
  });
});
