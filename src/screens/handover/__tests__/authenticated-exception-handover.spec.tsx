import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from 'js-sha256';
import { createEmptyExceptionHandoverState } from '@/src/lib/exception-handover-storage';
import { UnitExceptionHandover } from '../UnitExceptionHandover';
import receiptFixture from '../../../../tests/fixtures/c12-receipt-canonical.json';

const transport = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
const persisted = vi.hoisted(() => new Map<string, string>());
const localSession = vi.hoisted(() => ({ current: {
  userId: 'auth0|alice', units: ['icu-a'], accessToken: 'synthetic-token',
  expiresAt: '2030-10-29T08:00:00Z', mode: 'normal',
} as { userId: string; units: string[]; accessToken: string; expiresAt: string; mode: string } | null }));
vi.mock('@/src/lib/api', () => ({ apiGet: transport.get, apiPost: transport.post }));
vi.mock('@/src/security/OAuthService', () => ({ loadStoredSession: async () => localSession.current }));
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
  expiresAt: '2030-10-29T08:00:00Z' };
const colors = { background: '#fff', border: '#ccc', danger: '#b00', info: '#08c',
  muted: '#777', primary: '#075', success: '#090', surface: '#eee', text: '#111', warning: '#c70' };

function backendReceipt(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(backendReceipt).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = value as Record<string, unknown>;
    return `{${Object.keys(entries).sort().map((key) => `${JSON.stringify(key)}:${backendReceipt(entries[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

describe('authenticated exception handover TEST_ENV route', () => {
  beforeEach(() => {
    persisted.clear(); transport.get.mockReset(); transport.post.mockReset();
    localSession.current = { userId: 'auth0|alice', units: ['icu-a'], accessToken: 'synthetic-token',
      expiresAt: '2030-10-29T08:00:00Z', mode: 'normal' };
  });

  it('restores two encrypted pending edits offline and confirms each once after reconnect', async () => {
    const { createAuthenticatedExceptionHandoverStorage } = await import('@/src/lib/exception-handover-auth');
    let serverState = createEmptyExceptionHandoverState(shift.id);
    let revision = 0;
    let offline = false;
    let capabilitiesReachable = true;
    const receipts = new Map<string, { status: string; contentHash: string; revision: number }>();
    transport.get.mockImplementation(async (path: string) => {
      if (offline && (path !== '/api/me/capabilities' || !capabilitiesReachable)) throw new Error('offline');
      if (path === '/api/me/capabilities') return { userSub: 'auth0|alice', unitIds: ['icu-a'],
        permissions: { canWriteHandover: true }, exceptionHandover: { candidateEnabled: true } };
      if (path.endsWith(shift.id)) return { ...shift, revision, state: serverState };
      if (receipts.has(path)) return receipts.get(path);
      throw { status: 404 };
    });
    transport.post.mockImplementation(async (path: string, options: RequestInit) => {
      if (offline) throw new Error('offline');
      const body = JSON.parse(String(options.body)) as { state: typeof serverState; expectedRevision: number };
      if (body.expectedRevision !== revision) throw { status: 409, details: '{"code":"revision_conflict"}' };
      serverState = body.state;
      const receipt = { status: 'confirmed', contentHash: sha256(backendReceipt(body.state)), revision: ++revision };
      receipts.set(path, receipt);
      return receipt;
    });
    const first = createAuthenticatedExceptionHandoverStorage(shift, 'auth0|alice');
    await first.load(shift.id);
    offline = true;
    const firstEdit = { ...serverState, briefDrafts: { '1': { change: 'Edición local', currentRisk: '',
      nextAction: '', owner: '', contingency: '' } } };
    await expect(first.save(firstEdit)).rejects.toThrow('offline');
    const restarted = createAuthenticatedExceptionHandoverStorage(shift, 'auth0|alice');
    const restored = await restarted.load(shift.id);
    expect(restored.briefDrafts['1'].change).toBe('Edición local');
    expect(restarted.syncStatus).toBe('pending');
    await expect(restarted.save(restored)).rejects.toThrow('offline');
    capabilitiesReachable = false;
    const fullyOffline = createAuthenticatedExceptionHandoverStorage(shift, 'auth0|alice');
    expect((await fullyOffline.load(shift.id)).briefDrafts['1'].change).toBe('Edición local');
    const secondEdit = { ...restored, interactionCounts: { '1': 1 } };
    await expect(fullyOffline.save(secondEdit)).rejects.toThrow('offline');
    offline = false;
    expect((await fullyOffline.load(shift.id)).interactionCounts).toEqual({ '1': 1 });
    expect(serverState.briefDrafts['1'].change).toBe('Edición local');
    expect(revision).toBe(2);
    expect(transport.post).toHaveBeenCalledTimes(2);
    expect(fullyOffline.syncStatus).toBe('confirmed');
  });

  it('hydrates the mounted board from encrypted cache offline with and without a conflict', async () => {
    const { createAuthenticatedExceptionHandoverStorage } = await import('@/src/lib/exception-handover-auth');
    const state = createEmptyExceptionHandoverState(shift.id);
    let offline = false;
    transport.get.mockImplementation(async (path: string) => {
      if (offline) throw new Error('offline');
      if (path === '/api/me/capabilities') return { userSub: 'auth0|alice', unitIds: ['icu-a'],
        permissions: { canWriteHandover: true }, exceptionHandover: { candidateEnabled: true } };
      if (path.endsWith(shift.id)) return { ...shift, state };
      throw { status: 404 };
    });
    transport.post.mockRejectedValue({ status: 409, details: '{"code":"revision_conflict"}' });
    const storage = createAuthenticatedExceptionHandoverStorage(shift, 'auth0|alice');
    await storage.load(shift.id);
    offline = true;
    const patient = { patientId: '1', name: 'Caso sintético', bedLabel: '1', unitName: 'UCI A',
      status: 'unchanged' as const, change: '', currentRisk: '', nextAction: '', owner: '', dueAt: '',
      contingency: { trigger: '', response: '' }, lastSummaryAt: '', lastSummarySource: '',
      criticalItems: [] };
    const board = () => <UnitExceptionHandover candidateMode shiftId={shift.id}
      authenticatedActor={{ userId: 'auth0|alice', displayName: 'Alice', kind: 'outgoing' }}
      patients={[patient]} groupScope={{ viewScope: 'icu-a', members: [{ patientId: '1', unitId: 'icu-a' }] }}
      storage={createAuthenticatedExceptionHandoverStorage(shift, 'auth0|alice')}
      colors={colors} onOpenFullHandover={() => {}} />;
    const withoutConflict = render(board());
    await act(async () => {});
    expect(withoutConflict.getByText('R. REVISIÓN REQUERIDA · 1')).toBeTruthy();
    expect(withoutConflict.queryByTestId('discard-exception-conflicts')).toBeNull();
    withoutConflict.unmount();
    offline = false;
    await expect(storage.save({ ...state, interactionCounts: { '1': 1 } }))
      .rejects.toThrow('EXCEPTION_HANDOVER_CONFLICT');
    offline = true;
    const withConflict = render(board());
    await act(async () => {});
    expect(withConflict.getByText('R. REVISIÓN REQUERIDA · 1')).toBeTruthy();
    expect(withConflict.getByTestId('discard-exception-conflicts')).toBeTruthy();
    expect(withConflict.getByText(/contenido local cifrado se conserva/)).toBeTruthy();
  });

  it('inspects actor-scoped conflicts offline but rejects logout, expiry and another scope', async () => {
    const { createAuthenticatedExceptionHandoverStorage } = await import('@/src/lib/exception-handover-auth');
    const empty = createEmptyExceptionHandoverState(shift.id);
    let offline = false;
    transport.get.mockImplementation(async (path: string) => {
      if (offline) throw new Error('offline');
      if (path === '/api/me/capabilities') return { userSub: 'auth0|alice', unitIds: ['icu-a'],
        permissions: { canWriteHandover: true }, exceptionHandover: { candidateEnabled: true } };
      if (path.endsWith(shift.id)) return { ...shift, state: empty };
      throw { status: 404 };
    });
    transport.post.mockRejectedValue({ status: 409, details: '{"code":"revision_conflict"}' });
    const first = createAuthenticatedExceptionHandoverStorage(shift, 'auth0|alice');
    await first.load(shift.id);
    await expect(first.save({ ...empty, interactionCounts: { '1': 1 } }))
      .rejects.toThrow('EXCEPTION_HANDOVER_CONFLICT');
    offline = true;
    const restarted = createAuthenticatedExceptionHandoverStorage(shift, 'auth0|alice');
    expect((await restarted.load(shift.id)).interactionCounts).toEqual({});
    expect(await restarted.listConflicts?.()).toBe(1);
    expect(restarted.syncStatus).toBe('conflict');
    const other = createAuthenticatedExceptionHandoverStorage({ ...shift, id: 'another-shift' }, 'auth0|alice');
    expect(await other.listConflicts?.()).toBe(0);
    localSession.current = { ...localSession.current!, userId: 'auth0|bob' };
    await expect(restarted.listConflicts?.()).rejects.toThrow('EXCEPTION_HANDOVER_AUTH_CHANGED');
    localSession.current = { ...localSession.current!, userId: 'auth0|alice', units: ['icu-b'] };
    await expect(restarted.listConflicts?.()).rejects.toThrow('EXCEPTION_HANDOVER_AUTH_CHANGED');
    localSession.current = { ...localSession.current!, units: ['icu-a'], expiresAt: '2020-01-01T00:00:00Z' };
    await expect(restarted.listConflicts?.()).rejects.toThrow('EXCEPTION_HANDOVER_AUTH_CHANGED');
    localSession.current = null;
    await expect(restarted.listConflicts?.()).rejects.toThrow('EXCEPTION_HANDOVER_AUTH_CHANGED');
  });

  it('uses the backend canonical bytes for numeric keys, nested values and Unicode', async () => {
    const { canonicalReceiptJson } = await import('@/src/lib/exception-handover-auth');
    expect(canonicalReceiptJson(receiptFixture.content)).toBe(receiptFixture.canonical);
    expect(sha256(canonicalReceiptJson(receiptFixture.content))).toBe(receiptFixture.sha256);
    expect(canonicalReceiptJson({ ...receiptFixture.content,
      interactionCounts: { '10': 1, '2': 0 } })).toBe(receiptFixture.canonical);
  });

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
        contentHash: sha256(backendReceipt(body.state)) };
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
      return { status: 'confirmed', contentHash: sha256(backendReceipt(body.state)), revision };
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

  it('retains a rejected revision, refreshes shared state and requires explicit reconciliation', async () => {
    const { createAuthenticatedExceptionHandoverStorage } = await import('@/src/lib/exception-handover-auth');
    let actor = 'auth0|alice';
    let serverState = createEmptyExceptionHandoverState(shift.id);
    let revision = 0;
    transport.get.mockImplementation(async (path: string) => {
      if (path === '/api/me/capabilities') return { userSub: actor, unitIds: ['icu-a'],
        permissions: { canWriteHandover: true }, exceptionHandover: { candidateEnabled: true } };
      if (path.endsWith(shift.id)) return { ...shift, revision, state: serverState };
      throw { status: 404 };
    });
    transport.post.mockImplementation(async (_path: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body)) as { state: typeof serverState; expectedRevision: number };
      if (body.expectedRevision !== revision) throw { status: 409, details: '{"code":"revision_conflict"}' };
      serverState = body.state;
      revision += 1;
      return { status: 'confirmed', contentHash: sha256(backendReceipt(body.state)), revision };
    });
    const alice = createAuthenticatedExceptionHandoverStorage(shift, actor);
    await alice.load(shift.id);
    actor = 'auth0|bob';
    localSession.current = { ...localSession.current!, userId: actor };
    const bob = createAuthenticatedExceptionHandoverStorage(shift, actor);
    await bob.load(shift.id);
    await bob.save({ ...serverState, interactionCounts: { remote: 1 } });
    actor = 'auth0|alice';
    localSession.current = { ...localSession.current!, userId: actor };
    await expect(alice.save({ ...createEmptyExceptionHandoverState(shift.id),
      interactionCounts: { local: 1 } })).rejects.toThrow('EXCEPTION_HANDOVER_CONFLICT');
    expect(await alice.listConflicts?.()).toBe(1);
    const rejected = JSON.parse([...persisted.values()][0].slice('encrypted:'.length)) as {
      operations: { status: string; conflictReason: string; state: typeof serverState }[];
    };
    expect(rejected.operations[0]).toMatchObject({ status: 'conflict', conflictReason: 'revision_conflict',
      state: { interactionCounts: { local: 1 } } });
    const attempts = transport.post.mock.calls.length;
    const restarted = createAuthenticatedExceptionHandoverStorage(shift, actor);
    const authorized = await restarted.load(shift.id);
    expect(authorized.interactionCounts).toEqual({ remote: 1 });
    expect(await restarted.listConflicts?.()).toBe(1);
    expect(transport.post).toHaveBeenCalledTimes(attempts);
    await expect(restarted.save({ ...authorized, interactionCounts: { remote: 2 } }))
      .rejects.toThrow('EXCEPTION_HANDOVER_CONFLICT');
    await restarted.discardConflicts?.();
    await restarted.save({ ...authorized, interactionCounts: { remote: 2 } });
    expect(revision).toBe(2);
    expect(serverState.interactionCounts).toEqual({ remote: 2 });
  });

  it('distinguishes operation conflicts and never retries them as uncertain responses', async () => {
    const { createAuthenticatedExceptionHandoverStorage } = await import('@/src/lib/exception-handover-auth');
    transport.get.mockImplementation(async (path: string) => path === '/api/me/capabilities'
      ? { userSub: 'auth0|alice', unitIds: ['icu-a'], permissions: { canWriteHandover: true },
          exceptionHandover: { candidateEnabled: true } }
      : path.endsWith(shift.id)
        ? { ...shift, state: createEmptyExceptionHandoverState(shift.id) }
        : Promise.reject({ status: 404 }));
    transport.post.mockRejectedValue({ status: 409, details: '{"code":"operation_conflict"}' });
    const storage = createAuthenticatedExceptionHandoverStorage(shift, 'auth0|alice');
    await storage.load(shift.id);
    await expect(storage.save({ ...createEmptyExceptionHandoverState(shift.id),
      interactionCounts: { reviewed: 1 } })).rejects.toThrow('EXCEPTION_HANDOVER_CONFLICT');
    const rejected = JSON.parse([...persisted.values()][0].slice('encrypted:'.length)) as {
      operations: { conflictReason: string }[];
    };
    expect(rejected.operations[0].conflictReason).toBe('operation_conflict');
    await storage.load(shift.id);
    expect(transport.post).toHaveBeenCalledTimes(1);
    transport.get.mockImplementation(async (path: string) => {
      if (path === '/api/me/capabilities') return { userSub: 'auth0|alice', unitIds: ['icu-a'],
        permissions: { canWriteHandover: true }, exceptionHandover: { candidateEnabled: true } };
      throw new Error('offline');
    });
    expect((await storage.load(shift.id)).interactionCounts).toEqual({});
    expect(storage.syncStatus).toBe('conflict');
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

  it('shows a persisted conflict and requires an explicit discard before the board resumes', async () => {
    let conflicts = 1;
    const state = createEmptyExceptionHandoverState(shift.id);
    const storage = { durability: 'durable' as const, load: async () => state,
      save: async () => { if (conflicts) throw new Error('EXCEPTION_HANDOVER_CONFLICT'); },
      clear: async () => {}, listConflicts: async () => conflicts,
      discardConflicts: async () => { conflicts = 0; } };
    const screen = render(<UnitExceptionHandover candidateMode shiftId={shift.id}
      authenticatedActor={{ userId: 'auth0|alice', displayName: 'Alice', kind: 'outgoing' }}
      patients={[{ patientId: '1', name: 'Caso sintético', bedLabel: '1', unitName: 'UCI A',
        status: 'unchanged', change: '', currentRisk: '', nextAction: '', owner: '', dueAt: '',
        contingency: { trigger: '', response: '' }, lastSummaryAt: '', lastSummarySource: '',
        criticalItems: [] }]}
      groupScope={{ viewScope: 'icu-a', members: [{ patientId: '1', unitId: 'icu-a' }] }}
      storage={storage} colors={colors} onOpenFullHandover={() => {}} />);
    await act(async () => {});
    expect(screen.getByText(/contenido local cifrado se conserva/)).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('discard-exception-conflicts')); });
    expect(conflicts).toBe(0);
    expect(screen.queryByTestId('discard-exception-conflicts')).toBeNull();
  });

  it('requires an explicit zoned R target, persists it and completes the two-actor candidate', async () => {
    const patient = { patientId: '1', name: 'Caso sintético', bedLabel: '1', unitName: 'UCI A',
      status: 'unchanged' as const, change: '', currentRisk: '', nextAction: '', owner: '', dueAt: '',
      contingency: { trigger: '', response: '' }, lastSummaryAt: '', lastSummarySource: '',
      criticalItems: [] };
    let saved = createEmptyExceptionHandoverState(shift.id);
    const storage = { durability: 'durable' as const, load: async () => saved,
      save: async (state: typeof saved) => { saved = state; }, clear: async () => {} };
    const board = (userId: string, kind: 'outgoing' | 'incoming') =>
      <UnitExceptionHandover candidateMode shiftId={shift.id}
        authenticatedActor={{ userId, displayName: userId, kind }} patients={[patient]}
        groupScope={{ viewScope: 'icu-a', members: [{ patientId: '1', unitId: 'icu-a' }] }}
        storage={storage} colors={colors} onOpenFullHandover={() => {}}
        now={() => '2026-10-28T10:00:00Z'} />;
    const incoming = render(board('auth0|bob', 'incoming'));
    await act(async () => {});
    fireEvent.press(incoming.getByTestId('open-exception-1'));
    expect(incoming.getByTestId('transfer-r-1').props.disabled).toBe(true);
    fireEvent.changeText(incoming.getByTestId('r-target-at-1'), 'invalid');
    expect(incoming.getByTestId('transfer-r-1').props.disabled).toBe(true);
    fireEvent.changeText(incoming.getByTestId('r-target-at-1'), '2026-02-31T15:00:00Z');
    expect(incoming.getByTestId('transfer-r-1').props.disabled).toBe(true);
    fireEvent.changeText(incoming.getByTestId('r-target-at-1'), '2026-10-28T15:00:00Z');
    expect(incoming.getByTestId('transfer-r-1').props.disabled).toBe(false);
    fireEvent.press(incoming.getByTestId('transfer-r-1'));
    await act(async () => {});
    expect(saved.briefDrafts['1'].targetAt).toBe('2026-10-28T15:00:00Z');
    expect(saved.events.find((event) => event.kind === 'r_transferred')?.targetAt)
      .toBe('2026-10-28T15:00:00Z');
    incoming.unmount();
    const outgoing = render(board('auth0|alice', 'outgoing'));
    await act(async () => {});
    await act(async () => { fireEvent.press(outgoing.getByTestId('confirm-outgoing-transfer')); });
    expect(saved.frozenManifest?.hash).toBeTruthy();
    outgoing.unmount();
    const receiver = render(board('auth0|bob', 'incoming'));
    await act(async () => {});
    fireEvent.press(receiver.getByTestId('open-exception-1'));
    expect(receiver.getByTestId('r-target-at-1').props.value).toBe('2026-10-28T15:00:00Z');
    await act(async () => { fireEvent.press(receiver.getByTestId('confirm-incoming-attestation')); });
    expect(saved.acceptedReferences).toHaveLength(1);
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
