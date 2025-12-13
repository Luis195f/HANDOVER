import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { FormProvider, useForm } from 'react-hook-form';
import { Button } from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { BedsideChecklistModal } from '@/src/screens/components/BedsideChecklistModal';
import { isBedsideChecklistComplete } from '@/src/screens/components/bedsideChecklist.constants';

const defaultValues = {
  administrativeData: {
    unit: 'icu',
    census: 0,
    staffIn: [],
    staffOut: [],
    shiftStart: '2024-01-01T00:00:00Z',
    shiftEnd: '2024-01-01T08:00:00Z',
    incidents: [],
  },
  patientId: 'pat-001',
  status: 'draft',
  bedsideChecklist: {
    patientIdentityConfirmed: false,
    allergiesReviewed: false,
    linesAndDevicesChecked: false,
    medicationPlanReviewed: false,
    safetyMeasuresApplied: false,
    questionsAnswered: false,
    bedsideNotes: '',
  },
  risks: {},
  risksStructured: [],
};

type HarnessProps = { onSubmit: (values: any) => void };

function Harness({ onSubmit }: HarnessProps) {
  const methods = useForm({ defaultValues });
  const [modalVisible, setModalVisible] = React.useState(false);

  const handleFinalize = () => {
    const checklist = methods.getValues('bedsideChecklist');
    if (!isBedsideChecklistComplete(checklist)) {
      setModalVisible(true);
      return;
    }
    methods.setValue('status', 'final', { shouldDirty: true, shouldValidate: true });
    onSubmit(methods.getValues());
  };

  return (
    <FormProvider {...methods}>
      <BedsideChecklistModal
        visible={modalVisible}
        onCancel={() => setModalVisible(false)}
        onConfirm={() => {
          setModalVisible(false);
          methods.setValue('status', 'final', { shouldDirty: true, shouldValidate: true });
          onSubmit(methods.getValues());
        }}
      />
      <Button title="Finalizar entrega" onPress={handleFinalize} />
    </FormProvider>
  );
}

describe.skip('BedsideChecklistModal', () => {
  it('no permite finalizar con checklist incompleto', async () => {
    const onSubmit = vi.fn();
    const { getByText, getByTestId, queryByText } = render(<Harness onSubmit={onSubmit} />);

    fireEvent.press(getByText('Finalizar entrega'));

    expect(getByTestId('bedsideChecklistModal')).toBeTruthy();

    fireEvent.press(getByText('Confirmar y finalizar'));

    await waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled();
      expect(queryByText('Completa el checklist de cabecera de cama antes de finalizar.')).not.toBeNull();
    });
  });

  it('permite finalizar cuando el checklist está completo', async () => {
    const onSubmit = vi.fn();
    const { getByText, getByLabelText, queryByTestId } = render(<Harness onSubmit={onSubmit} />);

    fireEvent.press(getByText('Finalizar entrega'));

    fireEvent(getByLabelText('Paciente identificado (nombre + pulsera)'), 'valueChange', true);
    fireEvent(getByLabelText('Alergias y alertas revisadas'), 'valueChange', true);
    fireEvent(getByLabelText('Líneas, catéteres y dispositivos verificados'), 'valueChange', true);
    fireEvent(getByLabelText('Plan de medicación y tratamientos verificado'), 'valueChange', true);
    fireEvent(getByLabelText('Medidas de seguridad aplicadas (barandillas, cama baja, etc.)'), 'valueChange', true);
    fireEvent(getByLabelText('Preguntas del equipo entrante resueltas'), 'valueChange', true);

    fireEvent.press(getByText('Confirmar y finalizar'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ status: 'final' }));
      expect(queryByTestId('bedsideChecklistModal')).toBeNull();
    });
  });
});
