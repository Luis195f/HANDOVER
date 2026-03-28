import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { FormProvider, useForm, type UseFormReturn } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as flagsModule from '@/src/config/flags';
import * as nicCatalogModule from '@/src/catalogs/nicCodes';
import TreatmentsSection from '../TreatmentsSection';
import type { HandoverValues as HandoverFormValues } from '@/src/validation/schemas';
import { logClinicalDecision } from '@/src/lib/clinical-decision-log';

vi.mock('@/src/lib/clinical-decision-log', () => ({
  logClinicalDecision: vi.fn(async () => undefined),
}));

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

  it('muestra el gate de licencia NIC y permite añadir desde el catálogo placeholder', async () => {
    const { getByTestId, getByText, methods } = renderWithForm({
      enableNicCoding: true,
    });

    expect(getByTestId('nic-license-warning')).toBeTruthy();
    expect(getByText('Licencia NIC requerida')).toBeTruthy();

    fireEvent.changeText(getByTestId('nic-catalog-search-input'), 'analgesicos');
    fireEvent.press(getByTestId('nic-catalog-suggestion-NIC-2210'));

    await waitFor(() => {
      expect(methods.getValues('treatments')).toHaveLength(1);
      expect(methods.getValues('treatments')[0]?.code?.code).toBe('2210');
    });
  });

  it('mantiene el catálogo local si no hay catálogo NIC licenciado', async () => {
    vi.spyOn(nicCatalogModule, 'loadNicCatalog').mockResolvedValue({
      ...nicCatalogModule.getNicPlaceholderCatalog(),
      source: 'backend-placeholder',
      licensed: false,
    });

    const { getByTestId, getByText } = renderWithForm({ enableNicCoding: true });

    await act(async () => {
      fireEvent.press(getByTestId('enable-full-nic-button'));
    });

    await waitFor(() => {
      expect(getByText('No hay un catálogo NIC licenciado configurado; se mantiene el catálogo local.')).toBeTruthy();
    });
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
      clinicalDecisionContext: { patientId: 'pat-001', unitId: 'icu-a' },
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
    expect(logClinicalDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        patientId: 'pat-001',
        unitId: 'icu-a',
        suggestionSource: 'ai_nic_suggestions',
        decision: 'applied',
        metadata: expect.objectContaining({
          section: 'treatments',
          suggestionCount: 4,
          selectedCount: 3,
          selectedCodes: ['2210'],
          suggestionHashes: expect.any(Array),
        }),
      }),
    );
    expect(logClinicalDecision).toHaveBeenLastCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          suggestionHashes: expect.arrayContaining([expect.any(String)]),
        }),
      }),
    );
    const appliedMetadata = vi.mocked(logClinicalDecision).mock.calls.at(-1)?.[0]?.metadata;
    expect(appliedMetadata?.suggestionHashes).toHaveLength(3);

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

  it('permite descartar el lote sugerido y registra decision dismissed', async () => {
    const suggestInterventions = vi.fn().mockResolvedValue({
      section: 'other' as const,
      interventions: ['NIC 2210: Administración de analgésicos', 'Vigilancia respiratoria'],
    });

    const { getByTestId, queryByTestId } = renderWithForm({
      enableNicCoding: true,
      suggestInterventions,
      clinicalDecisionContext: { patientId: 'pat-001', unitId: 'icu-a' },
    });

    await act(async () => {
      fireEvent.press(getByTestId('nic-suggest-button'));
    });

    await waitFor(() => {
      expect(getByTestId('nic-dismiss-suggestions')).toBeTruthy();
    });

    fireEvent.press(getByTestId('nic-dismiss-suggestions'));

    await waitFor(() => {
      expect(queryByTestId('nic-suggestions-list')).toBeNull();
    });
    expect(logClinicalDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestionSource: 'ai_nic_suggestions',
        decision: 'dismissed',
        metadata: expect.objectContaining({
          section: 'treatments',
          suggestionCount: 2,
          selectedCount: 0,
        }),
      }),
    );
    const dismissedMetadata = vi.mocked(logClinicalDecision).mock.calls.at(-1)?.[0]?.metadata;
    expect(dismissedMetadata).toBeDefined();
    expect(dismissedMetadata?.selectedCodes).toBeUndefined();
    expect(dismissedMetadata?.suggestionHashes).toBeUndefined();
  });
});
