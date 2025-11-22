import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePatientSummary } from '../usePatientSummary';

type PatientResource = {
  resourceType: 'Patient';
  id?: string;
  birthDate?: string;
  name?: Array<{ family?: string; given?: string[]; text?: string }>;
  identifier?: Array<{ system?: string; type?: { text?: string }; value?: string }>;
};

const fetchFHIRMock = vi.fn();

vi.mock('@/src/lib/fhir-client', () => ({
  fetchFHIR: (...args: unknown[]) => fetchFHIRMock(...args),
}));

type State = ReturnType<typeof usePatientSummary>;

const TestComponent = ({ patientId }: { patientId?: string }) => {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const state = usePatientSummary(patientId);
  (TestComponent as any).state = state as State;
  return null;
};

describe('usePatientSummary', () => {
  beforeEach(() => {
    fetchFHIRMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('mapea correctamente un paciente completo', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-15T00:00:00Z'));

    const patient: PatientResource = {
      resourceType: 'Patient',
      id: 'p-1',
      birthDate: '1984-06-10',
      name: [{ given: ['Ana', 'Luisa'], family: 'Pérez' }],
      identifier: [{ system: 'bed-system', value: '12B', type: { text: 'Cama' } }],
    };

    fetchFHIRMock.mockResolvedValue({ ok: true, data: patient });

    await act(async () => {
      create(<TestComponent patientId="p-1" />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    const state = (TestComponent as any).state as State;
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.summary?.displayName).toBe('Ana Luisa Pérez');
    expect(state.summary?.ageLabel).toBe('Edad 40 años');
    expect(state.summary?.bedLabel).toBe('Cama 12B');
  });

  it('devuelve edad desconocida cuando falta birthDate', async () => {
    const patient: PatientResource = {
      resourceType: 'Patient',
      id: 'p-2',
      name: [{ text: 'Paciente Demo' }],
    };

    fetchFHIRMock.mockResolvedValue({ ok: true, data: patient });

    await act(async () => {
      create(<TestComponent patientId="p-2" />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    const state = (TestComponent as any).state as State;
    expect(state.summary?.ageLabel).toBe('Edad desconocida');
    expect(state.summary?.displayName).toContain('Paciente');
  });

  it('retorna fallback seguro cuando ocurre un error', async () => {
    fetchFHIRMock.mockRejectedValue(new Error('404'));

    await act(async () => {
      create(<TestComponent patientId="p-3" />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    const state = (TestComponent as any).state as State;
    expect(state.error).toBeTruthy();
    expect(state.summary?.displayName).toBe('Paciente #p-3');
    expect(state.summary?.bedLabel).toBe('Cama no registrada');
  });
});
