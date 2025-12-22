import React from 'react';
import { act } from 'react-test-renderer';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { FormProvider, useForm, type UseFormReturn } from 'react-hook-form';

import MedicationSection from '../components/MedicationSection';
import TreatmentsSection from '../components/TreatmentsSection';
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
  devices: [],
  risksStructured: [],
};

function renderWithForm<T extends { control: unknown }>(
  Component: React.ComponentType<T>,
  defaultValues: HandoverFormValues,
  props?: Omit<T, 'control'>,
) {
  let methodsReturn: UseFormReturn<HandoverFormValues> | undefined;
  function Wrapper() {
    const methods = useForm<HandoverFormValues>({ defaultValues });
    methodsReturn = methods;
    return (
      <FormProvider {...methods}>
        <Component {...(props as T)} control={methods.control as any} />
      </FormProvider>
    );
  }
  const result = render(<Wrapper />);
  return { ...result, methods: methodsReturn! };
}

describe('MedicationSection', () => {
  it('permite añadir una medicación a la lista', async () => {
    const { getByText, methods } = renderWithForm(MedicationSection, defaultValues);

    await act(async () => {
      methods.reset({
        ...defaultValues,
        medications: [
          {
            id: 'med-1',
            name: 'Amoxicilina',
            dose: '500 mg',
            route: 'oral',
            frequency: 'cada 12h',
            isHighAlert: false,
          },
        ],
      });
    });

    await waitFor(() => {
      expect(getByText('Amoxicilina')).toBeTruthy();
    });
  });

  it('muestra campos de horario al activar infusión continua', async () => {
    const { getAllByRole, getByPlaceholderText, getByText } = renderWithForm(
      MedicationSection,
      defaultValues,
    );

    fireEvent.press(getByText('Añadir medicación'));
    fireEvent(getAllByRole('switch')[0], 'valueChange', true);

    await waitFor(() => {
      expect(getByPlaceholderText('HH:MM inicio')).toBeTruthy();
      expect(getByPlaceholderText('HH:MM fin')).toBeTruthy();
    });
  });

  it('permite añadir y eliminar sin afectar otros elementos', async () => {
    const { getByText, queryByText, methods } = renderWithForm(MedicationSection, defaultValues);

    await act(async () => {
      methods.reset({
        ...defaultValues,
        medications: [
          { id: 'med-1', name: 'Primera med', dose: '1 g', route: 'oral', frequency: 'c/8h' },
          { id: 'med-2', name: 'Segunda med', dose: '500 mg', route: 'oral', frequency: 'c/12h' },
        ],
      });
    });

    await waitFor(() => {
      expect(getByText('Primera med')).toBeTruthy();
      expect(getByText('Segunda med')).toBeTruthy();
    });

    await act(async () => {
      methods.reset({
        ...defaultValues,
        medications: [{ id: 'med-1', name: 'Primera med', dose: '1 g', route: 'oral', frequency: 'c/8h' }],
      });
    });

    await waitFor(() => {
      expect(queryByText('Segunda med')).toBeNull();
      expect(getByText('Primera med')).toBeTruthy();
    });
  });

  it('mantiene el control de alto riesgo disponible', async () => {
    const { getByText } = renderWithForm(MedicationSection, defaultValues);

    fireEvent.press(getByText('Añadir medicación'));

    await waitFor(() => {
      expect(getByText('Medicamento de alto riesgo')).toBeTruthy();
    });
  });
});

describe('TreatmentsSection', () => {
  it('añade un tratamiento y muestra su estado', async () => {
    const { getByText, methods } = renderWithForm(TreatmentsSection, defaultValues);

    await act(async () => {
      methods.setValue('treatments', [
        { id: 'tx-1', type: 'woundCare', description: 'Cura diaria', done: false },
      ]);
    });

    await waitFor(() => {
      expect(getByText('Curación de heridas')).toBeTruthy();
      expect(getByText(/Estado: En progreso/)).toBeTruthy();
    });
  });
});
