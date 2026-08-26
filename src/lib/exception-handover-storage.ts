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
  const events = incoming.events.reduce(appendUniqueExceptionEvent, current.events);
  const overrides = incoming.overrides.reduce(appendUniqueOverride, current.overrides);
  return {
    version: 1,
    shiftId: incoming.shiftId,
    events,
    overrides,
    interactionCounts: { ...current.interactionCounts, ...incoming.interactionCounts },
    briefDrafts: { ...current.briefDrafts, ...incoming.briefDrafts },
    degradedTransfer: incoming.degradedTransfer ?? current.degradedTransfer,
  };
}

export function createExceptionHandoverStorage(
  key = EXCEPTION_HANDOVER_STORAGE_KEY,
  providedStorage?: AsyncStorageAdapter | null,
): ExceptionHandoverStorage {
  let memoizedStorage = providedStorage ?? null;
  let memoryCopy: ExceptionHandoverSessionState | null = null;

  const getStorage = async () => {
    if (memoizedStorage) return memoizedStorage;
    memoizedStorage = await getAsyncStorageAdapter();
    return memoizedStorage;
  };

  return {
    async load(shiftId) {
      const storage = await getStorage();
      if (!storage) {
        return memoryCopy?.shiftId === shiftId
          ? { ...memoryCopy }
          : createEmptyExceptionHandoverState(shiftId);
      }
      try {
        const raw = await encryptedGetItem(key, storage);
        if (!raw) return createEmptyExceptionHandoverState(shiftId);
        const parsed = JSON.parse(raw) as unknown;
        return isPersistedState(parsed) && parsed.shiftId === shiftId
          ? parsed
          : createEmptyExceptionHandoverState(shiftId);
      } catch {
        return createEmptyExceptionHandoverState(shiftId);
      }
    },
    async save(state) {
      const storage = await getStorage();
      if (!storage) {
        memoryCopy = { ...state };
        return;
      }
      const current = await this.load(state.shiftId);
      await encryptedSetItem(key, JSON.stringify(mergeExceptionHandoverState(current, state)), storage);
      memoryCopy = null;
    },
    async clear() {
      const storage = await getStorage();
      memoryCopy = null;
      if (storage) await encryptedRemoveItem(key, storage);
    },
  };
}

export async function clearExceptionHandoverStorage(
  key = EXCEPTION_HANDOVER_STORAGE_KEY,
): Promise<void> {
  const storage = await getAsyncStorageAdapter();
  if (storage) await encryptedRemoveItem(key, storage);
}
