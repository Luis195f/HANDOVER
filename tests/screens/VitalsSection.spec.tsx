import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { FormProvider, useForm, type UseFormReturn } from 'react-hook-form';
import { describe, expect, it, vi } from 'vitest';

import { VitalsSection } from '@/src/components/handover/VitalsSection';
import { SNOMED_SYSTEM } from '@/src/data/snomed-dict';
import type { HandoverValues as HandoverFormValues } from '@/src/validation/schemas';

vi.mock('@/src/screens/components/VitalTrendsChart', () => ({
  VitalTrendsChart: () => null,
}));

vi.mock('@/src/components/VitalSignsChart', () => ({
  default: () => null,
}));

vi.mock('@/src/components/ClinicalSuggestions', () => ({
  default: () => null,
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
  exams: [],
  procedures: [],
  meds: '',
  devices: [],
  risksStructured: [],
  vitals: {},
};

const styles = {
  vitalsGrid: {},
  vitalsCell: {},
  field: {},
  label: {},
  input: {},
  error: {},
  vitalTrendsBlock: {},
  vitalTrendsError: {},
  riskBanner: {},
  riskHigh: {},
  riskModerate: {},
  riskLow: {},
  riskTitle: {},
  riskReason: {},
  inlineActions: {},
} as const;

const parseNumericInput = (value: string) => {
  if (!value) return undefined;
  const parsed = Number(value.replace(',', '.'));
  return Number.isNaN(parsed) ? undefined : parsed;
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

describe('VitalsSection', () => {
  it('captura timestamps ISO para signos vitales', async () => {
    const { getByPlaceholderText, methods } = renderWithForm(
      <VitalsSection
        styles={styles}
        parseNumericInput={parseNumericInput}
        riskEvaluation={{ level: 'low', reasons: [] }}
        loadingVitalTrends={false}
        vitalTrendsError={null}
        vitalTrends={null}
        aiSuggestionsEnabled={false}
        suggestionsState={{ vitals: null, diagnosis: null }}
        suggestionsLoading={null}
        suggestionsError={null}
        requestSuggestions={vi.fn()}
      />,
    );

    fireEvent.changeText(getByPlaceholderText('2024-01-01T08:00:00Z'), '2025-03-01T09:00:00Z');
    fireEvent.changeText(getByPlaceholderText('2024-01-01T08:05:00Z'), '2025-03-01T09:05:00Z');

    await waitFor(() => {
      expect(methods.getValues('vitals.recordedAt')).toBe('2025-03-01T09:00:00Z');
      expect(methods.getValues('vitals.issuedAt')).toBe('2025-03-01T09:05:00Z');
    });
  });

  it('permite seleccionar AVPU desde el selector', async () => {
    const { getByTestId, methods } = renderWithForm(
      <VitalsSection
        styles={styles}
        parseNumericInput={parseNumericInput}
        riskEvaluation={{ level: 'low', reasons: [] }}
        loadingVitalTrends={false}
        vitalTrendsError={null}
        vitalTrends={null}
        aiSuggestionsEnabled={false}
        suggestionsState={{ vitals: null, diagnosis: null }}
        suggestionsLoading={null}
        suggestionsError={null}
        requestSuggestions={vi.fn()}
      />,
    );

    fireEvent.press(getByTestId('vitals.avpu.trigger'));
    fireEvent.press(getByTestId('vitals.avpu.option.A'));

    await waitFor(() => {
      expect(methods.getValues('vitals.avpu')).toBe('A');
    });
  });
});
