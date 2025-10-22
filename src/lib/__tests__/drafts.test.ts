import { describe, it, expect } from "vitest";
import * as drafts from "../drafts";

describe("drafts.ts (get/set/clear)", () => {
  it("setDraft → getDraft devuelve el mismo objeto", async () => {
    const pid = "pat-001";
    const data = { note: "pendiente", vitals: { rr: 20, spo2: 96 } };

    await drafts.setDraft(pid, data as any);
    const got = await drafts.getDraft(pid);

    expect(got).toEqual(data);
  });

  it("clearDraft borra el borrador", async () => {
    const pid = "pat-002";
    await drafts.setDraft(pid, { a: 1 } as any);

    await drafts.clearDraft(pid);
    const got = await drafts.getDraft(pid);

    expect(got == null).toBe(true);
  });

  it("namespacing: drafts de pacientes distintos no se pisan", async () => {
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
    const pid = "pat-003";
    await drafts.setDraft(pid, { x: 1 } as any);
    await drafts.setDraft(pid, { x: 2, y: 3 } as any);

    const got = await drafts.getDraft(pid);
    expect(got).toEqual({ x: 2, y: 3 });
  });
});
