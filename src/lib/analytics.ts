// Fase 3 – Bloque D (dashboard): utilidades de analítica de turno para supervisores.
import { PATIENTS_MOCK } from '@/src/data/mockPatients';
import { computePriorityList } from './priority';
import type { PriorityLevel, PrioritizedPatient, PriorityInput } from './priority';

export interface TurnFilter {
  unitId: string;
  start: string; // ISO datetime de inicio de turno
  end: string; // ISO datetime de fin de turno
}

export interface TurnMetrics {
  totalPatients: number;
  byPriority: Record<PriorityLevel, number>;
  averageNews2: number | null;
  pendingCriticalTasks: number;
  incidentsCount: number;
}

export async function getTurnData(filter: TurnFilter): Promise<PriorityInput[]> {
  // TODO: reemplazar por consulta a backend/analytics service.
  const patientsForUnit = PATIENTS_MOCK.filter(patient => patient.unitId === filter.unitId);

  return patientsForUnit.map(patient => ({
    patientId: patient.id,
    displayName: patient.name,
    bedLabel: patient.bedLabel,
    vitals: patient.vitals ?? {},
    devices: patient.devices ?? [],
    risks: patient.risks ?? {},
    pendingTasks: patient.pendingTasks ?? [],
    lastIncidentAt: patient.lastIncidentAt ?? null,
    recentIncidentFlag: patient.recentIncidentFlag,
    referenceTime: filter.end,
  }));
}

export function buildPrioritySnapshot(inputs: PriorityInput[]): PrioritizedPatient[] {
  return computePriorityList(inputs);
}

export function computeTurnMetrics(patients: PrioritizedPatient[]): TurnMetrics {
  const byPriority: Record<PriorityLevel, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  let incidentsCount = 0;
  let news2Sum = 0;

  patients.forEach(patient => {
    byPriority[patient.level] += 1;
    news2Sum += patient.news2Score;
    if (patient.reasons.includes('RECENT_INCIDENT')) {
      incidentsCount += 1;
    }
  });

  const totalPatients = patients.length;
  const averageNews2 = totalPatients === 0 ? null : Number((news2Sum / totalPatients).toFixed(1));

  return {
    totalPatients,
    byPriority,
    averageNews2,
    pendingCriticalTasks: 0, // TODO: mapear tareas críticas cuando estén disponibles en PrioritizedPatient
    incidentsCount,
  };
}
