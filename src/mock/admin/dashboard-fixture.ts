import type { UnitSummary, StaffActivity, AlertSummary } from '../../types/admin';

export const mockUnitSummaries: UnitSummary[] = [
  {
    unitId: 'icu-adult',
    unitName: 'UCI Adulto',
    totalHandovers: 24,
    completedHandovers: 22,
    pendingHandovers: 2,
    criticalPatients: 3,
  },
  {
    unitId: 'cardio-icu',
    unitName: 'UCI Cardiología',
    totalHandovers: 16,
    completedHandovers: 15,
    pendingHandovers: 1,
    criticalPatients: 1,
  },
];

export const mockStaffActivity: StaffActivity[] = [
  {
    staffId: 'nurse-001',
    name: 'Enf. García',
    role: 'nurse',
    unitId: 'icu-adult',
    handoversCompleted: 10,
    handoversReceived: 9,
    lastHandoverAt: '2025-11-21T07:30:00Z',
  },
  {
    staffId: 'nurse-002',
    name: 'Enf. López',
    role: 'nurse',
    unitId: 'cardio-icu',
    handoversCompleted: 8,
    handoversReceived: 8,
    lastHandoverAt: '2025-11-21T07:45:00Z',
  },
];

export const mockAlertSummaries: AlertSummary[] = [
  {
    id: 'alert-1',
    unitId: 'icu-adult',
    patientId: 'patient-123',
    patientDisplay: 'Paciente 123',
    type: 'NEWS2_HIGH',
    message: 'Paciente con NEWS2 ≥ 7, revisar de inmediato.',
    createdAt: '2025-11-21T06:50:00Z',
  },
  {
    id: 'alert-2',
    unitId: 'cardio-icu',
    patientId: 'patient-456',
    patientDisplay: 'Paciente 456',
    type: 'PENDING_CRITICAL_TASKS',
    message: 'Tareas críticas pendientes en turno actual.',
    createdAt: '2025-11-21T06:30:00Z',
  },
];
