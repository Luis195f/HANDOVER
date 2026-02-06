import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { FormProvider, useForm, type UseFormReturn } from 'react-hook-form';
import { describe, expect, it } from 'vitest';

import MobilitySkinSection from '@/src/screens/components/MobilitySkinSection';
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

describe('MobilitySkinSection', () => {
  it('registra nivel de movilidad, plan y estado de piel', async () => {
    const { getByPlaceholderText, getByTestId, getByLabelText, methods } = renderWithForm(
      <MobilitySkinSection />,
    );

    fireEvent.press(getByTestId('mobility.mobilityLevel.trigger'));
    fireEvent.press(getByTestId('mobility.mobilityLevel.option.assisted'));
    fireEvent.changeText(getByPlaceholderText('Ej: cada 2 horas'), 'Cada 2h');
    fireEvent.changeText(getByPlaceholderText('Ej: Íntegra'), 'Lesión sacra');
    fireEvent(getByLabelText('Úlcera por presión'), 'valueChange', true);

    await waitFor(() => {
      expect(methods.getValues('mobility')).toEqual({
        mobilityLevel: 'assisted',
        repositioningPlan: 'Cada 2h',
      });
      expect(methods.getValues('skin')).toEqual({
        skinStatus: 'Lesión sacra',
        hasPressureInjury: true,
      });
    });
  });
});
