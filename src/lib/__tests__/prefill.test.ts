import { describe, it, expect, vi, beforeEach } from "vitest";
import { prefillFromFHIR } from "../prefill";

const BASE = "http://fhir.test";

function mkRes(json: any, ok = true) {
  return {
    ok,
    json: async () => json,
  } as any;
}

describe("prefillFromFHIR (FHIR Prefill PRO)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  it("devuelve vitals vacío (o2=false, acvpu='A') cuando no hay observaciones", async () => {
    // Orden de llamadas en la implementación actual:
    // Patient -> Condition (fallback dx) -> Encounter -> Observation (vitals) -> Observation 3150-0 (O2)
    fetchMock
      // Patient
      .mockResolvedValueOnce(mkRes({ resourceType: "Patient", id: "pat-1" }))
      // Condition fallback (vacío)
      .mockResolvedValueOnce(mkRes({ resourceType: "Bundle", entry: [] }))
      // Encounter bundle (vacío)
      .mockResolvedValueOnce(mkRes({ resourceType: "Bundle", entry: [] }))
      // Observation bundle (sin entradas)
      .mockResolvedValueOnce(mkRes({ resourceType: "Bundle", entry: [] }))
      // O2 3150-0 (sin entradas)
      .mockResolvedValueOnce(mkRes({ resourceType: "Bundle", entry: [] }));

    const pf = await prefillFromFHIR("pat-1", {
      fhirBase: BASE,
      fetchImpl: fetchMock as any,
    });

    // Nuevo contrato: vitals siempre presente con defaults
    expect(pf.vitals).toEqual({ o2: false, acvpu: "A" });
    expect(pf.dxText).toBeUndefined();
    expect(pf.location).toBeUndefined();

    // URLs clave llamadas (sin depender del recuento exacto)
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/Patient/"))).toBe(true);
    expect(urls.some((u) => u.includes("/Condition?subject="))).toBe(true);
    expect(urls.some((u) => u.includes("/Encounter?subject="))).toBe(true);
    expect(urls.some((u) => u.includes("category=vital-signs"))).toBe(true);
    expect(urls.some((u) => u.includes("code=3150-0"))).toBe(true);
  });

  it("mapea los últimos vitals por código y extrae ubicación/cama", async () => {
    fetchMock
      // Patient
      .mockResolvedValueOnce(mkRes({ resourceType: "Patient", id: "pat-1" }))
      // Condition fallback (vacío, no aporta)
      .mockResolvedValueOnce(mkRes({ resourceType: "Bundle", entry: [] }))
      // Encounter con display de ubicación
      .mockResolvedValueOnce(
        mkRes({
          resourceType: "Bundle",
          entry: [
            {
              resource: {
                resourceType: "Encounter",
                id: "e1",
                location: [{ location: { display: "UCI Adulto · Cama 5" } }],
              },
            },
          ],
        })
      )
      // Observation bundle (con varios vitals)
      .mockResolvedValueOnce(
        mkRes({
          resourceType: "Bundle",
          entry: [
            {
              resource: {
                resourceType: "Observation",
                code: { coding: [{ code: "9279-1" }] }, // RR
                valueQuantity: { value: 22 },
                effectiveDateTime: "2024-04-10T10:00:00Z",
              },
            },
            {
              resource: {
                resourceType: "Observation",
                code: { coding: [{ code: "59408-5" }] }, // SpO2
                valueQuantity: { value: 95 },
                effectiveDateTime: "2024-04-10T10:05:00Z",
              },
            },
            {
              resource: {
                resourceType: "Observation",
                code: { coding: [{ code: "8310-5" }] }, // Temp
                valueQuantity: { value: 37.5 },
                effectiveDateTime: "2024-04-10T10:03:00Z",
              },
            },
            {
              resource: {
                resourceType: "Observation",
                code: { coding: [{ code: "8480-6" }] }, // SBP
                valueQuantity: { value: 110 },
                effectiveDateTime: "2024-04-10T10:04:00Z",
              },
            },
            {
              resource: {
                resourceType: "Observation",
                code: { coding: [{ code: "8867-4" }] }, // HR
                valueQuantity: { value: 88 },
                effectiveDateTime: "2024-04-10T10:06:00Z",
              },
            },
          ],
        })
      )
      // O2 3150-0 (sin datos; mantiene o2=false)
      .mockResolvedValueOnce(mkRes({ resourceType: "Bundle", entry: [] }));

    const pf = await prefillFromFHIR("pat-1", {
      fhirBase: BASE,
      fetchImpl: fetchMock as any,
    });

    expect(pf.vitals).toEqual(
      expect.objectContaining({
        rr: 22,
        spo2: 95,
        temp: 37.5,
        sbp: 110,
        hr: 88,
        acvpu: "A",
        o2: false,
      })
    );
    expect(pf.location).toContain("UCI");
    expect(pf.bed?.toLowerCase()).toContain("cama");

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes(BASE)).length).toBeGreaterThanOrEqual(5);
  });

  it("marca o2=true si existe una observación 3150-0 reciente", async () => {
    fetchMock
      // Patient
      .mockResolvedValueOnce(mkRes({ resourceType: "Patient", id: "pat-1" }))
      // Condition fallback (vacío)
      .mockResolvedValueOnce(mkRes({ resourceType: "Bundle", entry: [] }))
      // Encounter (vacío)
      .mockResolvedValueOnce(mkRes({ resourceType: "Bundle", entry: [] }))
      // Observation vital-signs (vacío)
      .mockResolvedValueOnce(mkRes({ resourceType: "Bundle", entry: [] }))
      // O2 3150-0 con una entrada
      .mockResolvedValueOnce(
        mkRes({
          resourceType: "Bundle",
          entry: [
            {
              resource: {
                resourceType: "Observation",
                code: { coding: [{ code: "3150-0" }] },
                effectiveDateTime: "2024-04-10T10:06:00Z",
              },
            },
          ],
        })
      );

    const pf = await prefillFromFHIR("pat-1", {
      fhirBase: BASE,
      fetchImpl: fetchMock as any,
    });

    expect(pf.vitals?.o2).toBe(true);
    expect(pf.vitals?.acvpu).toBe("A");
  });
});
