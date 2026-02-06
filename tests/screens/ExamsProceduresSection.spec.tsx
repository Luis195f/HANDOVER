import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { FormProvider, useForm, type UseFormReturn } from 'react-hook-form';
import { describe, expect, it } from 'vitest';

import ExamsProceduresSection from '@/src/screens/components/ExamsProceduresSection';
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

describe('ExamsProceduresSection', () => {
  it('agrega exámenes y procedimientos a la lista', async () => {
    const { getByText, getByLabelText, methods } = renderWithForm(
      <ExamsProceduresSection />,
    );

    fireEvent.press(getByLabelText('Seleccionar tipo Laboratorio'));
    fireEvent.press(getByLabelText('Seleccionar estado Resultado'));
    fireEvent.changeText(getByLabelText('Descripción de examen'), 'Hemograma completo');
    fireEvent.press(getByLabelText('Añadir examen'));

    fireEvent.changeText(getByLabelText('Descripción de procedimiento'), 'Curación de herida');
    fireEvent(getByLabelText('Marcar procedimiento realizado'), 'valueChange', true);
    fireEvent.press(getByLabelText('Añadir procedimiento'));

    await waitFor(() => {
      expect(methods.getValues('exams')).toEqual([
        { type: 'laboratory', state: 'result', description: 'Hemograma completo' },
      ]);
      expect(methods.getValues('procedures')).toEqual([
        { description: 'Curación de herida', done: true },
      ]);
    });

    expect(getByText('Hemograma completo')).toBeTruthy();
    expect(getByText('Curación de herida')).toBeTruthy();
  });
});
