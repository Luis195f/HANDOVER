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
} from './exception-handover';

export const EXCEPTION_HANDOVER_STORAGE_KEY = 'handover:demo:exception-handoff:v1';

export type PersistedBriefDraft = {
  change: string;
  currentRisk: string;
  nextAction: string;
  owner: string;
  contingency: string;
};

export type ExceptionHandoverSessionState = {
  version: 1;
  shiftId: string;
  events: ExceptionReviewEvent[];
  overrides: HandoffOverride[];
  interactionCounts: Record<string, number>;
  briefDrafts: Record<string, PersistedBriefDraft>;
  degradedTransfer: DegradedUnitTransfer | null;
  activeContext?: ExceptionHandoverContext;
};

export type ExceptionHandoverStorage = {
  load(shiftId: string): Promise<ExceptionHandoverSessionState>;
  save(state: ExceptionHandoverSessionState): Promise<void>;
  clear(): Promise<void>;
};

export function createEmptyExceptionHandoverState(shiftId: string): ExceptionHandoverSessionState {
  return {
    version: 1,
    shiftId,
    events: [],
    overrides: [],
    interactionCounts: {},
    briefDrafts: {},
    degradedTransfer: null,
  };
}

function isPersistedState(value: unknown): value is ExceptionHandoverSessionState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ExceptionHandoverSessionState>;
  return candidate.version === 1 &&
    typeof candidate.shiftId === 'string' &&
    Array.isArray(candidate.events) &&
    Array.isArray(candidate.overrides) &&
    Boolean(candidate.interactionCounts && typeof candidate.interactionCounts === 'object') &&
    Boolean(candidate.briefDrafts && typeof candidate.briefDrafts === 'object');
}

export function mergeExceptionHandoverState(
  current: ExceptionHandoverSessionState,
  incoming: ExceptionHandoverSessionState,
): ExceptionHandoverSessionState {
  if (current.shiftId !== incoming.shiftId) return incoming;
  const events = incoming.events.reduce(appendUniqueExceptionEvent, current.events);
  const overrides = incoming.overrides.reduce(appendUniqueOverride, current.overrides);
  const activeContext = (current.activeContext?.revision ?? 0) > (incoming.activeContext?.revision ?? 0)
    ? current.activeContext : incoming.activeContext;
  return {
    version: 1,
    shiftId: incoming.shiftId,
    events,
    overrides,
    interactionCounts: { ...current.interactionCounts, ...incoming.interactionCounts },
    briefDrafts: { ...current.briefDrafts, ...incoming.briefDrafts },
    degradedTransfer: incoming.degradedTransfer ?? current.degradedTransfer,
    ...(activeContext ? { activeContext } : {}),
  };
}

export function createExceptionHandoverStorage(
  key = EXCEPTION_HANDOVER_STORAGE_KEY,
  providedStorage?: AsyncStorageAdapter | null,
): ExceptionHandoverStorage {
  let memoizedStorage = providedStorage ?? null;
  let pendingSave = Promise.resolve();

  const getStorage = async () => {
    if (memoizedStorage) return memoizedStorage;
    memoizedStorage = await getAsyncStorageAdapter();
    return memoizedStorage;
  };

  return {
    async load(shiftId) {
      const storage = await getStorage();
      if (!storage) throw new Error('EXCEPTION_HANDOVER_STORAGE_UNAVAILABLE');
      const raw = await encryptedGetItem(key, storage);
      if (raw === null) return createEmptyExceptionHandoverState(shiftId);
      const parsed: unknown = JSON.parse(raw);
      if (!isPersistedState(parsed)) throw new Error('EXCEPTION_HANDOVER_CORRUPT');
      return parsed.shiftId === shiftId ? parsed : createEmptyExceptionHandoverState(shiftId);
    },
    save(state) {
      const operation = pendingSave.then(async () => {
        const storage = await getStorage();
        if (!storage) throw new Error('EXCEPTION_HANDOVER_STORAGE_UNAVAILABLE');
        const current = await this.load(state.shiftId);
        await encryptedSetItem(key, JSON.stringify(mergeExceptionHandoverState(current, state)), storage);
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
