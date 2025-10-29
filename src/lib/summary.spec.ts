import { describe, expect, it } from "vitest";
import { ALERT_CODES } from "./codes";
import { ClinicalInput } from "./alerts";
import { generateTurnSummary } from "./summary";

const FIXED_NOW = "2024-02-15T12:00:00.000Z";

describe("generateTurnSummary", () => {
  it("produce resumen SBAR con alertas y oxígeno", () => {
    const data: ClinicalInput = {
      patient: { id: "p1", name: "Juana Pérez", diagnosis: "Neumonía adquirida en la comunidad" },
      vitals: { rr: 30, spo2: 90, temp: 38.5, sbp: 95, hr: 120, o2: true, avpu: "C" },
      lines: [{ id: "cvc", kind: "catheter", insertedAt: "2024-02-05T10:00:00.000Z", label: "CVC" }],
      oxygenTherapy: { active: true, start: "2024-02-10T10:00:00.000Z", fio2: 0.4, flowLpm: 4 },
      glucoseReadings: [
        { value: 55, unit: "mg/dL", takenAt: "2024-02-15T09:00:00.000Z" },
      ],
      medications: [
        { id: "med1", name: "Noradrenalina", critical: true },
      ],
    };

    const summary = generateTurnSummary(data, { now: () => FIXED_NOW });

    expect(summary.highlights.news2).toBeGreaterThan(0);
    expect(summary.highlights.band).toBe("CRÍTICA");
    expect(summary.highlights.alertsTop.length).toBeGreaterThan(0);
    expect(summary.highlights.oxygen).toContain("Oxígeno");
    expect(summary.highlights.glucoseFlag).toBe("hypo");
    expect(summary.highlights.medsCritical).toContain("Noradrenalina");

    const lines = summary.text.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.length).toBeLessThanOrEqual(5);
    expect(lines[0]).toContain("S: Juana Pérez");
    expect(lines[1]).toContain("B: Neumonía");
    expect(lines[2]).toContain("Alertas principales");
    expect(summary.text).toContain("Hipoglucemia");
  });

  it("maneja casos sin alertas ni diagnóstico", () => {
    const data: ClinicalInput = {
      patient: { id: "p2", name: "Carlos Díaz" },
      vitals: { rr: 16, spo2: 97, temp: 36.5, sbp: 120, hr: 85, o2: false, avpu: "A" },
    };

    const summary = generateTurnSummary(data, { now: () => FIXED_NOW });

    expect(summary.highlights.alertsTop[0].code).toBe(ALERT_CODES.news2);
    expect(summary.highlights.glucoseFlag).toBeNull();
    expect(summary.highlights.medsCritical).toEqual([]);
    expect(summary.text).toContain("B: Sin diagnóstico documentado.");
    expect(summary.text).toContain("Sin alertas activas");
  });
});
