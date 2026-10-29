import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
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
const patientListAuth = vi.hoisted(() => ({ enabled: false,
  session: { userId: 'auth0|alice', units: ['sjd-a'], accessToken: 'synthetic-token',
    expiresAt: '2030-10-29T08:00:00Z', mode: 'normal', roles: ['nurse'], displayName: 'Alice' },
  capabilities: { userSub: 'auth0|alice', unitIds: ['sjd-a'],
    permissions: { canWriteHandover: true, canReadPatients: true, canCreatePatients: false,
      canSignHandover: false, canViewAudit: false, canSendAuditEvents: false, isAdmin: false },
    exceptionHandover: { candidateEnabled: true, pilotEnabled: false, reasons: [] } },
}));
vi.mock('@/src/lib/api', () => ({ apiGet: transport.get, apiPost: transport.post }));
vi.mock('react-native', async (importOriginal) => {
  const native = await importOriginal<typeof import('react-native')>();
  const react = await import('react');
  return { ...native, FlatList: ({ ListHeaderComponent, data, renderItem }: {
    ListHeaderComponent?: React.ReactNode; data?: unknown[];
    renderItem?: (input: { item: unknown; index: number }) => React.ReactNode;
  }) => react.createElement(native.View, null, ListHeaderComponent,
    ...(data ?? []).map((item, index) => react.createElement(react.Fragment, { key: index },
      renderItem?.({ item, index })))),
  };
});
vi.mock('@/src/security/auth', () => ({ useAuth: () => patientListAuth.enabled ? {
  session: patientListAuth.session, capabilities: patientListAuth.capabilities,
} : { session: null, capabilities: null } }));
vi.mock('@react-navigation/native', () => ({ useFocusEffect: () => {} }));
vi.mock('@/src/lib/queue', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/src/lib/queue')>(), listOfflineQueue: async () => [],
}));
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
    patientListAuth.enabled = false;
    patientListAuth.session = { ...patientListAuth.session, userId: 'auth0|alice' };
    patientListAuth.capabilities = { ...patientListAuth.capabilities, userSub: 'auth0|alice' };
    localSession.current = { userId: 'auth0|alice', units: ['icu-a'], accessToken: 'synthetic-token',
      expiresAt: '2030-10-29T08:00:00Z', mode: 'normal' };
  });

  it('offers only recently confirmed shifts from encrypted cache to the same live actor and unit offline', async () => {
    const { listConfirmedExceptionShifts, listCachedConfirmedExceptionShifts } =
      await import('@/src/lib/exception-handover-auth');
    expect(await listCachedConfirmedExceptionShifts('auth0|alice', 'icu-a')).toEqual([]);
    transport.get.mockImplementation(async (path: string) => path === '/api/me/capabilities'
      ? { userSub: 'auth0|alice', unitIds: ['icu-a'], permissions: { canWriteHandover: true },
          exceptionHandover: { candidateEnabled: true } }
      : { shifts: [shift] });
    expect(await listConfirmedExceptionShifts('auth0|alice', 'icu-a')).toEqual([shift]);
    expect(await listCachedConfirmedExceptionShifts('auth0|alice', 'icu-a')).toEqual([shift]);
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 6 * 60 * 1000);
    expect(await listCachedConfirmedExceptionShifts('auth0|alice', 'icu-a')).toEqual([]);
    clock.mockRestore();
    transport.get.mockImplementation(async (path: string) => path === '/api/me/capabilities'
      ? { userSub: 'auth0|alice', unitIds: ['icu-a'], permissions: { canWriteHandover: true },
          exceptionHandover: { candidateEnabled: true } }
      : { shifts: [{ ...shift, expiresAt: '2020-01-01T00:00:00Z' }] });
    await listConfirmedExceptionShifts('auth0|alice', 'icu-a');
    expect(await listCachedConfirmedExceptionShifts('auth0|alice', 'icu-a')).toEqual([]);
    await expect(listCachedConfirmedExceptionShifts('auth0|alice', 'icu-b'))
      .rejects.toThrow('EXCEPTION_HANDOVER_AUTH_CHANGED');
    localSession.current = { ...localSession.current!, userId: 'auth0|bob' };
    await expect(listCachedConfirmedExceptionShifts('auth0|alice', 'icu-a'))
      .rejects.toThrow('EXCEPTION_HANDOVER_AUTH_CHANGED');
    localSession.current = null;
    await expect(listCachedConfirmedExceptionShifts('auth0|alice', 'icu-a'))
      .rejects.toThrow('EXCEPTION_HANDOVER_AUTH_CHANGED');
    localSession.current = { ...localSession.current!, userId: 'auth0|alice',
      expiresAt: '2020-01-01T00:00:00Z' };
    await expect(listCachedConfirmedExceptionShifts('auth0|alice', 'icu-a'))
      .rejects.toThrow('EXCEPTION_HANDOVER_AUTH_CHANGED');
  });

  it('restores a confirmed shift and pending board through mounted PatientList with all endpoints offline', async () => {
    const { default: PatientList } = await import('@/src/screens/PatientList');
    const { setSelectedUnitId } = await import('@/src/state/filterStore');
    const { createAuthenticatedExceptionHandoverStorage } = await import('@/src/lib/exception-handover-auth');
    const unitShift = { ...shift, unitId: 'sjd-a' };
    const state = createEmptyExceptionHandoverState(shift.id);
    let serverState = state;
    let revision = 0;
    let offline = false;
    let denyList = false;
    patientListAuth.enabled = true;
    localSession.current = { ...localSession.current!, units: ['sjd-a'] };
    transport.get.mockImplementation(async (path: string) => {
      if (offline) throw new Error('offline');
      if (path === '/api/me/capabilities') return { userSub: 'auth0|alice', unitIds: ['sjd-a'],
        permissions: { canWriteHandover: true }, exceptionHandover: { candidateEnabled: true } };
      if (path.startsWith('/api/patients')) return [{ id: 'p1', name: 'Caso sintético', unitId: 'sjd-a' }];
      if (path.startsWith('/api/exception-shifts?')) {
        if (denyList) throw { status: 403 };
        return { shifts: [unitShift] };
      }
      if (path.endsWith(shift.id)) return { ...unitShift, revision, state: serverState };
      throw { status: 404 };
    });
    transport.post.mockImplementation(async (_path: string, options: RequestInit) => {
      const body = JSON.parse(String(options.body)) as { state: typeof state };
      serverState = body.state;
      revision += 1;
      return { status: 'confirmed', contentHash: sha256(backendReceipt(body.state)), revision };
    });
    const navigation = { navigate: vi.fn(), setOptions: vi.fn() } as unknown as
      React.ComponentProps<typeof PatientList>['navigation'];
    const mount = () => render(<PatientList navigation={navigation}
      route={{ key: 'c12-patient-list', name: 'PatientList' }} />);
    const selectPsychUnit = async (screen: ReturnType<typeof mount>) => {
      await act(async () => {});
      await act(async () => { fireEvent.press(screen.getByText('Psiquiatria y salud mental')); });
      await act(async () => { setSelectedUnitId('sjd-a'); });
      await waitFor(() => expect(screen.getByTestId('authenticated-exception-handover')).toBeTruthy());
    };
    setSelectedUnitId('all');
    const online = mount();
    await selectPsychUnit(online);
    await waitFor(() => expect(online.getByLabelText(`Seleccionar turno ${shift.description}`)).toBeTruthy());
    await act(async () => { fireEvent.press(online.getByLabelText(`Seleccionar turno ${shift.description}`)); });
    await waitFor(() => expect(online.getByTestId('unit-exception-handover')).toBeTruthy());
    online.unmount();
    denyList = true;
    setSelectedUnitId('all');
    const denied = mount();
    await selectPsychUnit(denied);
    await waitFor(() => expect(denied.getByText(/sesión o permisos rechazados/)).toBeTruthy());
    expect(denied.queryByLabelText(`Seleccionar turno ${shift.description}`)).toBeNull();
    denied.unmount();
    denyList = false;
    const local = createAuthenticatedExceptionHandoverStorage(unitShift, 'auth0|alice');
    await local.load(shift.id);
    offline = true;
    await expect(local.save({ ...serverState, interactionCounts: { 'p1': 1 } })).rejects.toThrow('offline');
    setSelectedUnitId('all');
    const restored = mount();
    await selectPsychUnit(restored);
    await waitFor(() => expect(restored.getByText(/turnos confirmados disponibles solo en caché local/i)).toBeTruthy());
    await act(async () => { fireEvent.press(restored.getByLabelText(`Seleccionar turno ${shift.description}`)); });
    await waitFor(() => expect(restored.getByTestId('unit-exception-handover')).toBeTruthy());
    expect(restored.getByTestId('exception-patient-p1')).toBeTruthy();
    expect(restored.getByText(/Trabajo local cifrado pendiente de confirmación compartida/)).toBeTruthy();
    const postsBeforeReconnect = transport.post.mock.calls.length;
    offline = false;
    await act(async () => { fireEvent.press(restored.getByTestId('reconcile-exception-pending')); });
    await waitFor(() => expect(restored.queryByText(/Trabajo local cifrado pendiente de confirmación compartida/)).toBeNull());
    expect(serverState.interactionCounts).toEqual({ p1: 1 });
    expect(transport.post).toHaveBeenCalledTimes(postsBeforeReconnect + 1);
    restored.unmount();
    offline = true;
    patientListAuth.session = { ...patientListAuth.session, userId: 'auth0|bob' };
    patientListAuth.capabilities = { ...patientListAuth.capabilities, userSub: 'auth0|bob' };
    localSession.current = { ...localSession.current!, userId: 'auth0|bob' };
    setSelectedUnitId('all');
    const otherActor = mount();
    await selectPsychUnit(otherActor);
    expect(otherActor.queryByLabelText(`Seleccionar turno ${shift.description}`)).toBeNull();
    otherActor.unmount();
    patientListAuth.session = { ...patientListAuth.session, userId: 'auth0|alice' };
    patientListAuth.capabilities = { ...patientListAuth.capabilities, userSub: 'auth0|alice' };
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

  it.each(['outgoing_transfer', 'incoming_attestation'] as const)(
    'recovers the persisted %s event and receipt after a lost response and a restart', async (kind) => {
      const { createAuthenticatedExceptionHandoverStorage } = await import('@/src/lib/exception-handover-auth');
      const actor = kind === 'outgoing_transfer' ? 'auth0|alice' : 'auth0|bob';
      localSession.current = { ...localSession.current!, userId: actor };
      let serverState = createEmptyExceptionHandoverState(shift.id);
      let revision = 0;
      const receipts = new Map<string, { status: string; contentHash: string }>();
      transport.get.mockImplementation(async (path: string) => {
        if (path === '/api/me/capabilities') return { userSub: actor, unitIds: ['icu-a'],
          permissions: { canWriteHandover: true }, exceptionHandover: { candidateEnabled: true } };
        if (path.endsWith(shift.id)) return { ...shift, revision, state: serverState };
        if (receipts.has(path)) return receipts.get(path);
        throw { status: 404 };
      });
      transport.post.mockImplementation(async (path: string, options: RequestInit) => {
        const body = JSON.parse(String(options.body)) as { state: typeof serverState; expectedRevision: number };
        expect(body.expectedRevision).toBe(revision);
        serverState = body.state;
        revision += 1;
        const receipt = { status: 'confirmed', contentHash: sha256(backendReceipt(body.state)) };
        receipts.set(path, receipt);
        throw new Error('response lost after commit');
      });
      const initial = createAuthenticatedExceptionHandoverStorage(shift, actor);
      await initial.load(shift.id);
      const event = { idempotencyKey: `synthetic-${kind}`, kind, actorId: actor,
        actorName: actor, actorKind: kind === 'outgoing_transfer' ? 'outgoing' as const : 'incoming' as const,
        recordedAt: '2026-10-28T10:00:00Z', shiftId: shift.id,
        manifestHash: 'synthetic-manifest', context: { key: 'synthetic-context', shiftId: shift.id, revision: 1 } };
      await expect(initial.save({ ...serverState, events: [event] })).rejects.toThrow('response lost');
      const pending = JSON.parse([...persisted.values()][0].slice('encrypted:'.length)) as {
        operations: { operationId: string; state: typeof serverState }[];
      };
      expect(pending.operations[0].state.events).toEqual([event]);
      const operationId = pending.operations[0].operationId;
      const restarted = createAuthenticatedExceptionHandoverStorage(shift, actor);
      expect((await restarted.load(shift.id)).events).toEqual([event]);
      expect(revision).toBe(1);
      expect(transport.post).toHaveBeenCalledTimes(1);
      expect(receipts.has(`/api/exception-shifts/${shift.id}/operations/${operationId}`)).toBe(true);
    },
  );

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

  it.each(['patient_scope_invalid', 'history_modified'])(
    'preserves a definitive %s rejection and dependent edits for explicit reconciliation', async (code) => {
      const { createAuthenticatedExceptionHandoverStorage } = await import('@/src/lib/exception-handover-auth');
      const state = createEmptyExceptionHandoverState(shift.id);
      let online = false;
      let serverState = state;
      transport.get.mockImplementation(async (path: string) => {
        if (!online) throw new Error('offline');
        if (path === '/api/me/capabilities') return { userSub: 'auth0|alice', unitIds: ['icu-a'],
          permissions: { canWriteHandover: true }, exceptionHandover: { candidateEnabled: true } };
        if (path.endsWith(shift.id)) return { ...shift, state: serverState };
        throw { status: 404 };
      });
      transport.post.mockImplementation(async (_path: string, options: RequestInit) => {
        if (transport.post.mock.calls.length === 1) throw { status: 400, details: JSON.stringify({ code }) };
        const body = JSON.parse(String(options.body)) as { state: typeof state };
        serverState = body.state;
        return { status: 'confirmed', contentHash: sha256(backendReceipt(body.state)) };
      });
      online = true;
      const initial = createAuthenticatedExceptionHandoverStorage(shift, 'auth0|alice');
      await initial.load(shift.id);
      online = false;
      await expect(initial.save({ ...state, briefDrafts: { '1': { change: 'Borrador sintético',
        currentRisk: '', nextAction: '', owner: '', contingency: '' } } })).rejects.toThrow('offline');
      await expect(initial.save({ ...state, interactionCounts: { '2': 1 } })).rejects.toThrow('offline');
      online = true;
      const restarted = createAuthenticatedExceptionHandoverStorage(shift, 'auth0|alice');
      expect((await restarted.load(shift.id)).interactionCounts).toEqual({});
      expect(await restarted.listConflicts?.()).toBe(2);
      expect(restarted.syncStatus).toBe('rejected');
      const stored = JSON.parse([...persisted.values()][0].slice('encrypted:'.length)) as {
        operations: { status: string; rejectionCode: string; state: typeof state }[];
      };
      expect(stored.operations).toHaveLength(2);
      expect(stored.operations[0]).toMatchObject({ status: 'rejected', rejectionCode: code,
        state: { briefDrafts: { '1': { change: 'Borrador sintético' } } } });
      expect(stored.operations[1].status).toBe('rejected');
      expect(transport.post).toHaveBeenCalledTimes(1);
      serverState = { ...state, interactionCounts: { '2': 1 } };
      await restarted.discardConflicts?.();
      await restarted.save({ ...serverState, interactionCounts: { '2': 2 } });
      expect(transport.post).toHaveBeenCalledTimes(2);
    },
  );

  it.each([400, 401, 403])('does not classify receipt GET %s as a definitive write rejection', async (status) => {
    const { createAuthenticatedExceptionHandoverStorage } = await import('@/src/lib/exception-handover-auth');
    const state = createEmptyExceptionHandoverState(shift.id);
    let online = true;
    transport.get.mockImplementation(async (path: string) => {
      if (path === '/api/me/capabilities' && online) return { userSub: 'auth0|alice', unitIds: ['icu-a'],
        permissions: { canWriteHandover: true }, exceptionHandover: { candidateEnabled: true } };
      if (path.endsWith(shift.id) && online) return { ...shift, state };
      if (online) throw { status };
      throw new Error('offline');
    });
    const storage = createAuthenticatedExceptionHandoverStorage(shift, 'auth0|alice');
    await storage.load(shift.id);
    online = false;
    await expect(storage.save({ ...state, interactionCounts: { reviewed: 1 } }))
      .rejects.toThrow('offline');
    online = true;
    await expect(storage.replayPending()).rejects.toMatchObject({ status });
    expect(transport.post).not.toHaveBeenCalled();
    const stored = JSON.parse([...persisted.values()][0].slice('encrypted:'.length)) as {
      operations: { status: string; rejectionCode?: string }[];
    };
    expect(stored.operations[0]).toMatchObject({ status: 'pending' });
    expect(stored.operations[0].rejectionCode).toBeUndefined();
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

  it.each(['outgoing', 'incoming'] as const)(
    'reconciles a lost %s confirmation before creating another event after the clock advances', async (kind) => {
      const patient = { patientId: '1', name: 'Caso sintético', bedLabel: '1', unitName: 'UCI A',
        status: 'unchanged' as const, change: '', currentRisk: '', nextAction: '', owner: '',
        dueAt: '2026-10-28T15:00:00Z', contingency: { trigger: '', response: '' },
        lastSummaryAt: '', lastSummarySource: '', criticalItems: [] };
      let saved = createEmptyExceptionHandoverState(shift.id);
      let clock = '2026-10-28T10:00:00Z';
      let lost = false;
      let writes = 0;
      const writtenTransfers: string[] = [];
      let syncStatus: 'confirmed' | 'pending' = 'confirmed';
      const storage = { durability: 'durable' as const, get syncStatus() { return syncStatus; },
        load: async () => { syncStatus = 'confirmed'; return saved; },
        save: async (state: typeof saved) => {
          writes += 1;
          writtenTransfers.push(JSON.stringify(state.events.filter((event) =>
            event.kind === 'outgoing_transfer' || event.kind === 'incoming_attestation')));
          saved = state;
          if (lost) { lost = false; syncStatus = 'pending'; throw new Error('response lost'); }
          syncStatus = 'confirmed';
        }, clear: async () => {} };
      const board = (userId: string, actorKind: 'outgoing' | 'incoming') =>
        <UnitExceptionHandover candidateMode shiftId={shift.id}
          authenticatedActor={{ userId, displayName: userId, kind: actorKind }} patients={[patient]}
          groupScope={{ viewScope: 'icu-a', members: [{ patientId: '1', unitId: 'icu-a' }] }}
          storage={storage} colors={colors} onOpenFullHandover={() => {}} now={() => clock} />;
      const receiver = render(board('auth0|bob', 'incoming'));
      await act(async () => {});
      fireEvent.press(receiver.getByTestId('open-exception-1'));
      fireEvent.press(receiver.getByTestId('transfer-r-1'));
      await act(async () => {});
      receiver.unmount();
      if (kind === 'incoming') {
        const outgoing = render(board('auth0|alice', 'outgoing'));
        await act(async () => {});
        await act(async () => { fireEvent.press(outgoing.getByTestId('confirm-outgoing-transfer')); });
        outgoing.unmount();
      }
      const userId = kind === 'outgoing' ? 'auth0|alice' : 'auth0|bob';
      const current = render(board(userId, kind));
      await act(async () => {});
      const button = current.getByTestId(kind === 'outgoing'
        ? 'confirm-outgoing-transfer' : 'confirm-incoming-attestation');
      lost = true;
      await act(async () => { fireEvent.press(button); });
      const confirmedEvents = saved.events.filter((event) => event.kind ===
        (kind === 'outgoing' ? 'outgoing_transfer' : 'incoming_attestation'));
      expect(confirmedEvents).toHaveLength(1);
      const writesAfterLostResponse = writes;
      clock = '2026-10-28T10:05:00Z';
      await act(async () => { fireEvent.press(button); });
      expect(saved.events.filter((event) => event.kind === confirmedEvents[0].kind)).toEqual(confirmedEvents);
      expect(writes).toBe(writesAfterLostResponse + 1);
      expect(writtenTransfers.at(-1)).toBe(writtenTransfers.at(-2));
      current.unmount();
      const remounted = render(board(userId, kind));
      await act(async () => {});
      expect(remounted.getByTestId(kind === 'outgoing'
        ? 'outgoing-transfer-event' : 'incoming-attestation-event')).toBeTruthy();
    },
  );

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
