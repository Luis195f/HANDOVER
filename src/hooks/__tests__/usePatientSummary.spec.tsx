import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePatientSummary } from '../usePatientSummary';

const fetchPatientSummaryMock = vi.fn();

vi.mock('@/src/lib/fhir-client', () => ({
  fetchPatientSummary: (...args: unknown[]) => fetchPatientSummaryMock(...args),
}));

type State = ReturnType<typeof usePatientSummary>;

const TestComponent = ({ patientId }: { patientId?: string }) => {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const state = usePatientSummary(patientId);
  (TestComponent as any).state = state as State;
  return null;
};

describe('usePatientSummary (FHIR)', () => {
  beforeEach(() => {
    fetchPatientSummaryMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retorna el resumen completo y actualiza loading', async () => {
    fetchPatientSummaryMock.mockResolvedValue({
      id: 'p-1',
      name: 'Ana Pérez',
      gender: 'female',
      age: 40,
      bed: '12B',
      mrn: 'MRN-1',
      allergies: ['Penicilina'],
    });

    await act(async () => {
      create(<TestComponent patientId="p-1" />);
    });

    const initialState = (TestComponent as any).state as State;
    expect(initialState.loading).toBe(true);

    await act(async () => {
      await Promise.resolve();
    });

    const state = (TestComponent as any).state as State;
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.summary?.name).toBe('Ana Pérez');
    expect(state.summary?.bed).toBe('12B');
    expect(fetchPatientSummaryMock).toHaveBeenCalledWith('p-1');
  });

  it('devuelve error cuando fetch falla', async () => {
    fetchPatientSummaryMock.mockRejectedValue(new Error('falló'));

    await act(async () => {
      create(<TestComponent patientId="p-2" />);
    });

    await act(async () => {
      await Promise.resolve();
    });

    const state = (TestComponent as any).state as State;
    expect(state.loading).toBe(false);
    expect(state.summary).toBeNull();
    expect(state.error).toBe('falló');
  });
});
