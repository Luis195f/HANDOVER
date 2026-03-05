import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { FormProvider, useForm } from 'react-hook-form';
import { View, Text } from 'react-native';

import SafetySection from '../SafetySection';
import { computeAlerts } from '@/src/lib/alerts';
import type { HandoverValues } from '@/src/validation/schemas';
import { SNOMED_SYSTEM } from '@/src/data/snomed-dict';

const defaultValues: HandoverValues = {
  administrativeData: {
    unit: 'icu-a',
    census: 0,
    staffIn: [],
    staffOut: [],
    shiftStart: '2024-01-01T08:00:00.000Z',
    shiftEnd: '2024-01-01T16:00:00.000Z',
    shiftType: 'Mañana',
    incidents: [],
  },
  attachments: [],
  patientId: 'pat-001',
  status: 'draft',
  dxMedical: { system: SNOMED_SYSTEM, code: '195967001', display: 'Neumonía' },

  // ✅ dxNursing ahora es texto legado
  dxNursing: 'Fiebre',

  medications: [],
  treatments: [],
  exams: [],
  procedures: [],
  devices: [],
  meds: '',
  risks: {},
  risksStructured: [],
  bedsideChecklist: {
    patientIdentityConfirmed: true,
    allergiesReviewed: true,
    linesAndDevicesChecked: false,
    medicationPlanReviewed: false,
    safetyMeasuresApplied: false,
    questionsAnswered: false,
  },
};

function Wrapper() {
  const methods = useForm<HandoverValues>({ defaultValues });
  const alerts = computeAlerts(methods.watch());
  return (
    <FormProvider {...methods}>
      <SafetySection control={methods.control} watch={methods.watch} />
      <View>
        {alerts.map((alert) => (
          <Text key={alert.id}>{alert.message}</Text>
        ))}
      </View>
    </FormProvider>
  );
}

describe('SafetySection', () => {
  it('activa riesgo de caídas y muestra checklist y alerta', async () => {
    const { getByLabelText, getByText } = render(<Wrapper />);

    fireEvent(getByLabelText('Paciente con riesgo de caídas'), 'valueChange', true);

    await waitFor(() => {
      expect(getByText('Barandillas elevadas')).toBeTruthy();
      expect(getByText(/Riesgo de caídas marcado/)).toBeTruthy();
    });
  });

  it('elimina alerta de caídas al registrar acciones preventivas', async () => {
    const { getByLabelText, getByText, queryByText } = render(<Wrapper />);

    fireEvent(getByLabelText('Paciente con riesgo de caídas'), 'valueChange', true);
    fireEvent.press(getByText('Barandillas elevadas'));

    await waitFor(() => {
      expect(queryByText(/Riesgo de caídas marcado/)).toBeNull();
    });
  });
});
