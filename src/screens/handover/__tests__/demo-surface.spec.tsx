import React, { useState } from 'react';
import { TextInput } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { FormProvider, useForm } from 'react-hook-form';
import { describe, expect, it } from 'vitest';

import { CollapsibleSection } from '../../components/CollapsibleSection';
import { buildHandoverInputPayload } from '../submission';
import type { HandoverValues } from '@/src/validation/schemas';
import { SNOMED_SYSTEM } from '@/src/data/snomed-dict';

const defaultValues: HandoverValues = {
  administrativeData: {
    unit: 'sjd-a',
    census: 1,
    staffIn: ['Profesional receptora demo'],
    staffOut: ['Profesional saliente demo'],
    shiftStart: '2026-08-27T06:00:00.000Z',
    shiftEnd: '2026-08-27T14:00:00.000Z',
    shiftType: 'Mañana',
    incidents: [],
  },
  patientId: 'demo-psych-adult-001',
  status: 'draft',
  dxMedical: { system: SNOMED_SYSTEM, code: '31535000', display: 'Crisis de ansiedad' },
  dxNursing: '',
  dxMedicalStructured: [],
  dxNursingStructured: [],
  vitals: { hr: 84, rr: 18, spo2: 97, sbp: 118, tempC: 36.8, avpu: 'A' },
  medications: [
    {
      id: 'med-demo',
      name: 'Sertralina',
      dose: '50 mg',
      route: 'oral',
      frequency: '08:00',
      isContinuous: false,
      isContinuousInfusion: false,
    },
  ],
  devices: [{ name: 'Andador supervisado', active: true }],
  elimination: { urineMl: 450, stoolPattern: 'constipation', hasRectalTube: false },
  treatments: [],
  exams: [],
  procedures: [],
  risks: { fall: true },
  risksStructured: [{ type: 'fall', present: true, actions: ['Supervisión indicada.'] }],
  bedsideChecklist: {
    patientIdentityConfirmed: false,
    allergiesReviewed: false,
    linesAndDevicesChecked: false,
    medicationPlanReviewed: false,
    safetyMeasuresApplied: false,
    questionsAnswered: false,
  },
  attachments: [],
  meds: '',
};

function CollapsePayloadHarness({ onSerialized }: { onSerialized: (value: string) => void }) {
  const form = useForm<HandoverValues>({ defaultValues });
  const [collapsed, setCollapsed] = useState(true);

  return (
    <FormProvider {...form}>
      <CollapsibleSection title="Eliminación" isCollapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} lazy>
        <TextInput value={String(form.watch('elimination.urineMl') ?? '')} onChangeText={(value) => form.setValue('elimination.urineMl', Number(value))} />
      </CollapsibleSection>
      <TextInput testID="toggle-collapse" onFocus={() => setCollapsed((value) => !value)} />
      <TextInput testID="serialize" onFocus={() => onSerialized(JSON.stringify(buildHandoverInputPayload(form.getValues(), {})))} />
    </FormProvider>
  );
}

describe('demo clinical surface', () => {
  it('preserves canonical serialization when a prefilled section is collapsed', () => {
    const serializations: string[] = [];
    const screen = render(<CollapsePayloadHarness onSerialized={(value) => serializations.push(value)} />);

    fireEvent(screen.getByTestId('serialize'), 'focus');
    fireEvent(screen.getByTestId('toggle-collapse'), 'focus');
    fireEvent(screen.getByTestId('serialize'), 'focus');
    fireEvent(screen.getByTestId('toggle-collapse'), 'focus');
    fireEvent(screen.getByTestId('serialize'), 'focus');

    expect(serializations).toHaveLength(3);
    expect(serializations[1]).toBe(serializations[0]);
    expect(serializations[2]).toBe(serializations[0]);
    expect(serializations[0]).toContain('"elimination":{"urineMl":450');
  });
});
