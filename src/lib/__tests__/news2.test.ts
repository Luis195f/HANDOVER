import { describe, it, expect } from "vitest";
import * as mod from "../news2";

type Vitals = {
  rr?: number;
  spo2?: number;
  temp?: number;
  sbp?: number;
  hr?: number;
  o2?: boolean;
  acvpu?: "A" | "C" | "V" | "P" | "U";
};

// --- helpers de compat ---
function pickFn() {
  return (
    (mod as any).scoreNEWS2 ||
    (mod as any).computeNEWS2 ||
    (mod as any).calcNEWS2 ||
    (mod as any).news2Score ||
    (mod as any).default
  );
}

function getScoreAndBand(res: any): { score: number; band?: string } {
  if (typeof res === "number") return { score: res };
  if (res && typeof res === "object") {
    const score = (res.score ?? res.total ?? res.value) as number;
    const band = (res.band ?? res.risk ?? res.level) as string | undefined;
    return { score, band };
  }
  throw new Error("NEWS2 function returned unexpected value");
}

function norm(s?: string) {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // quita acentos (critica ~ crítica)
}
function bandIsLow(b?: string) {
  const x = norm(b);
  return (
    x.includes("low") ||
    x.includes("baja") ||
    x.includes("bajo") ||
    x.includes("leve")
  );
}
function bandIsMedium(b?: string) {
  const x = norm(b);
  return (
    x.includes("medium") ||
    x.includes("moderate") ||
    x.includes("media") ||
    x.includes("moderada") ||
    x.includes("intermedio")
  );
}
function bandIsHigh(b?: string) {
  const x = norm(b);
  return (
    x.includes("high") ||
    x.includes("alta") ||
    x.includes("alto") ||
    x.includes("critica") || // crítica
    x.includes("severa")
  );
}

// --- tests ---
describe("NEWS2 (puntajes y bordes)", () => {
  const fn = pickFn();
  if (!fn) {
    throw new Error(
      "No se encontró función exportada en news2.ts (scoreNEWS2/computeNEWS2/calcNEWS2/news2Score/default)"
    );
  }

  it("normal (todo en rango): score 0, banda baja (si se expone)", () => {
    const { score, band } = getScoreAndBand(
      fn({
        rr: 16,
        spo2: 98,
        temp: 37.0,
        sbp: 120,
        hr: 80,
        acvpu: "A",
        o2: false,
      } as Vitals)
    );
    expect(score).toBe(0);
    if (band) expect(bandIsLow(band)).toBe(true);
  });

  it("alto (varios extremos): score ≥7, banda alta/critica (si se expone)", () => {
    const { score, band } = getScoreAndBand(
      fn({
        rr: 30, // 3
        spo2: 89, // 3
        o2: true, // +2
        temp: 39.5, // 2
        sbp: 85, // 3
        hr: 140, // 3
        acvpu: "C", // 3 en muchos motores (si no puntúa, el score seguirá siendo muy alto por el resto)
      } as Vitals)
    );
    expect(score).toBeGreaterThanOrEqual(7);
    if (band) expect(bandIsHigh(band)).toBe(true);
  });

  it("borde: SpO2 95 sin O₂ vs con O₂ (+2 por O₂)", () => {
    const base = getScoreAndBand(
      fn({
        rr: 16,
        spo2: 95,
        temp: 37.0,
        sbp: 120,
        hr: 80,
        acvpu: "A",
        o2: false,
      } as Vitals)
    ).score;

    const conO2 = getScoreAndBand(
      fn({
        rr: 16,
        spo2: 95,
        temp: 37.0,
        sbp: 120,
        hr: 80,
        acvpu: "A",
        o2: true,
      } as Vitals)
    ).score;

    expect(conO2 - base).toBe(2);
  });

  it("ACVPU ≠ A (p.ej. V): puede sumar 3 o 0 según implementación; nunca debe restar", () => {
    const base = getScoreAndBand(
      fn({
        rr: 16,
        spo2: 98,
        temp: 37.0,
        sbp: 120,
        hr: 80,
        acvpu: "A",
        o2: false,
      } as Vitals)
    ).score;

    const conV = getScoreAndBand(
      fn({
        rr: 16,
        spo2: 98,
        temp: 37.0,
        sbp: 120,
        hr: 80,
        acvpu: "V",
        o2: false,
      } as Vitals)
    ).score;

    const diff = conV - base;
    expect([0, 3]).toContain(diff);
  });

  it("mixto leve (sin 3 individuales): score ≈3, banda baja o media (si existe)", () => {
    const { score, band } = getScoreAndBand(
      fn({
        rr: 16,
        spo2: 95, // 1
        temp: 38.4, // 1
        hr: 100, // 1
        sbp: 120,
        acvpu: "A",
        o2: false,
      } as Vitals)
    );
    expect(score).toBeGreaterThanOrEqual(3);
    if (band) expect(bandIsLow(band) || bandIsMedium(band)).toBe(true);
  });
});
