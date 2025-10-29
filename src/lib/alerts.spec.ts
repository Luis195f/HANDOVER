import { describe, expect, it } from "vitest";
import { ALERT_CODES } from "./codes";
import { alertsFromData, ClinicalInput } from "./alerts";

const FIXED_NOW = "2024-02-15T12:00:00.000Z";
const nowProvider = () => FIXED_NOW;

describe("alertsFromData", () => {
  it("incluye alerta NEWS2 con severidad según banda", () => {
    const input: ClinicalInput = {
      vitals: { rr: 30, spo2: 90, temp: 39, sbp: 85, hr: 130, o2: true, avpu: "V" },
    };

    const alerts = alertsFromData(input, { now: nowProvider });
    const news2 = alerts.find(a => a.code === ALERT_CODES.news2);

    expect(news2).toBeTruthy();
    expect(news2?.severity).toBe("critical");
    expect(news2?.data).toMatchObject({ total: expect.any(Number), band: "CRÍTICA" });
  });

  it("genera alerta por catéter con más de 7 días", () => {
    const input: ClinicalInput = {
      vitals: { rr: 18 },
      lines: [
        { id: "cvc", kind: "catheter", insertedAt: "2024-02-01T10:00:00.000Z", label: "CVC" },
        { id: "piv", kind: "catheter", insertedAt: "2024-02-10T10:00:00.000Z", label: "PIV" },
      ],
    };

    const alerts = alertsFromData(input, { now: nowProvider });
    const catheterAlert = alerts.find(a => a.code === ALERT_CODES.catheterOverdue);

    expect(catheterAlert).toBeTruthy();
    expect(catheterAlert?.severity).toBe("high");
    expect(catheterAlert?.message).toContain("Catéter CVC");
    expect(alerts.filter(a => a.code === ALERT_CODES.catheterOverdue).length).toBe(1);
  });

  it("detecta conflicto alergia-medicación", () => {
    const input: ClinicalInput = {
      vitals: { rr: 16 },
      allergies: [
        { id: "alg1", substance: "Penicilina" },
      ],
      medications: [
        { id: "med1", name: "Piperacilina", ingredients: ["penicilina"] },
      ],
    };

    const alerts = alertsFromData(input, { now: nowProvider });
    const conflict = alerts.find(a => a.code === ALERT_CODES.allergyConflict);

    expect(conflict).toBeTruthy();
    expect(conflict?.severity).toBe("critical");
    expect(conflict?.message).toContain("Piperacilina");
  });

  it("alerta curación o drenaje vencidos", () => {
    const input: ClinicalInput = {
      vitals: { rr: 18 },
      woundCare: [
        { id: "d1", kind: "dressing", dueAt: "2024-02-10T10:00:00.000Z", description: "Curación abdominal" },
        { id: "dr1", kind: "drain", dueAt: "2024-02-20T10:00:00.000Z" },
      ],
    };

    const alerts = alertsFromData(input, { now: nowProvider });
    const dressing = alerts.find(a => a.code === ALERT_CODES.dressingOverdue);
    const drain = alerts.find(a => a.code === ALERT_CODES.drainOverdue);

    expect(dressing).toBeTruthy();
    expect(dressing?.severity).toBe("moderate");
    expect(drain).toBeUndefined();
  });

  it("escala oxigenoterapia prolongada", () => {
    const input: ClinicalInput = {
      vitals: { rr: 20 },
      oxygenTherapy: {
        active: true,
        start: "2024-02-10T10:00:00.000Z",
        fio2: 0.65,
      },
    };

    const alerts = alertsFromData(input, { now: nowProvider });
    const oxygen = alerts.find(a => a.code === ALERT_CODES.oxygenProlonged);

    expect(oxygen).toBeTruthy();
    expect(oxygen?.severity).toBe("critical");
    expect(oxygen?.message).toContain("Oxigenoterapia prolongada");
  });
});
