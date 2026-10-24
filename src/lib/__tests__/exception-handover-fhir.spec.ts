import { sha256 } from 'js-sha256';
import { describe, expect, it } from 'vitest';
import candidateFixture from '../../../tests/fixtures/fhir/exception-handover-candidate-bundle.json';

import { DEMO_ACTORS, DEMO_EXCEPTION_HANDOVER_PATIENTS } from '@/src/demo/fixtures';
import { validateBundle } from '@/src/lib/fhir-validation';
import { buildExceptionHandoverFhirCandidate } from '../exception-handover-fhir';
import {
  buildExceptionHandoverContextKey,
  classifyExceptionHandoverPatient,
  createExceptionReviewEvent,
} from '../exception-handover';
import { HANDOFF_FHIR_CAPABILITY_MATRIX } from '../handoff-contract';

const SHIFT = 'synthetic-shift';
const NOW = '2026-08-27T08:15:00.000Z';
const OUTGOING_AT = '2026-08-27T08:20:00.000Z';
const INCOMING_AT = '2026-08-27T08:25:00.000Z';
const SUMMARY = 'Resumen sintético confirmado';

function fixture(patientId: string) {
  const patient = DEMO_EXCEPTION_HANDOVER_PATIENTS.find((candidate) => candidate.patientId === patientId);
  if (!patient) throw new Error('Missing synthetic fixture');
  return patient;
}

function candidateInput() {
  const critical = classifyExceptionHandoverPatient(fixture('demo-psych-adult-001'), { now: NOW });
  const changed = classifyExceptionHandoverPatient(fixture('demo-psych-child-001'), { now: NOW });
  const unchanged = classifyExceptionHandoverPatient(fixture('demo-psych-adult-002'), { now: NOW });
  const review = classifyExceptionHandoverPatient({
    ...fixture('demo-psych-unit-010'),
    sourceEvidence: { ...fixture('demo-psych-unit-010').sourceEvidence, 'direct-assessment': { status: 'missing' } },
  }, { now: NOW });
  const classifications = [critical, changed, unchanged, review];
  const members = classifications.map(({ patientId }) => ({ patientId, unitId: 'unit-a' }));
  const viewScope = 'unit-a';
  const context = {
    shiftId: SHIFT,
    key: buildExceptionHandoverContextKey(SHIFT, viewScope, members, classifications),
    revision: 1,
  };
  const reviewDetails = { shiftId: SHIFT, context };
  const events = [
    createExceptionReviewEvent('critical_check_back', DEMO_ACTORS[1], NOW, critical.patientId,
      { ...reviewDetails, criticalPoints: ['Riesgo sintético'] }),
    createExceptionReviewEvent('brief_review', DEMO_ACTORS[1], NOW, changed.patientId, reviewDetails),
    createExceptionReviewEvent('unchanged_group_review', DEMO_ACTORS[0], NOW, undefined, reviewDetails),
    createExceptionReviewEvent('r_transferred', DEMO_ACTORS[1], NOW, review.patientId,
      { ...reviewDetails, reason: 'Fuente pendiente', targetAt: INCOMING_AT, receiverId: DEMO_ACTORS[1].userId }),
  ];
  const outgoing = createExceptionReviewEvent('outgoing_transfer', DEMO_ACTORS[0], OUTGOING_AT, undefined, reviewDetails);
  events.push(outgoing);
  events.push(createExceptionReviewEvent('incoming_attestation', DEMO_ACTORS[1], INCOMING_AT, undefined,
    { ...reviewDetails, acknowledgesKey: outgoing.idempotencyKey }));
  return {
    context, viewScope, members, classifications, events, unitHealth: 'healthy' as const,
    summary: {
      text: SUMMARY,
      provenance: {
        source: 'external-ai' as const,
        contentHash: sha256(SUMMARY),
        acceptedBy: DEMO_ACTORS[0].userId,
        acceptedAt: OUTGOING_AT,
        decisionHash: sha256('synthetic decision'),
        version: 'synthetic-version',
      },
    },
  };
}

describe('exception handover FHIR candidate, isolated from runtime', () => {
  it('keeps a stable, round-trippable transaction with group, actors, tasks and C08 provenance', () => {
    const input = candidateInput();
    const original = structuredClone(input);
    const bundle = buildExceptionHandoverFhirCandidate(input);
    const copy = JSON.parse(JSON.stringify(bundle));
    expect(input).toEqual(original);
    expect(copy).toEqual(bundle);
    expect(buildExceptionHandoverFhirCandidate(input)).toEqual(bundle);
    expect(validateBundle(copy)).toEqual({ isValid: true, errors: [] });
    expect(bundle).toMatchObject({ resourceType: 'Bundle', type: 'transaction' });
    expect(bundle.entry.map(({ resource }) => resource.resourceType)).toEqual(expect.arrayContaining([
      'Group', 'Patient', 'Practitioner', 'Communication', 'Task', 'Observation', 'Composition',
    ]));
    expect(bundle.entry.filter(({ resource }) => resource.resourceType === 'Group')).toHaveLength(1);
    expect(bundle.entry.filter(({ resource }) => resource.resourceType === 'Composition')).toHaveLength(1);
    expect(bundle.entry.filter(({ resource }) => resource.resourceType === 'Task').length).toBeGreaterThan(0);
    expect(bundle.entry.filter(({ resource }) => resource.resourceType === 'Communication')).toHaveLength(6);
    expect(bundle).not.toHaveProperty('signature');
    expect(bundle.entry.every(({ resource, request }) => request.method === 'POST' && request.url === resource.resourceType)).toBe(true);
    expect(bundle.entry.find(({ resource }) => resource.resourceType === 'Group')).toMatchObject({
      resource: { actual: true, type: 'person', member: expect.arrayContaining([
        expect.objectContaining({ entity: expect.any(Object), extension: [expect.objectContaining({ valueIdentifier: {
          system: 'urn:handover:unit-id', value: 'unit-a',
        } })] }),
      ]) },
    });
    expect(bundle.entry.find(({ resource }) => resource.resourceType === 'Task')).toMatchObject({
      resource: { status: 'requested', intent: 'proposal', for: expect.any(Object), authoredOn: expect.any(String) },
    });
    expect(bundle.entry.find(({ resource }) => resource.resourceType === 'Observation')).toMatchObject({
      resource: { valueString: SUMMARY, extension: [{ extension: expect.arrayContaining([
        { url: 'source', valueString: 'external-ai' },
        { url: 'contentHash', valueString: sha256(SUMMARY) },
        { url: 'acceptedAt', valueDateTime: OUTGOING_AT },
      ]) }] },
    });
    expect(bundle.entry.find(({ resource }) => resource.resourceType === 'Composition')).toMatchObject({
      resource: { date: INCOMING_AT, attester: expect.arrayContaining([
        { mode: 'professional', time: INCOMING_AT, party: expect.any(Object) },
      ]) },
    });
  });

  it('rejects absent closure evidence and mismatched transfer acknowledgement', () => {
    const input = candidateInput();
    expect(() => buildExceptionHandoverFhirCandidate({ ...input, events: input.events.slice(1) })).toThrow();
    expect(() => buildExceptionHandoverFhirCandidate({ ...input, events: input.events.slice(0, -1) })).toThrow();
    expect(() => buildExceptionHandoverFhirCandidate({ ...input, events: input.events.map((event) =>
      event.kind === 'incoming_attestation' ? { ...event, acknowledgesKey: 'other' } : event) })).toThrow();
    expect(() => buildExceptionHandoverFhirCandidate({ ...input, unitHealth: 'unavailable' })).toThrow();
  });

  it('rejects an altered group, bad references and mismatched summary provenance', () => {
    const input = candidateInput();
    expect(() => buildExceptionHandoverFhirCandidate({ ...input, members: input.members.slice(1) })).toThrow();
    expect(() => buildExceptionHandoverFhirCandidate({ ...input, summary: {
      ...input.summary, text: 'Changed after acceptance',
    } })).toThrow();
    const bundle = buildExceptionHandoverFhirCandidate(input);
    const broken = structuredClone(bundle);
    const group = broken.entry.find(({ resource }) => resource.resourceType === 'Group');
    if (!group) throw new Error('Missing Group');
    if (!group.resource.member) throw new Error('Missing group members');
    group.resource.member[0].entity.reference = 'Patient/not-in-bundle';
    expect(validateBundle(broken).isValid).toBe(false);
    expect(() => buildExceptionHandoverFhirCandidate({ ...input, events: [
      ...input.events, { ...input.events[0], actorName: 'Contradictory actor' },
    ] })).toThrow();
  });

  it('keeps retry identity and evidence independent of visual ordering and foreign events', () => {
    const input = candidateInput();
    const expected = buildExceptionHandoverFhirCandidate(input);
    const other = { ...input.events[0], shiftId: 'another-shift' };
    expect(buildExceptionHandoverFhirCandidate({
      ...input,
      members: [...input.members].reverse(),
      classifications: [...input.classifications].reverse(),
      events: [...input.events].reverse().concat(other),
    })).toEqual(expected);
    expect(() => buildExceptionHandoverFhirCandidate({ ...input, viewScope: 'another-unit' })).toThrow();
    expect(() => buildExceptionHandoverFhirCandidate({ ...input, members: input.members.map((member) => ({
      ...member, unitId: 'another-unit',
    })) })).toThrow();
  });

  it('does not infer provenance or activate the existing productive capability', () => {
    const input = candidateInput();
    const { summary: _summary, ...withoutSummary } = input;
    const bundle = buildExceptionHandoverFhirCandidate(withoutSummary);
    expect(bundle.entry.some(({ resource }) => resource.resourceType === 'Observation')).toBe(false);
    expect(HANDOFF_FHIR_CAPABILITY_MATRIX.find(({ internal }) => internal === 'HandoffCommunication')?.status).toBe('pending');
    expect(() => buildExceptionHandoverFhirCandidate({ ...input, summary: {
      text: SUMMARY,
      provenance: { source: 'external-ai', contentHash: sha256(SUMMARY) },
    } })).toThrow();
  });

  it('validates a single-patient group subject without relaxing unrelated patient references', () => {
    expect(validateBundle(candidateFixture)).toEqual({ isValid: true, errors: [] });
    const broken = structuredClone(candidateFixture);
    broken.entry[7].resource.subject.reference = 'Patient/not-in-bundle';
    expect(validateBundle(broken).isValid).toBe(false);
  });
});
