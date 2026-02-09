import { describe, it, expect } from 'vitest';
import { performance } from 'node:perf_hooks';

import { buildHandoverBundle } from '../fhir-map';
import baseValues from '../../../tests/fixtures/handover-values.json';

type Scenario = {
  label: string;
  medications: number;
  treatments: number;
  exams: number;
  procedures: number;
};

const makeMedication = (index: number) => ({
  id: `med-${index}`,
  name: `Medication ${index}`,
  route: 'iv' as const,
  dose: '500 mg',
  frequency: 'q8h',
});

const makeTreatment = (index: number) => ({
  id: `treatment-${index}`,
  type: 'other' as const,
  description: `Treatment ${index}`,
});

const makeExam = (index: number) => ({
  type: 'laboratory' as const,
  state: 'result' as const,
  description: `Exam ${index}`,
});

const makeProcedure = (index: number) => ({
  description: `Procedure ${index}`,
  done: true,
});

const buildScenarioInput = (scenario: Scenario) => ({
  ...(baseValues as Record<string, unknown>),
  vitals: {
    hr: 88,
    rr: 18,
    spo2: 96,
    temp: 37.2,
    sbp: 120,
    dbp: 75,
  },
  medications: Array.from({ length: scenario.medications }, (_, index) => makeMedication(index)),
  treatments: Array.from({ length: scenario.treatments }, (_, index) => makeTreatment(index)),
  exams: Array.from({ length: scenario.exams }, (_, index) => makeExam(index)),
  procedures: Array.from({ length: scenario.procedures }, (_, index) => makeProcedure(index)),
});

describe('buildHandoverBundle performance smoke test', () => {
  const scenarios: Scenario[] = [
    { label: 'small', medications: 5, treatments: 5, exams: 5, procedures: 5 },
    { label: 'medium', medications: 25, treatments: 15, exams: 10, procedures: 10 },
    { label: 'large', medications: 60, treatments: 40, exams: 25, procedures: 25 },
  ];

  it.each(scenarios)('builds %s scenarios without regressions', (scenario) => {
    const input = buildScenarioInput(scenario);
    const start = performance.now();
    const bundle = buildHandoverBundle(input as any);
    const durationMs = performance.now() - start;

    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.entry.length).toBeGreaterThan(0);
    expect(Number.isFinite(durationMs)).toBe(true);
  });
});
