import { describe, expect, it } from "vitest";
import { alertsFromData } from "./alerts";

const FIXED_NOW = "2024-02-15T12:00:00.000Z";
const fixedNow = new Date(FIXED_NOW);

describe("alertsFromData", () => {
  it("incluye alerta NEWS2 con severidad según banda", () => {
    const alerts = alertsFromData({ news2Score: 8, now: fixedNow });
    const news2 = alerts.find(a => a.kind === "NEWS2_HIGH");

    expect(news2).toBeTruthy();
    expect(news2?.severity).toBe("critical");
  });

  it("genera alerta por catéter con más de 7 días", () => {
    const alerts = alertsFromData({
      now: fixedNow,
      devices: [
        { code: "cvc", insertedAt: "2024-02-01T10:00:00.000Z" },
        { code: "piv", insertedAt: "2024-02-10T10:00:00.000Z" },
      ],
    });
    const catheterAlert = alerts.find(a => a.kind === "DEVICE_OLD");

    expect(catheterAlert).toBeTruthy();
    expect(catheterAlert?.severity).toBe("warning");
  });

  it("detecta conflicto alergia-medicación", () => {
    const alerts = alertsFromData({
      allergies: [{ code: "penicilina" }],
      medications: [{ code: "penicilina" }],
    });
    const conflict = alerts.find(a => a.kind === "ALLERGY_CONFLICT");

    expect(conflict).toBeTruthy();
    expect(conflict?.severity).toBe("critical");
  });

  it("alerta tareas vencidas no críticas", () => {
    const alerts = alertsFromData({
      now: fixedNow,
      tasks: [{ id: "task-1", dueAt: "2024-02-10T10:00:00.000Z", completed: false }],
    });
    const task = alerts.find(a => a.kind === "TASK_OVERDUE");

    expect(task).toBeTruthy();
    expect(task?.severity).toBe("warning");
  });

  it("escala tareas críticas vencidas", () => {
    const alerts = alertsFromData({
      now: fixedNow,
      tasks: [{ id: "task-1", dueAt: "2024-02-10T10:00:00.000Z", completed: false, critical: true }],
    });
    const task = alerts.find(a => a.kind === "TASK_OVERDUE");

    expect(task).toBeTruthy();
    expect(task?.severity).toBe("critical");
  });
});
