import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { FormProvider, useForm } from 'react-hook-form';
import { Button } from 'react-native';
import { zodResolver } from '@hookform/resolvers/zod';
import { describe, expect, it, vi } from 'vitest';

import { BedsideChecklistSection } from '../../src/screens/components/BedsideChecklistSection';
import { zHandover } from '@/src/validation/schemas';
import { SNOMED_SYSTEM } from '@/src/data/snomed-dict';

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
  dxMedical: { system: SNOMED_SYSTEM, code: '195967001', display: 'Neumonía' },
  dxNursing: { system: SNOMED_SYSTEM, code: '386661006', display: 'Fiebre' },
  dxMedicalStructured: [],
  dxNursingStructured: [],
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

function buildWrapper(options = {}) {
  function Wrapper() {
    const methods = useForm({
      defaultValues,
      resolver: options.withResolver ? zodResolver(zHandover) : undefined,
    });

    return React.createElement(
      FormProvider,
      { ...methods },
      React.createElement(
        React.Fragment,
        null,
        React.createElement(BedsideChecklistSection, null),
        options.onSubmit
          ? React.createElement(Button, {
              title: 'Enviar',
              onPress: methods.handleSubmit(options.onSubmit, () => undefined),
            })
          : null,
      ),
    );
  }

  return React.createElement(Wrapper);
}

describe('BedsideChecklistSection', () => {
  it('actualiza el estado del formulario al alternar los switches', () => {
    let methods = null;
    function Wrapper() {
      methods = useForm({ defaultValues });
      return React.createElement(
        FormProvider,
        { ...methods },
        React.createElement(BedsideChecklistSection, null),
      );
    }

    const { getByLabelText } = render(React.createElement(Wrapper));

    fireEvent(getByLabelText('Paciente identificado (nombre + pulsera)'), 'valueChange', true);
    fireEvent(getByLabelText('Alergias y alertas revisadas'), 'valueChange', true);

    expect(methods?.getValues('bedsideChecklist.patientIdentityConfirmed')).toBe(true);
    expect(methods?.getValues('bedsideChecklist.allergiesReviewed')).toBe(true);
  });

  it('bloquea el submit cuando no se confirman identidad y alergias', async () => {
    const onValid = vi.fn();
    const { getByText, findByText } = render(buildWrapper({ withResolver: true, onSubmit: onValid }));

    fireEvent.press(getByText('Enviar'));

    await waitFor(async () => {
      expect(onValid).not.toHaveBeenCalled();
      const error = await findByText(
        'Confirma la identidad del paciente y revisa las alergias antes de cerrar el pase de turno.',
      );
      expect(error).toBeTruthy();
    });
  });

  it('permite enviar cuando los ítems críticos están marcados', async () => {
    const onValid = vi.fn();
    const { getByLabelText, getByText, queryByText } = render(
      buildWrapper({ withResolver: true, onSubmit: onValid }),
    );

    fireEvent(getByLabelText('Paciente identificado (nombre + pulsera)'), 'valueChange', true);
    fireEvent(getByLabelText('Alergias y alertas revisadas'), 'valueChange', true);

    fireEvent.press(getByText('Enviar'));

    await waitFor(() => {
      expect(onValid).toHaveBeenCalled();
      expect(
        queryByText('Confirma la identidad del paciente y revisa las alergias antes de cerrar el pase de turno.'),
      ).toBeNull();
    });
  });
});
