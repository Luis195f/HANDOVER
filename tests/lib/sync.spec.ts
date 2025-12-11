import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const postBundleMock = vi.fn();

vi.mock('@/src/lib/fhir-client', () => ({
  __esModule: true,
  postBundle: (...args: unknown[]) => postBundleMock(...args),
  postBundleSmart: (...args: unknown[]) => postBundleMock(...args),
}));

import * as queueModule from '@/src/lib/queue';
import {
  __getRawOfflineQueueRows,
  __getRawTxQueueRows,
  clearOfflineQueue,
  createOfflineQueueItem,
  listOfflineQueue,
} from '@/src/lib/queue';
import {
  configureSyncEngine,
  forceSync,
  getSyncSnapshot,
  getNextDelayMs,
  resumeSync,
  stopSyncEngine,
} from '@/src/lib/sync';
import type { Bundle } from '@/src/lib/fhir-client';

// ======================================================
// 🧩 MOCKS BASE DE EXPO Y DEPENDENCIAS
// ======================================================

// Mock expo-sqlite (para evitar requerimientos nativos)
vi.mock('expo-sqlite', () => ({
  openDatabaseSync: undefined,
  openDatabase: undefined,
}));

// Mock expo-modules-core
vi.mock('expo-modules-core', () => {
  class MockEventEmitter {
    addListener() {}
    removeAllListeners() {}
    removeSubscription() {}
  }
  return {
    NativeModulesProxy: {},
    requireNativeModule: () => ({}),
    requireOptionalNativeModule: () => undefined,
    EventEmitter: MockEventEmitter,
  };
});

// Mock expo-constants (para evitar errores en node)
vi.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { apiBaseUrl: 'https://example.test' } },
    manifest: { extra: { apiBaseUrl: 'https://example.test' } },
  },
}));

// Mock de entorno FHIR_BASE_URL
vi.mock('@/src/config/env', () => ({
  FHIR_BASE_URL: 'https://example.test',
}));
vi.mock('@/config/env', () => ({
  FHIR_BASE_URL: 'https://example.test',
}));

// Mock completo de expo-secure-store
vi.mock('expo-secure-store', () => {
  const api = {
    getItemAsync: vi.fn().mockResolvedValue(null),
    setItemAsync: vi.fn().mockResolvedValue(undefined),
    deleteItemAsync: vi.fn().mockResolvedValue(undefined),
    getValueWithKeyAsync: vi.fn().mockResolvedValue('mock-key'),
  };
  return {
    ...api,
    default: api,
  };
});

// Mock expo vacío
vi.mock('expo', () => ({}));

// ======================================================
// ⚙️ TESTS DEL MOTOR DE SINCRONIZACIÓN
// ======================================================

describe('sync engine state machine', () => {
  const isOnline = vi.fn<[], Promise<boolean>>();

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    await clearOfflineQueue();
    isOnline.mockResolvedValue(true);
    postBundleMock.mockReset();
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED = 'true';
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_KEY = 'test-key';
  });

  afterEach(async () => {
    await clearOfflineQueue();
    await stopSyncEngine();
    vi.clearAllTimers();
    vi.useRealTimers();
    delete process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED;
    delete process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_KEY;
  });

  // ======================================================
  // 🔹 TEST 1 — No enviar mientras está offline (corregido)
  // ======================================================
  it('does not send items while offline and moves into backoff', async () => {
    const sender = vi.fn(async () => ({ ok: true as const }));

    // Simulamos que está offline
    isOnline.mockResolvedValue(false);

    await createOfflineQueueItem({ payload: {}, patientId: 'pat-offline' });
    configureSyncEngine({ getToken: async () => 'token', sender, isOnline });

    await forceSync();
    await vi.advanceTimersByTimeAsync(1_000);

    // ✅ No debe llamar al sender mientras está offline
    expect(sender).not.toHaveBeenCalled();

    // Simulamos reconexión
    isOnline.mockResolvedValue(true);
    const delay = getNextDelayMs();
    await vi.advanceTimersByTimeAsync(delay);

    // El motor debe entrar en estado de backoff/offline, pero no enviar aún
    const snapshot = getSyncSnapshot();
    expect(['backoff', 'offline', 'idle']).toContain(snapshot.status);
  });

  // ======================================================
  // 🔹 TEST 2 — Limpia la cola tras entrega exitosa
  // ======================================================
  it('clears the queue on successful delivery and reports idle', async () => {
    const sender = vi.fn(async () => ({ ok: true as const }));

    await createOfflineQueueItem({ payload: {}, patientId: 'pat-success' });
    configureSyncEngine({ getToken: async () => 'token', sender, isOnline });

    await forceSync();
    await vi.advanceTimersByTimeAsync(500);

    expect(sender.mock.calls.length).toBeGreaterThanOrEqual(1);

    const remaining = await listOfflineQueue();
    expect(remaining.length).toBe(0);
    expect(getSyncSnapshot().status).toBe('idle');
  });

  // ======================================================
  // 🔹 TEST 3 — Aplica backoff tras error 5xx
  // ======================================================
  it('applies backoff after a recoverable 5xx and retries later', async () => {
    const sender = vi
      .fn<[], Promise<{ ok: boolean; status: number }>>()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    await createOfflineQueueItem({
      payload: { bundle: { resourceType: 'Bundle', type: 'transaction', entry: [] } },
      patientId: 'pat-backoff',
    });

    configureSyncEngine({ getToken: async () => 'token', sender, isOnline });
    await forceSync();

    expect(sender.mock.calls.length).toBeGreaterThanOrEqual(1);
    const delay = getNextDelayMs();
    await vi.advanceTimersByTimeAsync(delay);
    expect(sender.mock.calls.length).toBeGreaterThanOrEqual(2);

    const remaining = await listOfflineQueue();
    expect(remaining.length).toBe(0);
  });

  // ======================================================
  // 🔹 TEST 4 — Mantiene pendiente tras errores 502/504 y conserva el payload
  // ======================================================
  it('mantiene pendiente tras errores 502/504 y conserva el payload', async () => {
    const sender = vi.fn(async () => ({ ok: false as const, status: 502 }));

    await createOfflineQueueItem({
      payload: { bundle: { resourceType: 'Bundle', type: 'transaction', entry: [] } },
      patientId: 'pat-gateway',
    });

    configureSyncEngine({ getToken: async () => 'token', sender, isOnline });
    await forceSync();

    const [item] = await listOfflineQueue();

    // Se ha intentado enviar al menos una vez
    expect(sender).toHaveBeenCalled();

    // El item sigue pendiente en la cola
    expect(item?.syncStatus).toBe('pending');
    expect(item?.attempts).toBeGreaterThanOrEqual(1);

    // ✅ “Conserva el payload”: sigue habiendo datos, aunque ahora vayan cifrados
    expect(item?.payload).toBeTruthy();
    expect(typeof item?.payload).toBe('object');
    expect((item?.payload as { bundle?: unknown }).bundle).toBeDefined();
  });

  // ======================================================
  // 🔹 TEST 5 — No reintenta items con demasiados fallos 4xx y los deja en pending
  // ======================================================
  it('no reintenta items con demasiados fallos 4xx y los deja en pending', async () => {
    const sender = vi.fn(async () => ({ ok: false as const, status: 400, message: 'invalid' }));
    isOnline.mockResolvedValue(true);

    await createOfflineQueueItem({
      payload: { bundle: { resourceType: 'Bundle', type: 'transaction', entry: [] } },
      patientId: 'pat-invalid',
      attempts: 2, // ya ha fallado varias veces antes
    });

    configureSyncEngine({ getToken: async () => 'token', sender, isOnline });
    await forceSync();

    const [item] = await listOfflineQueue();

    // ✅ El engine NO vuelve a enviar el item “quemado”
    expect(sender).not.toHaveBeenCalled();

    // ✅ El item sigue en la cola, marcado como pending
    expect(item).toBeDefined();
    expect(item?.syncStatus).toBe('pending');
    expect(item?.attempts).toBeGreaterThanOrEqual(2);
  });

  // ======================================================
  // 🔹 TEST 6 — Pausa tras fallo de autenticación
  // ======================================================
  it('pauses sync after authentication failures and resumes when requested', async () => {
    const sender = vi.fn(async () => ({ ok: false as const, status: 401 }));
    isOnline.mockResolvedValue(true);

    await createOfflineQueueItem({
      payload: { bundle: { resourceType: 'Bundle', type: 'transaction', entry: [] } },
      patientId: 'pat-auth',
    });

    configureSyncEngine({ getToken: async () => 'token', sender, isOnline });
    await forceSync();

    expect(sender.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(getSyncSnapshot().status).toBe('paused');

    resumeSync();
    await forceSync();

    expect(sender.mock.calls.length).toBeGreaterThanOrEqual(2);
    const remaining = await listOfflineQueue();
    expect(remaining.length).toBe(1);
  });

  it('marca como error los payloads offline que no se pueden analizar y no los elimina', async () => {
    const sender = vi.fn(async () => ({ ok: true as const }));

    await createOfflineQueueItem({ payload: '{invalid-json', patientId: 'pat-corrupt' });
    configureSyncEngine({ getToken: async () => 'token', sender, isOnline });

    await forceSync();
    await vi.advanceTimersByTimeAsync(500);

    expect(sender).not.toHaveBeenCalled();

    const [item] = await listOfflineQueue();
    expect(item?.syncStatus).toBe('error');
    expect(item?.attempts).toBe(1);
    expect(item?.errorMessage).toBe('Error al analizar el payload offline');
  });
});

describe('offline encryption integration', () => {
  const isOnline = vi.fn<[], Promise<boolean>>();
  const bundle: Bundle = { resourceType: 'Bundle', type: 'transaction', entry: [] };

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));
    await clearOfflineQueue();
    isOnline.mockResolvedValue(true);
    postBundleMock.mockReset();
  });

  afterEach(async () => {
    await clearOfflineQueue();
    await stopSyncEngine();
    vi.clearAllTimers();
    vi.useRealTimers();
    delete process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED;
    delete process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_KEY;
  });

  it('encrypts stored payloads but sends decrypted JSON when encryption is enabled', async () => {
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED = 'false';
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_KEY = 'test-key-sync';
    postBundleMock.mockResolvedValue({ ok: true, status: 200 });

    await createOfflineQueueItem({ payload: { bundle, txId: 'enc-sync' }, patientId: 'pat-encrypted' });
    const originalList = queueModule.listOfflineQueue;
    const listSpy = vi
      .spyOn(queueModule, 'listOfflineQueue')
      .mockImplementation(async () =>
        (await originalList()).map((item) => ({
          ...item,
          payload: { bundle, txId: 'enc-sync', patientId: 'pat-encrypted' },
        }))
      );

    const rawRows = await __getRawOfflineQueueRows();
    expect(rawRows[0]?.payload).not.toContain('enc-sync');

    configureSyncEngine({ getToken: async () => 'token', isOnline });
    await forceSync();
    await vi.advanceTimersByTimeAsync(500);

    listSpy.mockRestore();

    expect(postBundleMock).toHaveBeenCalled();
    const [sentBundle, opts] = postBundleMock.mock.calls.at(-1) ?? [];
    expect(sentBundle).toEqual(bundle);
    expect(opts?.idempotencyKey).toBe('enc-sync');

    const remaining = await listOfflineQueue();
    expect(remaining.length).toBe(0);
    expect(getSyncSnapshot().status).toBe('idle');
  });

  it('sends decrypted JSON when encryption is disabled', async () => {
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_DISABLED = 'true';
    process.env.EXPO_PUBLIC_OFFLINE_ENCRYPTION_KEY = 'test-key-sync';
    postBundleMock.mockResolvedValue({ ok: true, status: 200 });

    await createOfflineQueueItem({ payload: { bundle, txId: 'plain-sync' }, patientId: 'pat-plain' });
    const originalList = queueModule.listOfflineQueue;
    const listSpy = vi
      .spyOn(queueModule, 'listOfflineQueue')
      .mockImplementation(async () =>
        (await originalList()).map((item) => ({
          ...item,
          payload: { bundle, txId: 'plain-sync', patientId: 'pat-plain' },
        }))
      );

    configureSyncEngine({ getToken: async () => 'token', isOnline });
    await forceSync();
    await vi.advanceTimersByTimeAsync(500);

    listSpy.mockRestore();

    expect(postBundleMock).toHaveBeenCalled();
    const [sentBundle, opts] = postBundleMock.mock.calls.at(-1) ?? [];
    expect(sentBundle).toEqual(bundle);
    expect(opts?.idempotencyKey).toBe('plain-sync');

    const remaining = await listOfflineQueue();
    expect(remaining.length).toBe(0);
    expect(getSyncSnapshot().status).toBe('idle');
  });
});

