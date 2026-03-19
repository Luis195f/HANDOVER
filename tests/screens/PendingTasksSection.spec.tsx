import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { FormProvider, useForm, type UseFormReturn } from 'react-hook-form';
import { describe, expect, it } from 'vitest';

import PendingTasksSection from '@/src/screens/components/PendingTasksSection';
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

describe('PendingTasksSection', () => {
  it('agrega reevaluaciones y criterios de escalado estructurados', async () => {
    const { getByLabelText, methods } = renderWithForm(<PendingTasksSection />);

    fireEvent.press(getByLabelText('Tipo pendiente Reevaluación'));
    fireEvent.press(getByLabelText('Prioridad pendiente Crítico'));
    fireEvent.changeText(getByLabelText('Detalle de pendiente'), 'Reevaluar Glasgow en 15 min');
    fireEvent.changeText(getByLabelText('Hora objetivo del pendiente'), '2026-03-19T10:15:00Z');
    fireEvent.changeText(getByLabelText('Responsable del pendiente'), 'Enfermera entrante');
    fireEvent.changeText(getByLabelText('Criterio de escalado del pendiente'), 'Avisar si Glasgow baja 2 puntos');
    fireEvent.changeText(getByLabelText('Notas del pendiente'), 'Paciente con sedación reciente');
    fireEvent.press(getByLabelText('Añadir pendiente'));

    await waitFor(() => {
      const task = methods.getValues('pendingTasks')?.[0];
      expect(task).toMatchObject({
        category: 'reevaluation',
        priority: 'critical',
        status: 'pending',
        title: 'Reevaluar Glasgow en 15 min',
        dueBy: '2026-03-19T10:15:00Z',
        owner: 'Enfermera entrante',
        escalationCriteria: 'Avisar si Glasgow baja 2 puntos',
        notes: 'Paciente con sedación reciente',
      });
      expect(task?.id).toMatch(/^task-/);
    });
  });
});
