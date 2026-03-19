import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { FormProvider, useForm, type UseFormReturn } from 'react-hook-form';
import { describe, expect, it } from 'vitest';

import TurnContextSection from '@/src/screens/components/TurnContextSection';
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
  outcomes: [],
  turnContext: {
    shiftPhase: undefined,
    workload: undefined,
    operationalSummary: '',
    serviceIncidents: [],
  },
  pendingTasks: [],
  exams: [],
  procedures: [],
  contingencyPlan: {
    watchItems: [],
    immediateActions: [],
    escalationCriteria: [],
    escalationContact: '',
    fallbackPlan: '',
  },
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

describe('TurnContextSection', () => {
  it('registra franja, carga e incidencias de servicio', async () => {
    const { getByLabelText, methods } = renderWithForm(<TurnContextSection />);

    fireEvent.press(getByLabelText('Franja operativa Inicio'));
    fireEvent.press(getByLabelText('Carga del turno Alta demanda'));
    fireEvent.changeText(getByLabelText('Resumen operativo del turno'), 'Turno con dos ingresos simultáneos');
    fireEvent.press(getByLabelText('Tipo incidencia Dotación'));
    fireEvent.press(getByLabelText('Severidad incidencia Alta'));
    fireEvent.changeText(getByLabelText('Detalle de incidencia de servicio'), 'Falta cobertura en sector B');
    fireEvent(getByLabelText('Incidencia resuelta'), 'valueChange', true);
    fireEvent.press(getByLabelText('Añadir incidencia de servicio'));

    await waitFor(() => {
      expect(methods.getValues('turnContext')).toEqual({
        shiftPhase: 'start',
        workload: 'high',
        operationalSummary: 'Turno con dos ingresos simultáneos',
        serviceIncidents: [
          {
            kind: 'staffing',
            severity: 'high',
            description: 'Falta cobertura en sector B',
            resolved: true,
          },
        ],
      });
    });
  });
});
