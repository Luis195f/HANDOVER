import type { PatientListItem } from '@/src/data/mockPatients';
import type { DeviceSummary, PendingTaskSummary, RiskFlags, VitalsSnapshot } from '@/src/types/handover';

import type { PriorityInput } from './priority';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function asIdentifierString(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return asString(value);
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function extractPatientResources(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => item != null);
  }

  const root = asRecord(payload);
  if (!root) return [];

  if (Array.isArray(root.results)) {
    return root.results
      .map((item) => asRecord(item))
      .filter((item): item is Record<string, unknown> => item != null);
  }

  if (Array.isArray(root.entry)) {
    return root.entry
      .map((entry) => asRecord(entry)?.resource)
      .map((resource) => asRecord(resource))
      .filter((resource): resource is Record<string, unknown> => resource != null);
  }

  return [];
}

export function normalizePatientListResponse(payload: unknown, fallbackUnitId?: string): PatientListItem[] {
  return extractPatientResources(payload).map((patient) => {
    const firstName = asString(patient.first_name);
    const lastName = asString(patient.last_name);
    const displayName =
      asString(patient.name) ??
      asString(patient.displayName) ??
      asString(patient.fullName) ??
      [firstName, lastName].filter(Boolean).join(' ').trim() ??
      'Paciente';

    const unitId =
      asString(patient.unitId) ??
      asString(patient.unit_id) ??
      asString(patient.unit) ??
      fallbackUnitId ??
      '';

    return {
      id: asIdentifierString(patient.id) ?? asIdentifierString(patient.patientId) ?? '',
      name: displayName || 'Paciente',
      unitId,
      bedLabel: asString(patient.bedLabel) ?? asString(patient.bed) ?? asString(patient.room) ?? '',
      vitals: (asRecord(patient.vitals) ?? {}) as VitalsSnapshot,
      devices: asArray<DeviceSummary>(patient.devices),
      risks: (asRecord(patient.risks) ?? {}) as RiskFlags,
      pendingTasks: asArray<PendingTaskSummary>(patient.pendingTasks),
      lastIncidentAt: asString(patient.lastIncidentAt) ?? null,
      recentIncidentFlag: Boolean(patient.recentIncidentFlag),
    };
  });
}

export function buildPriorityInputs(patients: readonly PatientListItem[]): PriorityInput[] {
  return patients.map((patient) => ({
    patientId: patient.id,
    displayName: patient.name,
    bedLabel: patient.bedLabel,
    vitals: patient.vitals ?? {},
    devices: patient.devices ?? [],
    risks: patient.risks ?? {},
    pendingTasks: patient.pendingTasks ?? [],
    unitId: patient.unitId,
    lastIncidentAt: patient.lastIncidentAt ?? null,
    recentIncidentFlag: patient.recentIncidentFlag,
  }));
}
