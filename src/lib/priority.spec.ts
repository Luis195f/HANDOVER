import { describe, expect, it } from "vitest";
import { ALERT_CODES } from "./codes";
import { Alert } from "./alerts";
import {
  computePriorityList,
  news2Score,
  priorityFromNews2,
  sortByPriority,
  ClinicalPatientSummary,
} from "./priority";

describe("priority utilities", () => {
  it("news2Score reutiliza computeNEWS2", () => {
    const score = news2Score({ rr: 28, spo2: 90, temp: 39.2, sbp: 88, hr: 135, o2: true, acvpu: "V" });
    expect(score).toBeGreaterThan(18);
  });

  it("priorityFromNews2 mantiene umbrales", () => {
    expect(priorityFromNews2(4)).toBe("low");
    expect(priorityFromNews2(5)).toBe("medium");
    expect(priorityFromNews2(7)).toBe("high");
  });

  it("sortByPriority se mantiene estable", () => {
    const data = [
      { id: "a", news2: 5 },
      { id: "b", news2: 7 },
      { id: "c", news2: 5 },
    ];

    const sorted = sortByPriority(data);
    expect(sorted.map(x => x.id)).toEqual(["b", "a", "c"]);
  });
});

describe("computePriorityList", () => {
  const baseAlerts = (code: string, severity: Alert["severity"], message: string): Alert => ({
    id: `${code}:1`,
    code,
    severity,
    message,
  });

  it("ordena por NEWS2, alertas y factores clínicos", () => {
    const patients: ClinicalPatientSummary[] = [
      {
        id: "p1",
        name: "Paciente Uno",
        news2: 8,
        alerts: [baseAlerts(ALERT_CODES.news2, "critical", "NEWS2 8 (CRÍTICA)")],
        glucoseFlag: "hypo",
        oxygen: { active: true, prolonged: true, start: "2024-02-10T10:00:00.000Z" },
        lastUpdated: "2024-02-15T11:00:00.000Z",
        recentChangeAt: "2024-02-15T10:30:00.000Z",
      },
      {
        id: "p2",
        name: "Paciente Dos",
        news2: 6,
        alerts: [baseAlerts(ALERT_CODES.oxygenProlonged, "high", "Oxigenoterapia prolongada")],
        glucoseFlag: null,
        oxygen: { active: true, prolonged: false, start: "2024-02-14T08:00:00.000Z" },
        lastUpdated: "2024-02-15T10:50:00.000Z",
      },
      {
        id: "p3",
        name: "Paciente Tres",
        news2: 6,
        alerts: [baseAlerts(ALERT_CODES.allergyConflict, "critical", "Alergia y medicación")],
        glucoseFlag: "hyper",
        oxygen: { active: false },
        lastUpdated: "2024-02-15T09:00:00.000Z",
      },
    ];

    const prioritized = computePriorityList(patients);

    expect(prioritized.map(p => p.id)).toEqual(["p1", "p3", "p2"]);
    const p1 = prioritized[0];
    expect(p1.reason).toContain("NEWS2 8 (CRÍTICA)");
    expect(p1.reason).toContain("Hipoglucemia reciente");
    expect(p1.reason).toContain("Oxígeno prolongado");
    expect(p1.priority).toBeGreaterThan(prioritized[1].priority);
  });

  it("utiliza lastUpdated como desempate final", () => {
    const patients: ClinicalPatientSummary[] = [
      {
        id: "p4",
        name: "Paciente Cuatro",
        news2: 3,
        alerts: [],
        glucoseFlag: null,
        oxygen: { active: false },
        lastUpdated: "2024-02-15T08:00:00.000Z",
      },
      {
        id: "p5",
        name: "Paciente Cinco",
        news2: 3,
        alerts: [],
        glucoseFlag: null,
        oxygen: { active: false },
        lastUpdated: "2024-02-15T10:00:00.000Z",
      },
    ];

    const prioritized = computePriorityList(patients);
    expect(prioritized.map(p => p.id)).toEqual(["p5", "p4"]);
  });
});
