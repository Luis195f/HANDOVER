import { describe, it, expect } from "vitest";
import {
  applyPatientFilters,
  sortPatientsByNEWS2Desc,
  type PatientLike,
} from "../patient-filters";

describe("patient-filters", () => {
  const pts: PatientLike[] = [
    { id: "001", name: "Ana Pérez", unitId: "uci", specialtyId: "intensivo", vitals: { rr: 16, spo2: 98, temp: 37, sbp: 120, hr: 80, o2: false, acvpu: "A" } }, // ~0
    { id: "002", name: "Luis Mora", unitId: "uci", specialtyId: "intensivo", vitals: { rr: 28, spo2: 90, temp: 39, sbp: 90, hr: 130, o2: true, acvpu: "V" } }, // alto
    { id: "abc-33", name: "Bea Gómez", unitId: "pediatria", specialtyId: "pediatria", vitals: { rr: 22, spo2: 94, temp: 38.4, sbp: 105, hr: 100, o2: false, acvpu: "A" } }, // leve/medio
    { id: "004", name: "Carlos Rey", unitId: "medicina", specialtyId: "clinica", news2: 5 }, // score precalculado
  ];

  it("filtra por texto (en nombre o id)", () => {
    const r1 = applyPatientFilters(pts, { text: "ana" });
    expect(r1.map((p) => p.id)).toEqual(["001"]);

    const r2 = applyPatientFilters(pts, { text: "abc" });
    expect(r2.map((p) => p.id)).toEqual(["abc-33"]);
  });

  it("filtra por unidad y especialidad", () => {
    const r = applyPatientFilters(pts, { unitId: "uci", specialty: "intensivo" });
    expect(r.map((p) => p.id).sort()).toEqual(["001", "002"]);
  });

  it("ordena por NEWS2 descendente (usa vitals o score ya calculado)", () => {
    const out = sortPatientsByNEWS2Desc(pts);
    // El paciente 002 (alto) debe ir primero, luego 004 (5), luego abc-33 (~3), luego 001 (~0)
    expect(out[0]?.id).toBe("002");
    expect(out[1]?.id).toBe("004");
  });

  it("si scores iguales, desempata por nombre/id asc", () => {
    const tie: PatientLike[] = [
      { id: "b", name: "B", vitals: { rr: 16, spo2: 98 } }, // 0
      { id: "a", name: "A", vitals: { rr: 16, spo2: 98 } }, // 0
    ];
    const out = sortPatientsByNEWS2Desc(tie);
    expect(out.map((p) => p.name)).toEqual(["A", "B"]);
  });
});
