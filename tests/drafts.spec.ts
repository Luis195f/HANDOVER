import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

async function setup(encryptionDisabled = false) {
  vi.resetModules();
  process.env.HANDOVER_TEST_DISABLE_OFFLINE_ENCRYPTION = encryptionDisabled ? "true" : "false";
  vi.mock("expo-secure-store");

  const crypto = await import("@/src/lib/crypto");
  const drafts = await import("@/src/lib/drafts");

  return { crypto, drafts } as const;
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.HANDOVER_TEST_DISABLE_OFFLINE_ENCRYPTION;
});

describe("drafts.ts (get/set/clear)", () => {
  it("setDraft cifra el payload y getDraft lo descifra", async () => {
    const { crypto, drafts } = await setup();
    const pid = "pat-enc-001";
    const data = { note: "pendiente", vitals: { rr: 20, spo2: 96 } };

    await drafts.setDraft(pid, data as any);
    const raw = await drafts.__test__.readRaw(drafts.__test__.keyNorm(pid));

    expect(raw).not.toBe(JSON.stringify(data));
    expect(raw?.startsWith(crypto.ENCRYPTION_PREFIX)).toBe(false);

    const decrypted = await crypto.decryptOfflinePayload(raw ?? "");
    expect(JSON.parse(decrypted)).toEqual(data);

    const got = await drafts.getDraft(pid);
    expect(got).toEqual(data);
  });

  it("OFFLINE_ENCRYPTION_DISABLED guarda y lee sin prefijo", async () => {
    const { crypto, drafts } = await setup(true);
    const pid = "pat-plain-001";
    const data = { a: 1, b: "texto" };

    await drafts.setDraft(pid, data as any);
    const raw = await drafts.__test__.readRaw(drafts.__test__.keyNorm(pid));

    expect(raw?.startsWith(crypto.ENCRYPTION_PREFIX)).toBe(false);
    expect(raw).toBe(JSON.stringify(data));

    const got = await drafts.getDraft(pid);
    expect(got).toEqual(data);
  });

  it("borra un draft", async () => {
    const { drafts } = await setup();
    const pid = "pat-002";
    await drafts.setDraft(pid, { a: 1 } as any);

    await drafts.clearDraft(pid);
    const got = await drafts.getDraft(pid);

    expect(got == null).toBe(true);
  });

  it("namespacing: drafts de pacientes distintos no se pisan", async () => {
    const { drafts } = await setup();
    const a = "pat-A";
    const b = "pat-B";
    await drafts.setDraft(a, { v: 1 } as any);
    await drafts.setDraft(b, { v: 2 } as any);

    const da = await drafts.getDraft(a);
    const db = await drafts.getDraft(b);

    expect(da).toEqual({ v: 1 });
    expect(db).toEqual({ v: 2 });
  });

  it("sobrescritura: último setDraft gana", async () => {
    const { drafts } = await setup();
    const pid = "pat-003";
    await drafts.setDraft(pid, { x: 1 } as any);
    await drafts.setDraft(pid, { x: 2, y: 3 } as any);

    const got = await drafts.getDraft(pid);
    expect(got).toEqual({ x: 2, y: 3 });
  });

  it("migración: lee JSON legacy sin prefijo y lo persiste cifrado", async () => {
    const { drafts, crypto } = await setup();
    const pid = "Patient/legacy-001";
    const legacyKey = drafts.__test__.keyLegacy(pid);
    const normalizedKey = drafts.__test__.keyNorm(pid);
    const data = { foo: "bar" };

    await drafts.__test__.writeRaw(legacyKey, JSON.stringify(data));

    const got = await drafts.getDraft(pid);
    expect(got).toEqual(data);

    const stored = await drafts.__test__.readRaw(normalizedKey);
    expect(stored).not.toBe(JSON.stringify(data));
    expect(stored?.startsWith(crypto.ENCRYPTION_PREFIX)).toBe(false);
    const decrypted = await crypto.decryptOfflinePayload(stored ?? "");
    expect(JSON.parse(decrypted)).toEqual(data);
  });
});

