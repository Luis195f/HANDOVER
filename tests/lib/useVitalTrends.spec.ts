// BEGIN HANDOVER D2 – VitalTrends tests
import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { useVitalTrends } from '@/src/lib/hooks/useVitalTrends';
import * as fhirClient from '@/src/lib/fhir-client';
import type { VitalTrendsData } from '../../types/vitals';

const mockTrends: VitalTrendsData = {
  hr: [
    { time: '2024-01-01T00:00:00Z', value: 80 },
    { time: '2024-01-01T01:00:00Z', value: 82 },
  ],
  sbp: [{ time: '2024-01-01T00:00:00Z', value: 120 }],
  rr: [{ time: '2024-01-01T00:00:00Z', value: 18 }],
  spo2: [{ time: '2024-01-01T00:00:00Z', value: 96 }],
  temp: [{ time: '2024-01-01T00:00:00Z', value: 37.1 }],
};

describe('useVitalTrends', () => {
  beforeEach(() => {
    vi.spyOn(fhirClient, 'fetchVitalTrends').mockResolvedValue(mockTrends);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const HookTester = ({
    patientId,
    onRender,
  }: {
    patientId: string | undefined;
    onRender: (state: ReturnType<typeof useVitalTrends>) => void;
  }) => {
    const state = useVitalTrends(patientId);
    onRender(state);
    return null;
  };

  it('devuelve data cuando fetchVitalTrends resuelve correctamente', async () => {
    const snapshots: Array<ReturnType<typeof useVitalTrends>> = [];

    await act(async () => {
      create(<HookTester patientId="patient-1" onRender={(state) => snapshots.push(state)} />);
      await Promise.resolve();
    });

    const last = snapshots.at(-1);
    expect(last?.loading).toBe(false);
    expect(last?.data).toEqual(mockTrends);
    expect(last?.error).toBeNull();
  });

  it('devuelve error cuando fetchVitalTrends lanza una excepción', async () => {
    vi.spyOn(fhirClient, 'fetchVitalTrends').mockRejectedValue(new Error('Boom'));
    const snapshots: Array<ReturnType<typeof useVitalTrends>> = [];

    await act(async () => {
      create(<HookTester patientId="patient-1" onRender={(state) => snapshots.push(state)} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    const last = snapshots.at(-1);
    expect(last?.loading).toBe(false);
    expect(last?.error).toBe('Boom');
    expect(last?.data).toBeNull();
  });

  it('no hace nada cuando patientId es undefined', async () => {
    const spy = vi.spyOn(fhirClient, 'fetchVitalTrends');
    const snapshots: Array<ReturnType<typeof useVitalTrends>> = [];

    await act(async () => {
      create(<HookTester patientId={undefined} onRender={(state) => snapshots.push(state)} />);
    });

    const last = snapshots.at(-1);
    expect(spy).not.toHaveBeenCalled();
    expect(last?.data).toBeNull();
    expect(last?.error).toBeNull();
    expect(last?.loading).toBe(false);
  });
});
// END HANDOVER D2 – VitalTrends tests
