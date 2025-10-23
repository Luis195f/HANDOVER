import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchPatientsFromFHIR } from "../fhir-client";

const BASE = "http://fhir.test";

function mkRes(json: any, ok = true) {
  return {
    ok,
    json: async () => json,
  } as any;
}

describe("fetchPatientsFromFHIR — Encounter + Patient/Location + (opcional) vitals", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  it("mapea Encounter + Patient/Location e infiere unitId/bed desde display", async () => {
    // 1) /Encounter?...&_include=Encounter:subject&_include=Encounter:location
    fetchMock.mockResolvedValueOnce(
      mkRes({
        resourceType: "Bundle",
        entry: [
          {
            resource: {
              resourceType: "Encounter",
              id: "enc-1",
              subject: { reference: "Patient/p1" },
              location: [{ location: { reference: "Location/l1", display: "UCI Adulto · Cama 5" } }],
              serviceType: [{ coding: [{ code: "intensivo", display: "Unidad de Cuidados Intensivos" }] }],
            },
          },
          { resource: { resourceType: "Patient", id: "p1", name: [{ given: ["Ana"], family: "Pérez" }] } },
          { resource: { resourceType: "Location", id: "l1", name: "UCI Adulto" } },
        ],
      })
    );

    const rows = await fetchPatientsFromFHIR({
      fhirBase: BASE,
      fetchImpl: fetchMock as any,
      includeVitals: false,
    });

    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r).toBeDefined();
    expect(r?.id).toBe("p1");
    expect(r?.name?.toLowerCase()).toContain("ana");
    expect((r?.location || "").toLowerCase()).toContain("uci");
    expect((r?.bed || "").toLowerCase()).toContain("cama");
    expect(r?.unitId).toBe("uci-adulto");
    expect((r?.specialtyId || "").toLowerCase()).toBe("intensivo");

    // Se llamó una sola vez (sólo Encounter principal)
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("includeVitals=true: añade últimos vitals via prefill (Observation vital-signs)", async () => {
    // Llamada 1: Encounter bundle
    fetchMock.mockResolvedValueOnce(
      mkRes({
        resourceType: "Bundle",
        entry: [
          {
            resource: {
              resourceType: "Encounter",
              id: "enc-2",
              subject: { reference: "Patient/p2" },
              location: [{ location: { display: "Medicina Interna · Cama 12" } }],
              serviceType: [{ coding: [{ code: "hospitalizacion" }] }],
            },
          },
          { resource: { resourceType: "Patient", id: "p2", name: [{ text: "Carlos Ruiz" }] } },
        ],
      })
    );

    // prefillFromFHIR realiza internamente:
    // 2) GET /Patient/p2
    fetchMock.mockResolvedValueOnce(mkRes({ resourceType: "Patient", id: "p2" }));
    // 3) GET /Encounter?subject=Patient/p2&_sort=-date&_count=1
    fetchMock.mockResolvedValueOnce(mkRes({ resourceType: "Bundle", entry: [] }));
    // 4) GET /Observation?subject=Patient/p2&category=vital-signs&_sort=-date&_count=50
    fetchMock.mockResolvedValueOnce(
      mkRes({
        resourceType: "Bundle",
        entry: [
          {
            resource: {
              resourceType: "Observation",
              code: { coding: [{ code: "9279-1" }] }, // RR
              valueQuantity: { value: 20 },
              effectiveDateTime: "2024-04-10T10:00:00Z",
            },
          },
          {
            resource: {
              resourceType: "Observation",
              code: { coding: [{ code: "59408-5" }] }, // SpO2
              valueQuantity: { value: 96 },
              effectiveDateTime: "2024-04-10T10:02:00Z",
            },
          },
        ],
      })
    );

    const rows = await fetchPatientsFromFHIR({
      fhirBase: BASE,
      fetchImpl: fetchMock as any,
      includeVitals: true,
    });

    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r).toBeDefined();
    expect(r?.id).toBe("p2");
    expect(r?.vitals).toBeDefined();
    expect(r?.vitals?.rr).toBe(20);
    expect(r?.vitals?.spo2).toBe(96);

    // Total llamadas: 1 (Encounter) + 3 de prefill
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("de-duplica por patientId si hay múltiples encounters del mismo paciente", async () => {
    // 1) Encounter bundle con dos encounters del mismo paciente
    fetchMock.mockResolvedValueOnce(
      mkRes({
        resourceType: "Bundle",
        entry: [
          { resource: { resourceType: "Encounter", id: "e1", subject: { reference: "Patient/p3" }, location: [] } },
          { resource: { resourceType: "Encounter", id: "e2", subject: { reference: "Patient/p3" }, location: [] } },
          { resource: { resourceType: "Patient", id: "p3", name: [{ given: ["Bea"], family: "Gómez" }] } },
        ],
      })
    );

    const rows = await fetchPatientsFromFHIR({
      fhirBase: BASE,
      fetchImpl: fetchMock as any,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("p3");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
