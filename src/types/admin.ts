export interface UnitSummary {
  unitId: string;
  unitName: string;
  totalHandovers: number;
  completedHandovers: number;
  pendingHandovers: number;
  criticalPatients: number;
}

export interface StaffActivity {
  staffId: string;
  name: string;
  role: 'nurse' | 'supervisor' | 'admin' | 'other';
  unitId: string;
  handoversCompleted: number;
  handoversReceived: number;
  lastHandoverAt: string | null;
}

export type AlertType =
  | 'NEWS2_HIGH'
  | 'PENDING_CRITICAL_TASKS'
  | 'INCIDENT_REPORTED';

export interface AlertSummary {
  id: string;
  unitId: string;
  patientId: string;
  patientDisplay?: string;
  type: AlertType;
  message: string;
  createdAt: string;
}
