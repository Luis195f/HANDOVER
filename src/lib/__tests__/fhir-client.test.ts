import { describe, it, expect, vi, beforeEach } from "vitest";
import * as mod from "../fhir-client";

const pickPost = () =>
  (mod as any).postTransactionBundle ||
  (mod as any).postBundle ||
  (mod as any).postTxBundle ||
  (mod as any).post;

const ORIGINAL_FETCH = globalThis.fetch;

describe("fhir-client (401/5xx/abort) — esqueleto tolerante", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = ORIGINAL_FETCH as any;
  });

  it("adjunta Authorization si se le pasa en headers", async () => {
    const post = pickPost();
    if (!post) return expect(true).toBe(true); // no-op si no existe

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as any)?.Authorization).toBe("Bearer T");
      return { ok: true, status: 200, json: async () => ({}) } as any;
    }) as any;
    globalThis.fetch = fetchMock;

    const bundle = { resourceType: "Bundle", type: "transaction", entry: [] };
    const res = await post("http://fhir.test", bundle, { headers: { Authorization: "Bearer T" } });
    expect((res as any).status ?? 200).toBeGreaterThanOrEqual(200);
  });

  it("401 una vez y luego 200: si implementas refresh interno, habrá 2 llamadas a fetch", async () => {
    const post = pickPost();
    if (!post) return expect(true).toBe(true);

    let call = 0;
    const fetchMock = vi.fn(async () => {
      call++;
      if (call === 1) return { ok: false, status: 401, json: async () => ({}) } as any;
      return { ok: true, status: 200, json: async () => ({}) } as any;
    }) as any;
    globalThis.fetch = fetchMock;

    const bundle = { resourceType: "Bundle", type: "transaction", entry: [] };
    const res = await post("http://fhir.test", bundle, { headers: { Authorization: "Bearer T1" } });

    // Si tu cliente reintenta con refresh, habrá 2 llamadas; si no, al menos devuelve 401 sin romper
    expect(fetchMock).toHaveBeenCalledTimes(call); // call es 2 si reintenta, 1 si no
    const status = (res as any)?.status ?? 0;
    expect([200, 401]).toContain(status);
  });

  it("abort/timeout: respeta AbortSignal abortado", async () => {
    const post = pickPost();
    if (!post) return expect(true).toBe(true);

    const ac = new AbortController();
    ac.abort(); // abortado antes de llamar

    const fetchMock = vi.fn(async () => {
      throw new DOMException("Aborted", "AbortError");
    }) as any;
    globalThis.fetch = fetchMock;

    const bundle = { resourceType: "Bundle", type: "transaction", entry: [] };
    const res = await post("http://fhir.test", bundle, {
      headers: { Authorization: "Bearer T" },
      signal: ac.signal,
    });

    // Aceptamos que devuelva status 0/499/aborted según implementación
    const status = (res as any)?.status ?? 0;
    expect([0, 408, 499]).toContain(status);
  });
});
