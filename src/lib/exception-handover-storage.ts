import {
  encryptedGetItem,
  encryptedRemoveItem,
  encryptedSetItem,
  getAsyncStorageAdapter,
  type AsyncStorageAdapter,
} from './encryptedStorage';
import {
  appendUniqueExceptionEvent,
  appendUniqueOverride,
  type DegradedUnitTransfer,
  type ExceptionReviewEvent,
  type ExceptionHandoverContext,
  type HandoffOverride,
  type AcceptedComparableReference,
  type FrozenComparableManifest,
} from './exception-handover';
import { Platform } from 'react-native';

export const EXCEPTION_HANDOVER_STORAGE_KEY = 'handover:demo:exception-handoff:v1';

export type PersistedBriefDraft = {
  change: string;
  currentRisk: string;
  nextAction: string;
  owner: string;
  contingency: string;
  targetAt?: string;
};

export type ExceptionHandoverSessionState = {
  version: 2;
  shiftId: string;
  events: ExceptionReviewEvent[];
  overrides: HandoffOverride[];
  interactionCounts: Record<string, number>;
  briefDrafts: Record<string, PersistedBriefDraft>;
  degradedTransfer: DegradedUnitTransfer | null;
  activeContext?: ExceptionHandoverContext;
  frozenManifest?: FrozenComparableManifest;
  acceptedReferences: AcceptedComparableReference[];
};

export type ExceptionHandoverStorage = {
  durability?: 'durable' | 'memory';
  readonly syncStatus?: 'confirmed' | 'pending' | 'conflict';
  listConflicts?: () => Promise<number>;
  discardConflicts?: () => Promise<void>;
  load(shiftId: string): Promise<ExceptionHandoverSessionState>;
  save(state: ExceptionHandoverSessionState): Promise<void>;
  clear(): Promise<void>;
};

type LegacyExceptionHandoverState = Omit<ExceptionHandoverSessionState, 'version' | 'acceptedReferences'> & { version: 1 };

export function createEmptyExceptionHandoverState(shiftId: string): ExceptionHandoverSessionState {
  return {
    version: 2,
    shiftId,
    events: [],
    overrides: [],
    interactionCounts: {},
    briefDrafts: {},
    degradedTransfer: null,
    acceptedReferences: [],
  };
}

function isPersistedState(value: unknown): value is ExceptionHandoverSessionState | LegacyExceptionHandoverState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ExceptionHandoverSessionState>;
  return ((value as { version?: unknown }).version === 1 || candidate.version === 2) &&
    typeof candidate.shiftId === 'string' &&
    Array.isArray(candidate.events) &&
    Array.isArray(candidate.overrides) &&
    Boolean(candidate.interactionCounts && typeof candidate.interactionCounts === 'object') &&
    Boolean(candidate.briefDrafts && typeof candidate.briefDrafts === 'object') &&
    ((value as { version?: unknown }).version === 1 || Array.isArray(candidate.acceptedReferences)) &&
    (candidate.acceptedReferences ?? []).every((reference) => reference && reference.version === 1 &&
      typeof reference.manifestHash === 'string' && typeof reference.acceptedBy === 'string' &&
      typeof reference.acceptedAt === 'string' && Number.isFinite(Date.parse(reference.acceptedAt)) &&
      typeof reference.expiresAt === 'string' && Number.isFinite(Date.parse(reference.expiresAt)) &&
      typeof reference.outgoingKey === 'string' && typeof reference.incomingKey === 'string' &&
      Boolean(reference.context && typeof reference.context.shiftId === 'string') &&
      Array.isArray(reference.snapshots) && reference.snapshots.every((snapshot) =>
        snapshot && typeof snapshot.patientId === 'string' && typeof snapshot.unitId === 'string' &&
        typeof snapshot.shiftId === 'string' && snapshot.sources && typeof snapshot.sources === 'object')) &&
    (!('frozenManifest' in candidate) || Boolean(candidate.frozenManifest &&
      Array.isArray(candidate.frozenManifest.snapshots) && typeof candidate.frozenManifest.hash === 'string'));
}

export function mergeExceptionHandoverState(
  current: ExceptionHandoverSessionState,
  incoming: ExceptionHandoverSessionState,
): ExceptionHandoverSessionState {
  const acceptedReferences = [...current.acceptedReferences];
  for (const reference of incoming.acceptedReferences) {
    const prior = acceptedReferences.find((candidate) => candidate.incomingKey === reference.incomingKey);
    if (prior && prior.manifestHash !== reference.manifestHash) {
      throw new Error('EXCEPTION_HANDOVER_ACCEPTANCE_CONFLICT');
    }
    if (!prior && acceptedReferences.some((candidate) => candidate.acceptedAt === reference.acceptedAt &&
      candidate.snapshots.some(({ patientId, unitId }) => reference.snapshots.some((snapshot) =>
        snapshot.patientId === patientId && snapshot.unitId === unitId)))) {
      throw new Error('EXCEPTION_HANDOVER_ACCEPTANCE_CONFLICT');
    }
    if (!prior) acceptedReferences.push(reference);
  }
  const covered = new Set<string>();
  const operating = new Set<string>();
  const latestReferences = acceptedReferences.sort((left, right) =>
    Date.parse(right.acceptedAt) - Date.parse(left.acceptedAt)).filter((reference) => {
    const members = reference.snapshots.map(({ patientId, unitId }) => `${patientId}\u0000${unitId}`);
    const needed = members.some((member) => !covered.has(member) ||
      (reference.context.shiftId !== incoming.shiftId && !operating.has(member)));
    members.forEach((member) => covered.add(member));
    if (reference.context.shiftId !== incoming.shiftId) members.forEach((member) => operating.add(member));
    return needed;
  });
  if (current.shiftId !== incoming.shiftId) return { ...incoming, version: 2,
    acceptedReferences: latestReferences };
  const events = incoming.events.reduce(appendUniqueExceptionEvent, current.events);
  const overrides = incoming.overrides.reduce(appendUniqueOverride, current.overrides);
  const activeContext = (current.activeContext?.revision ?? 0) > (incoming.activeContext?.revision ?? 0)
    ? current.activeContext : incoming.activeContext;
  return {
    version: 2,
    shiftId: incoming.shiftId,
    events,
    overrides,
    interactionCounts: { ...current.interactionCounts, ...incoming.interactionCounts },
    briefDrafts: { ...current.briefDrafts, ...incoming.briefDrafts },
    degradedTransfer: incoming.degradedTransfer ?? current.degradedTransfer,
    ...(activeContext ? { activeContext } : {}),
    ...(incoming.frozenManifest && incoming.frozenManifest.context.key === activeContext?.key &&
      incoming.frozenManifest.context.revision === activeContext.revision
      ? { frozenManifest: incoming.frozenManifest } : {}),
    acceptedReferences: latestReferences,
  };
}

export function createExceptionHandoverStorage(
  key = EXCEPTION_HANDOVER_STORAGE_KEY,
  providedStorage?: AsyncStorageAdapter | null,
  currentTime: () => string = () => new Date().toISOString(),
): ExceptionHandoverStorage {
  let memoizedStorage = providedStorage ?? null;
  let pendingSave = Promise.resolve();

  const getStorage = async () => {
    if (memoizedStorage) return memoizedStorage;
    memoizedStorage = await getAsyncStorageAdapter();
    return memoizedStorage;
  };

  return {
    durability: Platform.OS === 'web' && !providedStorage ? 'memory' : 'durable',
    async load(shiftId) {
      const storage = await getStorage();
      if (!storage) throw new Error('EXCEPTION_HANDOVER_STORAGE_UNAVAILABLE');
      const raw = await encryptedGetItem(key, storage);
      if (raw === null) return createEmptyExceptionHandoverState(shiftId);
      const asOf = Date.parse(currentTime());
      if (!Number.isFinite(asOf)) throw new Error('EXCEPTION_HANDOVER_CLOCK_INVALID');
      const parsed: unknown = JSON.parse(raw);
      if (!isPersistedState(parsed)) throw new Error('EXCEPTION_HANDOVER_CORRUPT');
      const state = { ...parsed, version: 2 as const,
        acceptedReferences: (parsed.version === 1 ? [] : parsed.acceptedReferences)
          .filter((reference) => Date.parse(reference.expiresAt) > asOf) };
      if (parsed.version === 2 && state.acceptedReferences.length !== parsed.acceptedReferences.length) {
        await encryptedSetItem(key, JSON.stringify(state), storage);
      }
      return parsed.shiftId === shiftId ? state : { ...createEmptyExceptionHandoverState(shiftId),
        acceptedReferences: state.acceptedReferences };
    },
    save(state) {
      const operation = pendingSave.then(async () => {
        const storage = await getStorage();
        if (!storage) throw new Error('EXCEPTION_HANDOVER_STORAGE_UNAVAILABLE');
        const current = await this.load(state.shiftId);
        const asOf = Date.parse(currentTime());
        if (!Number.isFinite(asOf)) throw new Error('EXCEPTION_HANDOVER_CLOCK_INVALID');
        const liveState = { ...state, acceptedReferences: state.acceptedReferences.filter((reference) =>
          Date.parse(reference.expiresAt) > asOf) };
        await encryptedSetItem(key, JSON.stringify(mergeExceptionHandoverState(current, liveState)), storage);
      });
      pendingSave = operation.catch(() => {});
      return operation;
    },
    async clear() {
      const storage = await getStorage();
      if (!storage) throw new Error('EXCEPTION_HANDOVER_STORAGE_UNAVAILABLE');
      await encryptedRemoveItem(key, storage);
    },
  };
}

export async function clearExceptionHandoverStorage(
  key = EXCEPTION_HANDOVER_STORAGE_KEY,
): Promise<void> {
  const storage = await getAsyncStorageAdapter();
  if (!storage) throw new Error('EXCEPTION_HANDOVER_STORAGE_UNAVAILABLE');
  await encryptedRemoveItem(key, storage);
}
