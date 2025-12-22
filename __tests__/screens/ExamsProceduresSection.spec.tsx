import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { FormProvider, useForm } from 'react-hook-form';
import { act } from 'react-test-renderer';

import ExamsProceduresSection from '../../src/screens/components/ExamsProceduresSection';
import type { HandoverValues as HandoverFormValues } from '@/src/validation/schemas';

const defaultValues: HandoverFormValues = {
  administrativeData: {
    unit: '',
    census: 0,
    staffIn: [],
    staffOut: [],
    shiftStart: '',
    shiftEnd: '',
    incidents: [],
  },
  patientId: 'pat-001',
  status: 'draft',
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
  risksStructured: [],
  risks: {},
};

describe('ExamsProceduresSection', () => {
  it('adds and removes exams updating the form array', async () => {
    let methods: ReturnType<typeof useForm<HandoverFormValues>> | null = null;

    function Wrapper() {
      methods = useForm<HandoverFormValues>({ defaultValues });
      return (
        <FormProvider {...methods}>
          <ExamsProceduresSection />
        </FormProvider>
      );
    }

    const { getByLabelText } = render(<Wrapper />);

    const addExamButton = getByLabelText('Añadir examen');
    await act(async () => {
      fireEvent.changeText(getByLabelText('Descripción de examen'), 'Hemograma completo');
    });
    await act(async () => {
      fireEvent.press(addExamButton);
    });

    expect(methods?.getValues('exams') ?? []).toHaveLength(1);

    await act(async () => {
      fireEvent.press(getByLabelText('Eliminar examen Hemograma completo'));
    });

    expect(methods?.getValues('exams') ?? []).toHaveLength(0);
  });

  it('adds and removes procedures updating the form array', async () => {
    let methods: ReturnType<typeof useForm<HandoverFormValues>> | null = null;

    function Wrapper() {
      methods = useForm<HandoverFormValues>({ defaultValues });
      return (
        <FormProvider {...methods}>
          <ExamsProceduresSection />
        </FormProvider>
      );
    }

    const { getByLabelText } = render(<Wrapper />);

    const addProcedureButton = getByLabelText('Añadir procedimiento');
    await act(async () => {
      fireEvent.changeText(getByLabelText('Descripción de procedimiento'), 'Curación');
    });
    await act(async () => {
      fireEvent.press(addProcedureButton);
    });

    expect(methods?.getValues('procedures') ?? []).toHaveLength(1);

    await act(async () => {
      fireEvent.press(getByLabelText('Eliminar procedimiento Curación'));
    });

    expect(methods?.getValues('procedures') ?? []).toHaveLength(0);
  });
});
