import { sha256 } from 'js-sha256';
import { describe, expect, it } from 'vitest';
import candidateFixture from '../../../tests/fixtures/fhir/exception-handover-candidate-bundle.json';

import { DEMO_ACTORS, DEMO_EXCEPTION_HANDOVER_PATIENTS } from '@/src/demo/fixtures';
import { validateBundle, validateExceptionHandoverCandidate } from '@/src/lib/fhir-validation';
import { buildExceptionHandoverFhirCandidate } from '../exception-handover-fhir';
import {
  buildExceptionHandoverContextKey,
  classifyExceptionHandoverPatient,
  buildExceptionScopeKey,
  createExceptionReviewEvent,
} from '../exception-handover';
import { buildExceptionHandoffContract, HANDOFF_FHIR_CAPABILITY_MATRIX } from '../handoff-contract';

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
  it('consumes a source-backed R classification, never the fixture status, without activating transport', () => {
    const patient = fixture('demo-psych-adult-001');
    const members = [{ patientId: patient.patientId, unitId: 'unit-a' }];
    const classification = classifyExceptionHandoverPatient(patient, {
      now: NOW, shiftId: SHIFT,
      candidate: { unitId: 'unit-a', scopeKey: buildExceptionScopeKey(SHIFT, 'unit-a', members), acceptedReference: null },
    });
    expect(classification.handoffLane).toBe('R');
    const context = { shiftId: SHIFT, revision: 1,
      key: buildExceptionHandoverContextKey(SHIFT, 'unit-a', members, [classification]) };
    const details = { shiftId: SHIFT, context };
    const outgoing = createExceptionReviewEvent('outgoing_transfer', DEMO_ACTORS[0], OUTGOING_AT, undefined, details);
    const events = [createExceptionReviewEvent('r_transferred', DEMO_ACTORS[1], NOW, patient.patientId,
      { ...details, reason: 'Fuente no verificable', targetAt: INCOMING_AT, receiverId: DEMO_ACTORS[1].userId }),
      outgoing, createExceptionReviewEvent('incoming_attestation', DEMO_ACTORS[1], INCOMING_AT, undefined,
        { ...details, acknowledgesKey: outgoing.idempotencyKey })];
    const bundle = buildExceptionHandoverFhirCandidate({ context, viewScope: 'unit-a', members,
      classifications: [classification], events, unitHealth: 'healthy' });
    expect(bundle.entry.some(({ resource }) => resource.resourceType === 'Task')).toBe(true);
    expect(validateExceptionHandoverCandidate(bundle)).toEqual({ isValid: true, errors: [] });
  });
  it('keeps a stable, round-trippable transaction with group, actors, tasks and C08 provenance', () => {
    const input = candidateInput();
    const original = structuredClone(input);
    const bundle = buildExceptionHandoverFhirCandidate(input);
    const copy = JSON.parse(JSON.stringify(bundle));
    expect(input).toEqual(original);
    expect(copy).toEqual(bundle);
    expect(buildExceptionHandoverFhirCandidate(input)).toEqual(bundle);
    expect(validateExceptionHandoverCandidate(copy)).toEqual({ isValid: true, errors: [] });
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
    expect(validateExceptionHandoverCandidate(broken).isValid).toBe(false);
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
    expect(buildExceptionHandoffContract(input.classifications[0]).productiveFhirResources).toEqual([]);
    expect(() => buildExceptionHandoverFhirCandidate({ ...input, summary: {
      text: SUMMARY,
      provenance: { source: 'external-ai', contentHash: sha256(SUMMARY) },
    } })).toThrow();
  });

  it('validates a single-patient group subject without relaxing unrelated patient references', () => {
    expect(validateExceptionHandoverCandidate(candidateFixture)).toEqual({ isValid: true, errors: [] });
    const broken = structuredClone(candidateFixture);
    broken.entry[7].resource.subject.reference = 'Patient/not-in-bundle';
    expect(validateExceptionHandoverCandidate(broken).isValid).toBe(false);
  });

  it('keeps the production single-patient validator closed to Group subjects', () => {
    expect(validateBundle(candidateFixture).isValid).toBe(false);
  });

  it('uses each entry fullUrl as the only internal reference target', () => {
    const bundle = buildExceptionHandoverFhirCandidate(candidateInput());
    const fullUrls = new Set(bundle.entry.map(({ fullUrl }) => fullUrl));
    const references = JSON.stringify(bundle).match(/"reference":"([^"]+)"/g) ?? [];
    expect(references.length).toBeGreaterThan(0);
    for (const match of references) {
      const target = match.slice('"reference":"'.length, -1);
      expect(target.startsWith('urn:uuid:')).toBe(true);
      expect(fullUrls.has(target)).toBe(true);
    }
  });

  it('rejects missing or ambiguous UUID targets and incomplete Group membership', () => {
    const missing = structuredClone(candidateFixture);
    missing.entry.splice(1, 1);
    expect(validateExceptionHandoverCandidate(missing).isValid).toBe(false);

    const duplicate = structuredClone(candidateFixture);
    duplicate.entry[1].fullUrl = duplicate.entry[0].fullUrl;
    expect(validateExceptionHandoverCandidate(duplicate).isValid).toBe(false);

    const orphan = structuredClone(candidateFixture);
    orphan.entry[4].resource.subject.reference = 'urn:uuid:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    expect(validateExceptionHandoverCandidate(orphan).isValid).toBe(false);

    const relative = structuredClone(candidateFixture);
    relative.entry[0].resource.member[0].entity.reference = 'Patient/pat-1';
    expect(validateExceptionHandoverCandidate(relative).isValid).toBe(false);

    const incomplete = structuredClone(candidateFixture);
    incomplete.entry[0].resource.member = [];
    expect(validateExceptionHandoverCandidate(incomplete).isValid).toBe(false);

    const secondPatient = structuredClone(candidateFixture);
    secondPatient.entry.splice(2, 0, {
      ...structuredClone(secondPatient.entry[1]),
      fullUrl: 'urn:uuid:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      resource: { ...secondPatient.entry[1].resource, id: 'another-patient' },
    });
    expect(validateExceptionHandoverCandidate(secondPatient).isValid).toBe(false);
  });
});
