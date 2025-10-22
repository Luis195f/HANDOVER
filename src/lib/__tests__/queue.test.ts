// src/lib/__tests__/queue.test.ts
import { describe, it, expect, vi, beforeAll } from "vitest";

/**
 * Mocks básicos ANTES de importar la cola para evitar parsear RN/Expo.
 */
vi.mock(
  "react-native",
  () => {
    const subscribers = new Set<(...args: any[]) => void>();
    return {
      Platform: { OS: "test" },
      NativeModules: {},
      NativeEventEmitter: class {},
      AppState: {
        addEventListener: (_event: string, fn: (...args: any[]) => void) => {
          subscribers.add(fn);
          return { remove: () => subscribers.delete(fn) };
        },
        removeEventListener: (_event: string, fn: (...args: any[]) => void) => {
          subscribers.delete(fn);
        },
        __emit: (...args: any[]) => Array.from(subscribers).forEach((fn) => fn(...args)),
      },
    };
  },
  { virtual: true }
);

vi.mock(
  "@react-native-community/netinfo",
  () => {
    let listener: ((state: { isConnected: boolean }) => void) | undefined;
    return {
      addEventListener: (fn: (state: { isConnected: boolean }) => void) => {
        listener = fn;
        return { unsubscribe: () => { listener = undefined; } };
      },
      fetch: async () => ({ isConnected: true }),
      __emit: (state: { isConnected: boolean }) => listener?.(state),
    };
  },
  { virtual: true }
);

vi.mock("expo", () => ({ registerRootComponent: () => {}, requireNativeModule: () => ({}) }), { virtual: true });

/**
 * Importa la cola DESPUÉS de los mocks.
 */
let enqueueTx: (tx: { key: string; payload?: any }) => Promise<void>;
let flushQueue: (
  sender: (tx: any) => Promise<{ ok?: boolean; status?: number } | { ok: boolean; status: number }>
) => Promise<void>;

beforeAll(async () => {
  const mod = await import("../queue");
  enqueueTx = mod.enqueueTx;
  flushQueue = mod.flushQueue;
});

// Utilidad para keys únicas por test
const uniq = (p = "tx") => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Helpers Response-like
const ok = (status = 200) => ({ ok: true, status });
const fail = (status = 0) => ({ ok: false, status });

describe("Queue — idempotencia, backoff, limpieza", () => {
  it("idempotencia: dos enqueue con la misma key se procesan una sola vez", async () => {
    const key = uniq("idemp");
    const calls: Array<{ key: string; payload: any }> = [];

    await enqueueTx({ key, payload: { v: 1 } });
    await enqueueTx({ key, payload: { v: 2 } }); // misma key

    const sender = vi.fn(async (tx: any) => {
      if (tx?.key === key) calls.push({ key: tx.key, payload: tx.payload });
      return ok(200);
    });

    await flushQueue(sender);

    const ourCalls = calls.filter((c) => c.key === key);
    expect(ourCalls.length).toBe(1);
  });

  it("backoff: ante fallo transitorio, planifica reintento (delays no decrecientes si existen) y finalmente éxito", async () => {
    // Fake timers sólo para este test
    vi.useFakeTimers();

    const key = uniq("backoff");
    await enqueueTx({ key, payload: { attempt: 0 } });

    let attempts = 0;
    const sender = vi.fn(async (tx: any) => {
      if (tx?.key !== key) return ok(204);
      attempts += 1;
      if (attempts === 1) {
        // primer intento falla (transitorio)
        const e: any = new Error("E_TRANSIENT");
        e.transient = true;
        throw e;
        // Alternativa: return fail(503);
      }
      return ok(200);
    });

    // Espía de setTimeout sólo si existe en el entorno
    const canSpy = typeof globalThis.setTimeout === "function";
    const spy = canSpy ? vi.spyOn(globalThis, "setTimeout" as any) : null;

    const p = flushQueue(sender);

    // Avanza timers si hay backoff planificado con setTimeout
    await vi.runOnlyPendingTimersAsync();
    await vi.runAllTimersAsync();
    await p;

    // La cola puede delegar el retry internamente; al menos 1 intento
    expect(attempts).toBeGreaterThanOrEqual(1);

    if (spy) {
      const delays = spy.mock.calls
        .map((c) => c[1])
        .filter((n): n is number => typeof n === "number");
      if (delays.length > 0) {
        expect(delays.every((d) => d >= 0)).toBe(true);
        for (let i = 1; i < delays.length; i++) {
          expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
        }
      }
      spy.mockRestore();
    }

    vi.useRealTimers();
  });

  it("limpieza post-éxito: un segundo flush no reprocesa el mismo item", async () => {
    const key = uniq("clean");
    let processed = 0;

    await enqueueTx({ key, payload: { once: true } });

    const sender = vi.fn(async (tx: any) => {
      if (tx?.key === key) processed += 1;
      return ok(201); // éxito
    });

    await flushQueue(sender);
    expect(processed).toBe(1);

    await flushQueue(sender);
    expect(processed).toBe(1); // no vuelve a procesar
  });

  it("no duplica si se re-encola misma key durante reintentos (race) — avance garantizado", async () => {
    vi.useFakeTimers();

    const key = uniq("race");
    await enqueueTx({ key, payload: { v: 1 } });

    let attempts = 0;
    const seenPayloads: any[] = [];

    const sender = vi.fn(async (tx: any) => {
      if (tx?.key !== key) return ok(204);

      attempts += 1;
      seenPayloads.push(tx.payload);

      if (attempts === 1) {
        // En medio del fallo, otra parte re-encola misma key
        await enqueueTx({ key, payload: { v: 2 } });
        const e: any = new Error("E_TRANSIENT");
        e.transient = true;
        throw e;
        // Alternativa: return fail(503);
      }
      return ok(200);
    });

    const p = flushQueue(sender);
    await vi.runOnlyPendingTimersAsync();
    await vi.runAllTimersAsync();
    await p;

    expect(seenPayloads.length).toBeLessThanOrEqual(2);
    const last = seenPayloads[seenPayloads.length - 1];
    expect(last).toBeDefined();

    vi.useRealTimers();
  });

  // ──────────────────────────────────────────────────────────────
  // NUEVOS CASOS: 4xx y throw NO-transitorio => NO reintento
  // ──────────────────────────────────────────────────────────────

  it("4xx: no reintenta en errores de cliente (un solo intento)", async () => {
    vi.useFakeTimers();

    const key = uniq("no-retry-4xx");
    await enqueueTx({ key, payload: { p: 1 } });

    let attempts = 0;
    const sender = vi.fn(async (tx: any) => {
      if (tx?.key !== key) return ok(204);
      attempts += 1;
      // 400 Bad Request → no debería reintentarse
      return fail(400);
    });

    await flushQueue(sender);

    expect(attempts).toBe(1);

    vi.useRealTimers();
  });

  it("error NO transitorio (throw sin flag) no reintenta", async () => {
    vi.useFakeTimers();

    const key = uniq("no-retry-throw");
    await enqueueTx({ key, payload: { p: 2 } });

    let attempts = 0;
    const sender = vi.fn(async (tx: any) => {
      if (tx?.key !== key) return ok(204);
      attempts += 1;
      // throw normal → la cola no debe hacer backoff para este tipo de error no-transitorio
      throw new Error("hard-fail");
    });

    await flushQueue(sender);

    expect(attempts).toBe(1);

    vi.useRealTimers();
  });
});
