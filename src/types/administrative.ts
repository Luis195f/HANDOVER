export const SHIFT_TYPES = ['Mañana', 'Tarde', 'Noche'] as const;

export type ShiftType = (typeof SHIFT_TYPES)[number];

export interface ShiftAdminInfo {
  unit: string;
  staffOut: string[];
  staffIn: string[];
  shiftStart: string; // ISO string
  shiftEnd: string; // ISO string
  shiftType: ShiftType;
  generalNotes?: string;
}

export interface AdministrativeData extends ShiftAdminInfo {
  census: number;
  incidents?: string[]; // opcional
}
