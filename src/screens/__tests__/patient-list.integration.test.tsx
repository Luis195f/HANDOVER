// @ts-nocheck
import React from "react";
/* eslint-disable @typescript-eslint/no-var-requires */
import TestRenderer, { act } from "react-test-renderer";

// ──────────────────────────────────────────────────────────────
// Mocks de dependencias que usa la pantalla
// ──────────────────────────────────────────────────────────────
const getPatientsBySpecialtyMock = jest.fn();
const getPatientsByUnitMock = jest.fn();

jest.mock("@/src/lib/fhir-client", () => ({
  getPatientsBySpecialty: (...args: any[]) => getPatientsBySpecialtyMock(...args),
  getPatientsByUnit: (...args: any[]) => getPatientsByUnitMock(...args),
}));

// Auth: no filtra nada (scope passthrough)
jest.mock("@/src/security/auth", () => ({
  getSession: async () => ({ units: ["uci-3", "hospitalizacion"] }),
  scopeByUnits: (_s: any, xs: any[], _sel: any) => xs,
}));

// Config de especialidades/unidades mínima para los chips (y defaults)
jest.mock("@/src/config/specialties", () => ({
  SPECIALTIES: [
    { id: "uci", name: "UCI" },
    { id: "hospitalizacion", name: "Hospitalización" },
  ],
  DEFAULT_SPECIALTY_ID: "uci",
}));

jest.mock("@/src/config/units", () => ({
  UNITS_BY_SPECIALTY: {
    uci: ["uci-3"],
    hospitalizacion: ["hospitalizacion"],
  },
  UNITS_BY_ID: {
    "uci-3": { id: "uci-3", name: "UCI · Sala 3" },
    hospitalizacion: { id: "hospitalizacion", name: "Hospitalización" },
  },
}));

// priority/news2Score: usa implementación real si existe; si no, mock básico estable
try {
  // deja pasar la real; si no existe, fallback
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("../../lib/priority");
} catch {
  jest.mock("../../lib/priority", () => ({
    news2Score: (v: any) => {
      // heurística simple para tests si tu real no está disponible
      let s = 0;
      if (typeof v?.rr === "number" && v.rr >= 25) s += 3;
      if (typeof v?.spo2 === "number" && v.spo2 <= 91) s += 3;
      if (v?.o2) s += 2;
      if (typeof v?.temp === "number" && v.temp >= 39) s += 2;
      if (typeof v?.sbp === "number" && v.sbp <= 90) s += 3;
      if (typeof v?.hr === "number" && v.hr >= 130) s += 3;
      return s;
    },
    priorityLabel: (s: number) => (s >= 7 ? "crítica" : s >= 5 ? "media" : "baja"),
  }));
}

// queueBootstrap.flushNow en header
jest.mock("@/src/lib/queueBootstrap", () => ({ flushNow: async () => {} }));

// ──────────────────────────────────────────────────────────────
// Import de la pantalla después de mocks
// ──────────────────────────────────────────────────────────────
import PatientList from "../PatientList";

// Helpers para el test
const uniq = (p = "t") => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function findAllText(node: TestRenderer.ReactTestRendererJSON | TestRenderer.ReactTestRendererJSON[] | null): string[] {
  const out: string[] = [];
  function walk(n: any) {
    if (!n) return;
    if (Array.isArray(n)) return n.forEach(walk);
    const children = n.children ?? [];
    for (const c of children) {
      if (typeof c === "string") out.push(c);
      else if (typeof c === "object") walk(c);
    }
  }
  walk(node);
  return out;
}

async function flush() {
  // varios ticks para permitir que useEffect/load resuelva
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

describe("PatientList — integración con fetch mockeado (filtros + sort)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("ordena por NEWS2 descendente (vitals) y renderiza primero el más crítico", async () => {
    // Pacientes con distintos NEWS2 (alto, medio, bajo)
    const pts = [
      {
        id: "p-crit",
        name: "Luis Mora",
        unitId: "uci-3",
        location: "UCI · Cama 5",
        bed: "Cama 5",
        vitals: { rr: 30, spo2: 90, o2: true, temp: 39.2, sbp: 85, hr: 140 }, // muy alto
      },
      {
        id: "p-mid",
        name: "Bea Gómez",
        unitId: "uci-3",
        location: "UCI · Cama 2",
        bed: "Cama 2",
        vitals: { rr: 22, spo2: 94, temp: 38.4, sbp: 105, hr: 100 }, // medio
      },
      {
        id: "p-low",
        name: "Ana Pérez",
        unitId: "uci-3",
        location: "UCI · Cama 1",
        bed: "Cama 1",
        vitals: { rr: 16, spo2: 98, temp: 37, sbp: 120, hr: 80 }, // bajo
      },
    ];
    getPatientsBySpecialtyMock.mockResolvedValueOnce(pts);

    const navigation = {
      setOptions: jest.fn(),
      getState: () => ({ routeNames: ["HandoverForm", "Handover"] }),
      navigate: jest.fn(),
    };

    let tree: TestRenderer.ReactTestRenderer;
    const route = { key: uniq("route"), name: "PatientList", params: undefined } as any;
    await act(async () => {
      tree = TestRenderer.create(<PatientList navigation={navigation as any} route={route} />);
    });
    await flush();

    // Captura todos los textos del render
    const texts = findAllText(tree!.toJSON() as any);

    // Asegura que el más crítico (Luis) aparece antes que los otros
    const iCrit = texts.findIndex((t) => t.includes("Luis Mora"));
    const iMid = texts.findIndex((t) => t.includes("Bea Gómez"));
    const iLow = texts.findIndex((t) => t.includes("Ana Pérez"));

    expect(iCrit).toBeGreaterThanOrEqual(0);
    expect(iMid).toBeGreaterThan(iCrit);
    expect(iLow).toBeGreaterThan(iMid);
  });

  it("filtro por texto (buscador) limita la lista a coincidencias por nombre/id", async () => {
    const pts = [
      { id: "p-1", name: "Ana Pérez", unitId: "uci-3", location: "UCI · Cama 1", bed: "Cama 1", vitals: { spo2: 98 } },
      { id: "p-2", name: "Luis Mora", unitId: "uci-3", location: "UCI · Cama 2", bed: "Cama 2", vitals: { spo2: 94 } },
      { id: "abc-33", name: "Bea Gómez", unitId: "uci-3", location: "UCI · Cama 3", bed: "Cama 3", vitals: { spo2: 95 } },
    ];
    getPatientsBySpecialtyMock.mockResolvedValueOnce(pts);

    const navigation = {
      setOptions: jest.fn(),
      getState: () => ({ routeNames: ["HandoverForm"] }),
      navigate: jest.fn(),
    };

    let tr!: TestRenderer.ReactTestRenderer;
    const route = { key: uniq("route"), name: "PatientList", params: undefined } as any;
    await act(async () => {
      tr = TestRenderer.create(<PatientList navigation={navigation as any} route={route} />);
    });
    await flush();

    // Encuentra el TextInput y dispara onChangeText('ana')
    const input = tr.root.findAll(
      (n) => n.type && typeof n.type === "string" && n.type.toLowerCase().includes("textinput")
    )[0];
    expect(input).toBeDefined();

    await act(async () => {
      input?.props?.onChangeText?.("ana");
    });
    await flush();

    const texts = findAllText(tr.toJSON() as any).join(" ");
    expect(texts.toLowerCase()).toContain("ana pérez");
    expect(texts.toLowerCase()).not.toContain("luis mora");
    expect(texts.toLowerCase()).not.toContain("bea gómez");
  });
});
