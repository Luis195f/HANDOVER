import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { FormProvider, useForm, type UseFormReturn } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as flagsModule from '@/src/config/flags';
import TreatmentsSection from '../TreatmentsSection';
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
  dxMedical: null,
  dxNursing: '',
  dxMedicalStructured: [],
  dxNursingStructured: [],
  bedsideChecklist: {
    patientIdentityConfirmed: true,
    allergiesReviewed: true,
    linesAndDevicesChecked: false,
    medicationPlanReviewed: false,
    safetyMeasuresApplied: false,
    questionsAnswered: false,
    bedsideNotes: '',
  },
  medications: [],
  treatments: [],
  exams: [],
  procedures: [],
  meds: '',
  devices: [],
  risks: {},
  risksStructured: [],
  vitals: {},
  oxygenTherapy: {},
  evolution: '',
  closingSummary: '',
  sbarSituation: '',
  sbarBackground: '',
  sbarAssessment: '',
  sbarRecommendation: '',
  sbarFullText: '',
};

function renderWithForm(props?: Partial<React.ComponentProps<typeof TreatmentsSection>>) {
  let methodsReturn: UseFormReturn<HandoverFormValues> | undefined;

  function Wrapper() {
    const methods = useForm<HandoverFormValues>({ defaultValues });
    methodsReturn = methods;

    return (
      <FormProvider {...methods}>
        <TreatmentsSection control={methods.control} {...props} />
      </FormProvider>
    );
  }

  const utils = render(<Wrapper />);
  return { ...utils, methods: methodsReturn! };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TreatmentsSection NIC suggestions', () => {
  it('oculta el boton "Sugerir NIC" cuando la flag SHOW_NIC_CODING esta en off', () => {
    vi.spyOn(flagsModule, 'isOn').mockImplementation(() => false);

    const { queryByTestId } = renderWithForm();

    expect(queryByTestId('nic-suggest-button')).toBeNull();
  });

  it('sugerir -> seleccionar -> prefill mantiene tratamientos editables', async () => {
    const suggestInterventions = vi.fn().mockResolvedValue({
      section: 'other' as const,
      interventions: [
        'NIC 2210: Administración de analgésicos',
        'Vigilancia respiratoria',
        'Educacion al paciente',
        'Curacion avanzada de herida',
      ],
      rationale: 'Sugerencias de apoyo.',
    });

    const { getByTestId, getByText, getByPlaceholderText, methods } = renderWithForm({
      enableNicCoding: true,
      suggestInterventions,
    });

    await act(async () => {
      fireEvent.press(getByTestId('nic-suggest-button'));
    });

    await waitFor(() => {
      expect(suggestInterventions).toHaveBeenCalledTimes(1);
      expect(getByTestId('nic-apply-suggestions')).toBeTruthy();
    });

    fireEvent.press(getByTestId('nic-apply-suggestions'));

    await waitFor(() => {
      expect(methods.getValues('treatments')).toHaveLength(3);
    });

    const nicTreatment = methods.getValues('treatments').find((item) => item.code?.system === 'NIC');
    expect(nicTreatment?.code?.code).toBe('2210');
    expect((nicTreatment?.description ?? '').toLowerCase()).toContain('analg');

    await act(async () => {
      fireEvent.press(getByText('Editar'));
    });

    fireEvent.changeText(getByPlaceholderText('Ej: Cura de úlcera sacra'), 'Intervención ajustada por enfermería');
    fireEvent.press(getByText('Guardar'));

    await waitFor(() => {
      expect(methods.getValues('treatments')[0]?.description).toBe('Intervención ajustada por enfermería');
    });
  });
});

