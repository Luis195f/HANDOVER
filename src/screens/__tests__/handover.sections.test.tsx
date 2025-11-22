import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { FormProvider, useForm } from 'react-hook-form';

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
  medications: [],
  treatments: [],
  meds: '',
};

describe('MedicationSection', () => {
  it('permite añadir una medicación a la lista', async () => {
    const methods = useForm<HandoverFormValues>({ defaultValues });
    const { getByText, getByPlaceholderText } = render(
      <FormProvider {...methods}>
        <MedicationSection control={methods.control} />
      </FormProvider>,
    );

    fireEvent.press(getByText('Añadir medicación'));

    fireEvent.changeText(getByPlaceholderText('Paracetamol'), 'Amoxicilina');
    fireEvent.changeText(getByPlaceholderText('1 g'), '500 mg');
    fireEvent.changeText(getByPlaceholderText('cada 8h'), 'cada 12h');
    fireEvent.press(getByText('Guardar'));

    await waitFor(() => {
      expect(getByText('Amoxicilina')).toBeTruthy();
    });
  });
});

describe('TreatmentsSection', () => {
  it('añade un tratamiento y muestra su estado', async () => {
    const methods = useForm<HandoverFormValues>({ defaultValues });
    const { getByText, getByPlaceholderText } = render(
      <FormProvider {...methods}>
        <TreatmentsSection control={methods.control} />
      </FormProvider>,
    );

    fireEvent.press(getByText('Añadir tratamiento no farmacológico'));
    fireEvent.press(getByText('Curación de heridas'));
    fireEvent.changeText(getByPlaceholderText('Ej: Cura de úlcera sacra'), 'Cura diaria');
    fireEvent.press(getByText('Guardar'));

    await waitFor(() => {
      expect(getByText('Curación de heridas')).toBeTruthy();
      expect(getByText(/Estado: En progreso/)).toBeTruthy();
    });
  });
});
