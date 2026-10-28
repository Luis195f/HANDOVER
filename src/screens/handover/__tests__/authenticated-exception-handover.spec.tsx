import React from 'react';
import { act, render } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from 'js-sha256';
import { createEmptyExceptionHandoverState } from '@/src/lib/exception-handover-storage';
import { UnitExceptionHandover } from '../UnitExceptionHandover';

const transport = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const persisted = vi.hoisted(() => new Map<string, string>());
vi.mock('@/src/lib/api', () => ({ apiGet: transport.get, apiPost: transport.post }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => persisted.get(key) ?? null,
  setItem: async (key: string, value: string) => { persisted.set(key, value); },
  removeItem: async (key: string) => { persisted.delete(key); },
} }));
vi.mock('@/src/lib/crypto', () => ({
  encryptOfflinePayload: async (value: string) => `encrypted:${value}`,
  decryptOfflinePayload: async (value: string) => value.slice('encrypted:'.length),
}));

const shift = { id: '5c169975-bd44-429e-9a7e-135b62b417ee', unitId: 'icu-a',
  periodStart: '2026-10-28T08:00:00Z', periodEnd: '2026-10-28T16:00:00Z',
  description: 'Turno de prueba', creatorSub: 'auth0|alice', revision: 0,
  expiresAt: '2026-10-29T08:00:00Z' };
const colors = { background: '#fff', border: '#ccc', danger: '#b00', info: '#08c',
  muted: '#777', primary: '#075', success: '#090', surface: '#eee', text: '#111', warning: '#c70' };

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}

describe('authenticated exception handover TEST_ENV route', () => {
  beforeEach(() => { persisted.clear(); transport.get.mockReset(); transport.post.mockReset(); });

  it('retains a confirmed turn operation after a lost response, then reconciles without another write', async () => {
    const { createAuthenticatedExceptionHandoverStorage } = await import('@/src/lib/exception-handover-auth');
    const state = createEmptyExceptionHandoverState(shift.id);
    let serverState = state;
    let revision = 0;
    let actor = 'auth0|alice';
    let loseResponse = true;
    const receipts = new Map<string, { status: string; contentHash: string; revision: number }>();
    transport.get.mockImplementation(async (path: string) => {
      if (path === '/api/me/capabilities') return { userSub: actor, unitIds: ['icu-a'],
        permissions: { canWriteHandover: true }, exceptionHandover: { candidateEnabled: true } };
      if (path.endsWith(shift.id)) return { ...shift, revision, state: serverState };
      const receipt = receipts.get(path);
      if (receipt) return receipt;
      throw { status: 404 };
    });
    transport.post.mockImplementation(async (path: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body)) as { state: typeof state; expectedRevision: number };
      if (revision !== body.expectedRevision) throw { status: 409 };
      const receipt = { status: 'confirmed', revision: ++revision,
        contentHash: sha256(JSON.stringify(canonical(body.state))) };
      receipts.set(path, receipt);
      serverState = body.state;
      if (loseResponse) { loseResponse = false; throw new Error('response lost after commit'); }
      return receipt;
    });
    const first = createAuthenticatedExceptionHandoverStorage(shift, actor);
    await first.load(shift.id);
    const updated = { ...state, interactionCounts: { reviewed: 1 } };
    await expect(first.save(updated)).rejects.toThrow('response lost');
    expect(persisted.size).toBe(1);
    expect(transport.post).toHaveBeenCalledTimes(1);
    actor = 'auth0|bob';
    const other = createAuthenticatedExceptionHandoverStorage(shift, actor);
    await other.load(shift.id);
    expect(transport.post).toHaveBeenCalledTimes(1);
    actor = 'auth0|alice';
    const restarted = createAuthenticatedExceptionHandoverStorage(shift, actor);
    expect((await restarted.load(shift.id)).interactionCounts).toEqual({ reviewed: 1 });
    expect(transport.post).toHaveBeenCalledTimes(1);
    expect((await import('@/src/lib/encryptedStorage')).encryptedGetItem).toBeDefined();
  });

  it('keeps server-attributed event history stable across successive saves', async () => {
    const { createAuthenticatedExceptionHandoverStorage } = await import('@/src/lib/exception-handover-auth');
    let serverState = createEmptyExceptionHandoverState(shift.id);
    let revision = 0;
    transport.get.mockImplementation(async (path: string) => {
      if (path === '/api/me/capabilities') return { userSub: 'auth0|alice', unitIds: ['icu-a'],
        permissions: { canWriteHandover: true }, exceptionHandover: { candidateEnabled: true } };
      if (path.endsWith(shift.id)) return { ...shift, revision, state: serverState };
      throw { status: 404 };
    });
    transport.post.mockImplementation(async (_path: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body)) as { state: typeof serverState; expectedRevision: number };
      if (body.expectedRevision !== revision ||
          JSON.stringify(body.state.events.slice(0, serverState.events.length)) !== JSON.stringify(serverState.events)) {
        throw { status: 409 };
      }
      serverState = body.state;
      revision += 1;
      return { status: 'confirmed', contentHash: sha256(JSON.stringify(canonical(body.state))), revision };
    });
    const storage = createAuthenticatedExceptionHandoverStorage(shift, 'auth0|alice');
    await storage.load(shift.id);
    const event = { idempotencyKey: 'event-1', kind: 'brief_review' as const,
      actorId: 'auth0|alice', actorName: 'Alice', actorKind: 'outgoing' as const,
      recordedAt: '2026-10-28T10:00:00Z', shiftId: shift.id, patientId: '1' };
    await storage.save({ ...serverState, events: [event] });
    expect(serverState.events[0].actorName).toBe('auth0|alice');
    await storage.save({ ...serverState, events: [event], interactionCounts: { reviewed: 1 } });
    expect(revision).toBe(2);
    expect(transport.post).toHaveBeenCalledTimes(2);
  });

  it('shows an authenticated R candidate without a demo actor or invented source', async () => {
    const state = createEmptyExceptionHandoverState(shift.id);
    const screen = render(<UnitExceptionHandover candidateMode shiftId={shift.id}
      authenticatedActor={{ userId: 'auth0|alice', displayName: 'Alice', kind: 'outgoing' }}
      patients={[{ patientId: '1', name: 'Caso sintético', bedLabel: '1', unitName: 'UCI A',
        status: 'unchanged', change: '', currentRisk: '', nextAction: '', owner: '', dueAt: '',
        contingency: { trigger: '', response: '' }, lastSummaryAt: '', lastSummarySource: '',
        criticalItems: [] }]}
      groupScope={{ viewScope: 'icu-a', members: [{ patientId: '1', unitId: 'icu-a' }] }}
      storage={{ durability: 'durable', load: async () => state, save: async () => {}, clear: async () => {} }}
      colors={colors} onOpenFullHandover={() => {}} />);
    await act(async () => {});
    expect(screen.getByText('R. REVISIÓN REQUERIDA · 1')).toBeTruthy();
    expect(screen.getByText(/TEST_ENV · REGISTRO OPERATIVO/)).toBeTruthy();
    expect(screen.queryByText(/DEMO SINTÉTICA/)).toBeNull();
  });

  it('reuses the creation key after a lost response and never selects an unconfirmed turn', async () => {
    const { createConfirmedExceptionShift } = await import('@/src/lib/exception-handover-auth');
    transport.get.mockResolvedValue({ userSub: 'auth0|alice', unitIds: ['icu-a'],
      permissions: { canWriteHandover: true }, exceptionHandover: { candidateEnabled: true } });
    const input = { unitId: 'icu-a', periodStart: shift.periodStart,
      periodEnd: shift.periodEnd, description: shift.description };
    const requests: string[] = [];
    transport.post.mockImplementation(async (_path: string, options: RequestInit) => {
      requests.push(JSON.parse(String(options.body)).operationId);
      if (requests.length === 1) throw new Error('response lost');
      return shift;
    });
    await expect(createConfirmedExceptionShift('auth0|alice', input)).rejects.toThrow('response lost');
    expect(persisted.size).toBe(1);
    expect(await createConfirmedExceptionShift('auth0|alice', input)).toEqual(shift);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toBe(requests[1]);
  });

  it('does not send a pending operation after a session changes actor or unit scope', async () => {
    const { createAuthenticatedExceptionHandoverStorage } = await import('@/src/lib/exception-handover-auth');
    let actor = 'auth0|alice';
    transport.get.mockImplementation(async (path: string) => path === '/api/me/capabilities'
      ? { userSub: actor, unitIds: ['icu-a'], permissions: { canWriteHandover: true },
          exceptionHandover: { candidateEnabled: true } }
      : path.endsWith(shift.id)
        ? { ...shift, state: createEmptyExceptionHandoverState(shift.id) }
        : Promise.reject({ status: 404 }));
    transport.post.mockRejectedValue(new Error('offline'));
    const storage = createAuthenticatedExceptionHandoverStorage(shift, 'auth0|alice');
    await storage.load(shift.id);
    await expect(storage.save({ ...createEmptyExceptionHandoverState(shift.id),
      interactionCounts: { reviewed: 1 } })).rejects.toThrow('offline');
    expect(transport.post).toHaveBeenCalledTimes(1);
    actor = 'auth0|bob';
    await expect(storage.replayPending()).rejects.toThrow('EXCEPTION_HANDOVER_AUTH_CHANGED');
    expect(transport.post).toHaveBeenCalledTimes(1);
  });
});
