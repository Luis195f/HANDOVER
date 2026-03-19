import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { FormProvider, useForm, type UseFormReturn } from 'react-hook-form';
import { describe, expect, it } from 'vitest';

import { BedsideChecklistSection } from '@/src/screens/components/BedsideChecklistSection';
import { DEFAULT_BEDSIDE_CHECKLIST_ITEMS } from '@/src/config/bedsideChecklist';
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
    linesAndDevicesChecked: true,
    medicationPlanReviewed: true,
    safetyMeasuresApplied: true,
    questionsAnswered: true,
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

describe('BedsideChecklistSection', () => {
  it('guarda el plan de contingencia en campos estructurados', async () => {
    const { getByLabelText, methods } = renderWithForm(
      <BedsideChecklistSection items={DEFAULT_BEDSIDE_CHECKLIST_ITEMS} />,
    );

    fireEvent.changeText(getByLabelText('Qué vigilar'), 'SatO2 < 92%\nDolor no controlado');
    fireEvent.changeText(getByLabelText('Qué hacer primero'), 'Valorar ABC\nRevisar perfusión');
    fireEvent.changeText(getByLabelText('Criterios de escalado'), 'Avisar si Glasgow baja');
    fireEvent.changeText(getByLabelText('Contacto de escalado'), 'Médico de guardia');
    fireEvent.changeText(getByLabelText('Plan de contingencia'), 'Preparar carro de parada y traslado si empeora');

    await waitFor(() => {
      expect(methods.getValues('contingencyPlan')).toEqual({
        watchItems: ['SatO2 < 92%', 'Dolor no controlado'],
        immediateActions: ['Valorar ABC', 'Revisar perfusión'],
        escalationCriteria: ['Avisar si Glasgow baja'],
        escalationContact: 'Médico de guardia',
        fallbackPlan: 'Preparar carro de parada y traslado si empeora',
      });
    });
  });
});
