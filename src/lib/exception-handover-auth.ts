import { v4 as uuidv4 } from 'uuid';
import { sha256 } from 'js-sha256';
import { apiGet, apiPost } from './api';
import { encryptedGetItem, encryptedSetItem, encryptedRemoveItem, getAsyncStorageAdapter } from './encryptedStorage';
import { createEmptyExceptionHandoverState, type ExceptionHandoverSessionState, type ExceptionHandoverStorage } from './exception-handover-storage';
import { loadStoredSession } from '@/src/security/OAuthService';

const STORE_KEY = 'handover.auth.exception.pending.v1';

export type ConfirmedExceptionShift = {
  id: string;
  unitId: string;
  periodStart: string;
  periodEnd: string;
  description: string;
  creatorSub: string;
  revision: number;
  expiresAt: string;
  state?: ExceptionHandoverSessionState;
};

type PendingOperation = {
  operationId: string;
  shiftId: string;
  unitId: string;
  actorSub: string;
  expectedRevision: number;
  contentHash: string;
  state: ExceptionHandoverSessionState;
  status: 'pending' | 'conflict';
  conflictReason?: 'revision_conflict' | 'operation_conflict' | 'unknown_conflict';
};

type PendingCreate = {
  operationId: string;
  actorSub: string;
  unitId: string;
  periodStart: string;
  periodEnd: string;
  description: string;
};

type LocalState = {
  version: 1;
  operations: PendingOperation[];
  creates: PendingCreate[];
  cached: Record<string, { actorSub: string; shift: ConfirmedExceptionShift }>;
};

let localWrite = Promise.resolve();

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    if (leftPoints[index] !== rightPoints[index]) return leftPoints[index] - rightPoints[index];
  }
  return leftPoints.length - rightPoints.length;
}

export function canonicalReceiptJson(value: unknown): string {
  const normalized: unknown = JSON.parse(JSON.stringify(value));
  const serialize = (entry: unknown): string => {
    if (Array.isArray(entry)) return `[${entry.map(serialize).join(',')}]`;
    if (typeof entry === 'number' && !Number.isSafeInteger(entry)) {
      throw new Error('EXCEPTION_HANDOVER_HASH_INVALID');
    }
    if (entry && typeof entry === 'object') {
      const object = entry as Record<string, unknown>;
      return `{${Object.keys(object).sort(compareCodePoints)
        .map((key) => `${JSON.stringify(key)}:${serialize(object[key])}`).join(',')}}`;
    }
    const scalar = JSON.stringify(entry);
    if (scalar === undefined) throw new Error('EXCEPTION_HANDOVER_HASH_INVALID');
    return scalar;
  };
  return serialize(normalized);
}

function contentHash(value: unknown): string {
  return sha256(canonicalReceiptJson(value));
}

function authenticatedState(state: ExceptionHandoverSessionState, actorSub: string): ExceptionHandoverSessionState {
  return { ...state,
    events: state.events.map((event) => event.actorId === actorSub
      ? { ...event, actorName: actorSub } : event),
    overrides: state.overrides.map((override) => override.professionalId === actorSub
      ? { ...override, professionalName: actorSub } : override),
  };
}

async function readLocal(): Promise<LocalState> {
  const raw = await encryptedGetItem(STORE_KEY);
  if (raw === null) return { version: 1, operations: [], creates: [], cached: {} };
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || (parsed as LocalState).version !== 1 ||
      !Array.isArray((parsed as LocalState).operations) || !Array.isArray((parsed as LocalState).creates) ||
      typeof (parsed as LocalState).cached !== 'object') {
    throw new Error('EXCEPTION_HANDOVER_PENDING_CORRUPT');
  }
  return parsed as LocalState;
}

async function mutateLocal(change: (current: LocalState) => void): Promise<LocalState> {
  const task = localWrite.then(async () => {
    const current = await readLocal();
    change(current);
    await encryptedSetItem(STORE_KEY, JSON.stringify(current));
    return current;
  });
  localWrite = task.then(() => {}, () => {});
  return task;
}

async function assertActor(actorSub: string, unitId: string): Promise<void> {
  const capabilities = await apiGet('/api/me/capabilities') as {
    userSub?: string; unitIds?: string[];
    permissions?: { canWriteHandover?: boolean };
    exceptionHandover?: { candidateEnabled?: boolean };
  };
  if (capabilities.userSub !== actorSub || !capabilities.unitIds?.includes(unitId) ||
      !capabilities.permissions?.canWriteHandover || !capabilities.exceptionHandover?.candidateEnabled) {
    throw new Error('EXCEPTION_HANDOVER_AUTH_CHANGED');
  }
}

async function assertLocalActor(actorSub: string, unitId: string): Promise<void> {
  const session = await loadStoredSession();
  if (session?.mode === 'demo' || session?.userId !== actorSub ||
      !session.accessToken || !session.units?.includes(unitId) ||
      !session.expiresAt || Date.parse(session.expiresAt) <= Date.now()) {
    throw new Error('EXCEPTION_HANDOVER_AUTH_CHANGED');
  }
}

export async function listConfirmedExceptionShifts(actorSub: string, unitId: string): Promise<ConfirmedExceptionShift[]> {
  await assertActor(actorSub, unitId);
  const result = await apiGet(`/api/exception-shifts?unitId=${encodeURIComponent(unitId)}`) as {
    shifts: ConfirmedExceptionShift[];
  };
  return result.shifts;
}

export async function createConfirmedExceptionShift(actorSub: string, input: {
  unitId: string; periodStart: string; periodEnd: string; description: string;
}): Promise<ConfirmedExceptionShift> {
  await assertActor(actorSub, input.unitId);
  const local = await mutateLocal((current) => {
    if (!current.creates.some((pending) => pending.actorSub === actorSub &&
        pending.unitId === input.unitId && pending.periodStart === input.periodStart &&
        pending.periodEnd === input.periodEnd && pending.description === input.description)) {
      current.creates.push({ ...input, actorSub, operationId: uuidv4() });
    }
  });
  const pending = local.creates.find((entry) => entry.actorSub === actorSub &&
    entry.unitId === input.unitId && entry.periodStart === input.periodStart &&
    entry.periodEnd === input.periodEnd && entry.description === input.description);
  if (!pending) throw new Error('EXCEPTION_HANDOVER_CREATE_UNAVAILABLE');
  const confirmed = await apiPost('/api/exception-shifts', { body: JSON.stringify({
    ...input, operationId: pending.operationId,
  }) }) as ConfirmedExceptionShift;
  await mutateLocal((current) => {
    current.creates = current.creates.filter((entry) => entry.operationId !== pending.operationId);
  });
  return confirmed;
}

async function submitPending(pending: PendingOperation): Promise<void> {
  await assertActor(pending.actorSub, pending.unitId);
  const path = `/api/exception-shifts/${pending.shiftId}/operations/${pending.operationId}`;
  try {
    const receipt = await apiGet(path) as { contentHash?: string; status?: string };
    if (receipt.status === 'confirmed' && receipt.contentHash === pending.contentHash) return;
    throw new Error('EXCEPTION_HANDOVER_RECEIPT_INVALID');
  } catch (error) {
    if ((error as { status?: number }).status !== 404) throw error;
  }
  const receipt = await apiPost(path, { body: JSON.stringify({
    expectedRevision: pending.expectedRevision, state: pending.state,
  }) }) as { contentHash?: string; status?: string };
  if (receipt.status !== 'confirmed' || receipt.contentHash !== pending.contentHash) {
    throw new Error('EXCEPTION_HANDOVER_RECEIPT_INVALID');
  }
}

function definitiveConflict(error: unknown): PendingOperation['conflictReason'] | null {
  const response = error as { status?: number; details?: string };
  if (response?.status !== 409) return null;
  try {
    const code = JSON.parse(response.details ?? '') as { code?: string };
    if (code.code === 'revision_conflict' || code.code === 'operation_conflict') return code.code;
  } catch {}
  return 'unknown_conflict';
}

export function createAuthenticatedExceptionHandoverStorage(
  shift: ConfirmedExceptionShift, actorSub: string,
): ExceptionHandoverStorage & { replayPending: () => Promise<void> } {
  const cacheKey = `${actorSub}\u0000${shift.id}`;
  let revision = shift.revision;
  let lastState = JSON.stringify(shift.state ?? createEmptyExceptionHandoverState(shift.id));
  let serial = Promise.resolve();
  let syncStatus: 'confirmed' | 'pending' | 'conflict' = 'confirmed';
  const replayPending = async () => {
    const local = await readLocal();
    const pending = local.operations.filter((entry) => entry.shiftId === shift.id &&
      entry.unitId === shift.unitId && entry.actorSub === actorSub);
    if (pending.some((entry) => entry.status === 'conflict')) {
      syncStatus = 'conflict';
      throw new Error('EXCEPTION_HANDOVER_CONFLICT');
    }
    for (const operation of pending) {
      try {
        await submitPending(operation);
      } catch (error) {
        const reason = definitiveConflict(error);
        if (!reason) throw error;
        try {
          await mutateLocal((current) => {
            const rejectedAt = current.operations.findIndex((entry) => entry.operationId === operation.operationId);
            if (rejectedAt < 0) return;
            current.operations.slice(rejectedAt).forEach((entry) => {
              if (entry.shiftId === shift.id && entry.actorSub === actorSub) {
                entry.status = 'conflict';
                entry.conflictReason = reason;
              }
            });
          });
        } catch {
          throw new Error('EXCEPTION_HANDOVER_CONFLICT_PERSIST_FAILED');
        }
        syncStatus = 'conflict';
        throw new Error('EXCEPTION_HANDOVER_CONFLICT');
      }
      const confirmedRevision = operation.expectedRevision + 1;
      await mutateLocal((current) => {
        current.operations = current.operations.filter((entry) => entry.operationId !== operation.operationId);
        const cached = current.cached[cacheKey];
        current.cached[cacheKey] = { actorSub, shift: {
          ...(cached?.shift ?? shift), revision: confirmedRevision, state: operation.state,
        } };
      });
      revision = confirmedRevision;
    }
    syncStatus = 'confirmed';
  };
  return {
    durability: 'durable',
    get syncStatus() { return syncStatus; },
    async listConflicts() {
      await assertLocalActor(actorSub, shift.unitId);
      return (await readLocal()).operations.filter((entry) => entry.shiftId === shift.id &&
        entry.unitId === shift.unitId && entry.actorSub === actorSub && entry.status === 'conflict').length;
    },
    async discardConflicts() {
      await assertLocalActor(actorSub, shift.unitId);
      await mutateLocal((current) => {
        current.operations = current.operations.filter((entry) => entry.shiftId !== shift.id ||
          entry.unitId !== shift.unitId ||
          entry.actorSub !== actorSub || entry.status !== 'conflict');
      });
    },
    async load(shiftId) {
      if (shiftId !== shift.id) throw new Error('EXCEPTION_HANDOVER_SHIFT_MISMATCH');
      let conflicted = false;
      let authorizedState: ExceptionHandoverSessionState | null = null;
      try {
        await assertActor(actorSub, shift.unitId);
        try { await replayPending(); } catch (error) {
          if ((error as Error).message !== 'EXCEPTION_HANDOVER_CONFLICT') throw error;
          conflicted = true;
        }
        const current = await apiGet(`/api/exception-shifts/${shift.id}`) as ConfirmedExceptionShift;
        if (!current.state || current.unitId !== shift.unitId) throw new Error('EXCEPTION_HANDOVER_STATE_INVALID');
        authorizedState = current.state;
        revision = current.revision;
        lastState = JSON.stringify(current.state);
        await mutateLocal((local) => { local.cached[cacheKey] = { actorSub, shift: current }; });
        this.durability = 'durable';
        syncStatus = conflicted ? 'conflict' : 'confirmed';
        return current.state;
      } catch (error) {
        if (authorizedState) { this.durability = 'memory'; return authorizedState; }
        if ((error as Error).message === 'EXCEPTION_HANDOVER_AUTH_CHANGED' ||
            (error as Error).message === 'EXCEPTION_HANDOVER_CONFLICT_PERSIST_FAILED' ||
            (error as { status?: number }).status === 401 || (error as { status?: number }).status === 403) throw error;
        await assertLocalActor(actorSub, shift.unitId);
        const local = await readLocal();
        const cached = local.cached[cacheKey];
        if (!cached || cached.actorSub !== actorSub || !cached.shift.state ||
            cached.shift.unitId !== shift.unitId || Date.parse(cached.shift.expiresAt) <= Date.now()) throw error;
        this.durability = 'memory';
        revision = cached.shift.revision;
        const operations = local.operations.filter((entry) => entry.shiftId === shift.id &&
          entry.unitId === shift.unitId && entry.actorSub === actorSub);
        if (conflicted || operations.some((entry) => entry.status === 'conflict')) {
          syncStatus = 'conflict';
          lastState = JSON.stringify(cached.shift.state);
          return cached.shift.state;
        }
        let expectedRevision = revision;
        for (const operation of operations) {
          if (operation.expectedRevision !== expectedRevision || operation.state.shiftId !== shift.id) {
            throw new Error('EXCEPTION_HANDOVER_RECONCILE_REQUIRED');
          }
          expectedRevision += 1;
        }
        const localState = operations.length ? operations[operations.length - 1].state : cached.shift.state;
        syncStatus = operations.length ? 'pending' : 'confirmed';
        lastState = JSON.stringify(localState);
        return localState;
      }
    },
    save(state) {
      const task = serial.then(async () => {
        if (state.shiftId !== shift.id) throw new Error('EXCEPTION_HANDOVER_SHIFT_MISMATCH');
        await assertLocalActor(actorSub, shift.unitId);
        state = authenticatedState(state, actorSub);
        const serialized = JSON.stringify(state);
        if (serialized === lastState) {
          await replayPending();
          return;
        }
        const outstanding = (await readLocal()).operations.filter((entry) =>
          entry.shiftId === shift.id && entry.unitId === shift.unitId && entry.actorSub === actorSub);
        if (outstanding.some((entry) => entry.status === 'conflict')) throw new Error('EXCEPTION_HANDOVER_CONFLICT');
        const operation: PendingOperation = { operationId: uuidv4(), shiftId: shift.id,
          unitId: shift.unitId, actorSub, expectedRevision: revision + outstanding.length,
          contentHash: contentHash(state), state, status: 'pending' };
        await mutateLocal((local) => { local.operations.push(operation); });
        lastState = serialized;
        syncStatus = 'pending';
        await replayPending();
      });
      serial = task.then(() => {}, () => {});
      return task;
    },
    replayPending,
    async clear() {
      await mutateLocal((local) => {
        local.operations = local.operations.filter((entry) => entry.shiftId !== shift.id || entry.actorSub !== actorSub);
        delete local.cached[cacheKey];
      });
    },
  };
}

export async function clearAuthenticatedExceptionHandoverLocal(): Promise<void> {
  const storage = await getAsyncStorageAdapter();
  if (!storage) throw new Error('EXCEPTION_HANDOVER_STORAGE_UNAVAILABLE');
  await encryptedRemoveItem(STORE_KEY, storage);
}
