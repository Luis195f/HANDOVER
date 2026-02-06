import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { FormProvider, useForm, type UseFormReturn } from 'react-hook-form';
import { describe, expect, it } from 'vitest';

import FluidBalanceSection from '@/src/screens/components/FluidBalanceSection';
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

describe('FluidBalanceSection', () => {
  it('calcula balance neto y guarda notas', async () => {
    const { getByPlaceholderText, getByTestId, methods } = renderWithForm(
      <FluidBalanceSection parseNumber={parseNumber} />,
    );

    fireEvent.changeText(getByPlaceholderText('1000'), '1500');
    fireEvent.changeText(getByPlaceholderText('900'), '1100');
    fireEvent.changeText(
      getByPlaceholderText('Balance positivo +1500 ml, vigilar edema'),
      'Balance positivo +400',
    );

    await waitFor(() => {
      expect(getByTestId('fluidBalance.netBalanceDisplay').props.value).toBe('+400 mL');
      expect(methods.getValues('fluidBalance')).toMatchObject({
        intakeMl: 1500,
        outputMl: 1100,
        netBalanceMl: 400,
        notes: 'Balance positivo +400',
      });
    });
  });
});
