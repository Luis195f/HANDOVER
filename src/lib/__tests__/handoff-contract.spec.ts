import { describe, expect, it } from 'vitest';

import { DEMO_EXCEPTION_HANDOVER_PATIENTS } from '@/src/demo/fixtures';
import { buildExceptionHandoffContract, HANDOFF_FHIR_CAPABILITY_MATRIX } from '../handoff-contract';
import { classifyExceptionHandoverPatient } from '../exception-handover';

const NOW = '2026-08-27T08:15:00.000Z';
const byStatus = (status: 'critical' | 'changed' | 'unchanged') => {
  const patient = DEMO_EXCEPTION_HANDOVER_PATIENTS.find((candidate) => candidate.status === status);
  if (!patient) throw new Error(`Missing ${status} fixture`);
  return classifyExceptionHandoverPatient(patient, { now: NOW });
};

describe('exception handoff internal/FHIR contract', () => {
  it('documents future resource correspondence without claiming mapper support', () => {
    expect(HANDOFF_FHIR_CAPABILITY_MATRIX).toEqual([
      { internal: 'HandoffCommunication', fhir: 'Communication', status: 'pending' },
      { internal: 'HandoffProvenance', fhir: 'Provenance', status: 'pending' },
      { internal: 'HandoffAudit', fhir: 'AuditEvent', status: 'pending' },
      { internal: 'HandoffTask', fhir: 'Task', status: 'pending' },
      { internal: 'HandoffSummary', fhir: 'Composition', status: 'supported-core-form-only' },
      { internal: 'PerformedAssessment', fhir: 'Observation', status: 'supported-core-form-only' },
    ]);
  });

  it('models A/B communication but emits no resources from the demo seam', () => {
    expect(buildExceptionHandoffContract(byStatus('critical'))).toMatchObject({
      communication: { lane: 'A', checkBackRequired: true, preliminary: true },
      productiveFhirResources: [],
    });
    expect(buildExceptionHandoffContract(byStatus('changed'))).toMatchObject({
      communication: { lane: 'B', checkBackRequired: false, preliminary: true },
      productiveFhirResources: [],
    });
  });

  it('emits no per-patient Composition, Observation, evolution or signature for C', () => {
    const contract = buildExceptionHandoffContract(byStatus('unchanged'));
    expect(contract).toEqual({ communication: null, tasks: [], individualSummary: null, productiveFhirResources: [] });
  });

  it('represents R only as review tasks and never as a complete clinical SBAR/resource', () => {
    const base = DEMO_EXCEPTION_HANDOVER_PATIENTS.find((patient) => patient.status === 'unchanged');
    if (!base) throw new Error('Missing C fixture');
    const r = classifyExceptionHandoverPatient({
      ...base,
      sourceEvidence: { ...base.sourceEvidence, 'direct-assessment': { status: 'missing' } },
    }, { now: NOW });
    const contract = buildExceptionHandoffContract(r);

    expect(contract.communication).toBeNull();
    expect(contract.tasks[0]).toMatchObject({ kind: 'HandoffTask', status: 'pending' });
    expect(contract.individualSummary).toBeNull();
    expect(contract.productiveFhirResources).toEqual([]);
  });
});
