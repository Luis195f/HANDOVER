import { sha256 } from 'js-sha256';

import { FHIR_EXTENSION_URLS } from './codes';
import {
  assessHandoffClosure,
  buildExceptionHandoverContextKey,
  type ExceptionHandoverContext,
  type ExceptionReviewEvent,
  type HandoffClassification,
  type UnitDataHealth,
} from './exception-handover';
import { HANDOVER_IDENTIFIER_SYSTEMS } from './fhir-terminology';
import { buildTextProvenanceExtension } from './fhir-map/composition';
import type { SbarTextProvenance } from '../validation/schemas';

type CandidateResource = {
  resourceType: string;
  id: string;
  member?: Array<{ entity: { reference: string }; extension?: unknown[] }>;
};

type CandidateEntry = {
  fullUrl: string;
  resource: CandidateResource;
  request: { method: 'POST'; url: string };
};

export type ExceptionHandoverFhirCandidate = {
  resourceType: 'Bundle';
  type: 'transaction';
  identifier: { system: string; value: string };
  timestamp: string;
  entry: CandidateEntry[];
};

export type ExceptionHandoverFhirCandidateInput = {
  context: ExceptionHandoverContext;
  viewScope: string;
  members: readonly { patientId: string; unitId: string }[];
  classifications: readonly HandoffClassification[];
  events: readonly ExceptionReviewEvent[];
  unitHealth: UnitDataHealth;
  summary?: { text: string; provenance?: SbarTextProvenance };
};

const SYSTEM = 'urn:handover:exception-handoff';
const extension = (name: string, valueString: string) => ({ url: `${SYSTEM}:${name}`, valueString });
const identifier = (name: string, value: string) => ({ system: `${SYSTEM}:${name}`, value });
const code = (name: string) => ({ coding: [{ system: SYSTEM, code: name }] });
const stableId = (prefix: string, key: string) => `${prefix}-${sha256(key).slice(0, 32)}`;
const reference = (resource: CandidateResource) => ({ reference: `${resource.resourceType}/${resource.id}` });

function entry(resource: CandidateResource): CandidateEntry {
  const hash = sha256(`${resource.resourceType}|${resource.id}`);
  return {
    fullUrl: `urn:uuid:${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`,
    resource,
    request: { method: 'POST', url: resource.resourceType },
  };
}

function assertEventTime(value: string): void {
  if (!value || !Number.isFinite(Date.parse(value))) throw new Error('Invalid exception event time');
}

export function buildExceptionHandoverFhirCandidate(
  input: ExceptionHandoverFhirCandidateInput,
): ExceptionHandoverFhirCandidate {
  const { context, viewScope, members, classifications, unitHealth } = input;
  if (unitHealth === 'unavailable') throw new Error('Degraded transfer has no candidate FHIR contract');
  if (!viewScope.trim() || !context.shiftId.trim() || !Number.isSafeInteger(context.revision) || context.revision < 1 ||
      members.length !== classifications.length || members.some(({ patientId, unitId }) => !patientId.trim() || !unitId.trim()) ||
      new Set(members.map(({ patientId }) => patientId)).size !== members.length ||
      new Set(classifications.map(({ patientId }) => patientId)).size !== classifications.length ||
      members.some(({ patientId }) => !classifications.some((classification) => classification.patientId === patientId)) ||
      context.key !== buildExceptionHandoverContextKey(context.shiftId, viewScope, members, classifications)) {
    throw new Error('Exception group context does not match its members and classifications');
  }

  const currentEvents = input.events.filter((event) => event.shiftId === context.shiftId &&
    event.context?.key === context.key && event.context.revision === context.revision);
  const distinctEvents = new Map<string, ExceptionReviewEvent>();
  for (const event of currentEvents) {
    assertEventTime(event.recordedAt);
    if (!event.idempotencyKey.trim() || !event.actorId.trim() || !event.actorName.trim()) {
      throw new Error('Exception event identity is incomplete');
    }
    const previous = distinctEvents.get(event.idempotencyKey);
    if (previous && JSON.stringify(previous) !== JSON.stringify(event)) {
      throw new Error('Conflicting exception event idempotency key');
    }
    distinctEvents.set(event.idempotencyKey, event);
  }
  const events = [...distinctEvents.values()].sort((left, right) => left.idempotencyKey.localeCompare(right.idempotencyKey));
  if (!assessHandoffClosure(classifications, events, unitHealth, context).canClose) {
    throw new Error('Required A/B/C/R closure evidence is missing');
  }
  const outgoing = events.filter((event) => event.kind === 'outgoing_transfer' && event.actorKind === 'outgoing');
  const incoming = events.filter((event) => event.kind === 'incoming_attestation' && event.actorKind === 'incoming' &&
    outgoing.some((transfer) => event.acknowledgesKey === transfer.idempotencyKey && transfer.actorId !== event.actorId));
  if (outgoing.length !== 1 || incoming.length !== 1) {
    throw new Error('Matching outgoing transfer and incoming attestation are required');
  }
  const transfer = outgoing[0];
  const acknowledgement = incoming[0];
  const actorEvents = new Map<string, ExceptionReviewEvent>();
  for (const event of events) {
    const previous = actorEvents.get(event.actorId);
    if (previous && (previous.actorName !== event.actorName || previous.actorKind !== event.actorKind)) {
      throw new Error('Conflicting exception actor identity');
    }
    actorEvents.set(event.actorId, event);
  }

  const patients = [...members].sort((left, right) => left.patientId.localeCompare(right.patientId))
    .map(({ patientId }) => ({ patientId, resource: {
      resourceType: 'Patient', id: stableId('pat', patientId),
      identifier: [identifier('patient', patientId)],
    } }));
  const patientById = new Map(patients.map(({ patientId, resource }) => [patientId, resource]));
  const group = {
    resourceType: 'Group', id: stableId('group', `${context.key}|${context.revision}`),
    identifier: [identifier('context', `${context.shiftId}:${context.key}:${context.revision}`)],
    type: 'person', actual: true,
    extension: [extension('view-scope', viewScope), extension('shift-id', context.shiftId)],
    member: [...members].sort((left, right) => left.patientId.localeCompare(right.patientId))
      .map(({ patientId, unitId }) => {
        const patient = patientById.get(patientId);
        if (!patient) throw new Error('Missing patient member');
        return {
          entity: reference(patient),
          extension: [{ url: `${SYSTEM}:unit`, valueIdentifier: { system: HANDOVER_IDENTIFIER_SYSTEMS.unit, value: unitId } }],
        };
      }),
  };
  const practitioners = [...actorEvents.values()].sort((left, right) => left.actorId.localeCompare(right.actorId))
    .map((actor) => ({ actorId: actor.actorId, resource: {
      resourceType: 'Practitioner', id: stableId('prac', actor.actorId),
      identifier: [{ system: HANDOVER_IDENTIFIER_SYSTEMS.user, value: actor.actorId }],
      name: [{ text: actor.actorName }],
    } }));
  const practitionerById = new Map(practitioners.map(({ actorId, resource }) => [actorId, resource]));
  const communication = events.map((event) => {
    const subject = event.patientId ? patientById.get(event.patientId) : group;
    const sender = practitionerById.get(event.actorId);
    if (!subject || !sender) throw new Error('Exception event subject or actor does not resolve');
    const recipient = event.receiverId ? practitionerById.get(event.receiverId) : undefined;
    if (event.receiverId && !recipient) throw new Error('Exception receiver does not resolve');
    return {
      resourceType: 'Communication', id: stableId('comm', event.idempotencyKey),
      identifier: [identifier('event', event.idempotencyKey)],
      status: 'completed', category: [code(event.kind)], subject: reference(subject),
      sender: reference(sender), ...(recipient ? { recipient: [reference(recipient)] } : {}),
      sent: event.recordedAt,
      extension: [
        extension('actor-kind', event.actorKind),
        ...(event.source ? [extension('source', event.source)] : []),
        ...(event.targetAt ? [{ url: `${SYSTEM}:target-at`, valueDateTime: event.targetAt }] : []),
        ...(event.acknowledgesKey ? [extension('acknowledges-key', event.acknowledgesKey)] : []),
      ],
      ...((event.reason || event.criticalPoints?.length) ? { payload: [
        ...(event.reason ? [{ contentString: event.reason }] : []),
        ...(event.criticalPoints ?? []).map((point) => ({ contentString: point })),
      ] } : {}),
    };
  });
  const tasks = [...classifications].sort((left, right) => left.patientId.localeCompare(right.patientId))
    .filter(({ handoffLane }) => handoffLane === 'R')
    .flatMap(({ patientId, reviewRequirements }) => reviewRequirements.map((requirement) => {
      assertEventTime(requirement.enteredAt);
      const patient = patientById.get(patientId);
      if (!patient) throw new Error('Exception review patient does not resolve');
      return {
        resourceType: 'Task', id: stableId('task', `${context.key}|${context.revision}|${patientId}|${requirement.source}`),
        identifier: [identifier('review', `${context.key}:${context.revision}:${patientId}:${requirement.source}`)],
        status: 'requested', intent: 'proposal', for: reference(patient),
        authoredOn: requirement.enteredAt, description: requirement.reason,
        ...(requirement.owner ? { owner: { display: requirement.owner } } : {}),
        extension: [extension('source', requirement.source), extension('source-status', requirement.sourceStatus),
          extension('review-state', requirement.state)],
      };
    })).sort((left, right) => left.id.localeCompare(right.id));
  const summaryText = input.summary?.text.trim();
  if (input.summary && !summaryText) throw new Error('Empty exception summary');
  if (input.summary?.provenance && sha256(summaryText ?? '') !== input.summary.provenance.contentHash) {
    throw new Error('Exception summary provenance does not match its content');
  }
  if (input.summary?.provenance &&
      (input.summary.provenance.source === 'external-ai' || input.summary.provenance.source === 'ai-edited-by-human') &&
      (!input.summary.provenance.acceptedBy || !input.summary.provenance.acceptedAt ||
        !input.summary.provenance.decisionHash)) {
    throw new Error('Exception AI summary lacks recorded human acceptance');
  }
  const summaryExtension = summaryText
    ? buildTextProvenanceExtension(FHIR_EXTENSION_URLS.SBAR_TEXT_PROVENANCE, summaryText, input.summary?.provenance)
    : undefined;
  const summary = summaryText ? {
    resourceType: 'Observation', id: stableId('obs', `${transfer.idempotencyKey}|${sha256(summaryText)}`),
    status: 'final', category: [code('handover-summary')], code: code('handover-summary'),
    subject: reference(group), effectiveDateTime: transfer.recordedAt, valueString: summaryText,
    ...(summaryExtension ? { extension: summaryExtension } : {}),
  } : null;
  const outgoingAuthor = practitionerById.get(transfer.actorId);
  const incomingAuthor = practitionerById.get(acknowledgement.actorId);
  if (!outgoingAuthor || !incomingAuthor) throw new Error('Transfer actors do not resolve');
  const composition = {
    resourceType: 'Composition', id: stableId('comp', `${context.key}|${context.revision}|${transfer.idempotencyKey}`),
    status: 'final', type: code('exception-handover'), subject: reference(group),
    date: acknowledgement.recordedAt, author: [reference(outgoingAuthor)],
    title: 'Exception handover',
    attester: [
      { mode: 'professional', time: transfer.recordedAt, party: reference(outgoingAuthor) },
      { mode: 'professional', time: acknowledgement.recordedAt, party: reference(incomingAuthor) },
    ],
    section: [
      { title: 'Clinical communication', entry: communication.map(reference) },
      ...(tasks.length ? [{ title: 'Pending review', entry: tasks.map(reference) }] : []),
      ...(summary ? [{ title: 'Summary', entry: [reference(summary)] }] : []),
    ],
  };
  const resources = [group, ...patients.map(({ resource }) => resource),
    ...practitioners.map(({ resource }) => resource), ...communication, ...tasks,
    ...(summary ? [summary] : []), composition];
  return {
    resourceType: 'Bundle', type: 'transaction',
    identifier: identifier('bundle', `${context.key}:${context.revision}:${transfer.idempotencyKey}`),
    timestamp: acknowledgement.recordedAt,
    entry: resources.map(entry),
  };
}
