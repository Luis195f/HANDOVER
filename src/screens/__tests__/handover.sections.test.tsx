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

  it('muestra campos de horario al activar infusión continua', async () => {
    const methods = useForm<HandoverFormValues>({ defaultValues });
    const { getAllByRole, getByPlaceholderText, getByText } = render(
      <FormProvider {...methods}>
        <MedicationSection control={methods.control} />
      </FormProvider>,
    );

    fireEvent.press(getByText('Añadir medicación'));
    fireEvent(getAllByRole('switch')[0], 'valueChange', true);

    await waitFor(() => {
      expect(getByPlaceholderText('HH:MM inicio')).toBeTruthy();
      expect(getByPlaceholderText('HH:MM fin')).toBeTruthy();
    });
  });

  it('permite añadir y eliminar sin afectar otros elementos', async () => {
    const methods = useForm<HandoverFormValues>({ defaultValues });
    const { getByPlaceholderText, getByText, getAllByText, queryByText } = render(
      <FormProvider {...methods}>
        <MedicationSection control={methods.control} />
      </FormProvider>,
    );

    fireEvent.press(getByText('Añadir medicación'));
    fireEvent.changeText(getByPlaceholderText('Paracetamol'), 'Primera med');
    fireEvent.press(getByText('Guardar'));

    await waitFor(() => {
      expect(getByText('Primera med')).toBeTruthy();
    });

    fireEvent.press(getByText('Añadir medicación'));
    fireEvent.changeText(getByPlaceholderText('Paracetamol'), 'Segunda med');
    fireEvent.press(getByText('Guardar'));

    await waitFor(() => {
      expect(getByText('Segunda med')).toBeTruthy();
    });

    fireEvent.press(getAllByText('Eliminar')[1]);

    await waitFor(() => {
      expect(queryByText('Segunda med')).toBeNull();
      expect(getByText('Primera med')).toBeTruthy();
    });
  });

  it('mantiene el control de alto riesgo disponible', async () => {
    const methods = useForm<HandoverFormValues>({ defaultValues });
    const { getByText } = render(
      <FormProvider {...methods}>
        <MedicationSection control={methods.control} />
      </FormProvider>,
    );

    fireEvent.press(getByText('Añadir medicación'));

    await waitFor(() => {
      expect(getByText('Medicamento de alto riesgo')).toBeTruthy();
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
