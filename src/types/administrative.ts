export interface AdministrativeData {
  unit: string;
  census: number;
  staffOut: string[];
  staffIn: string[];
  shiftStart: string; // ISO string
  shiftEnd: string; // ISO string
  incidents?: string[]; // opcional
}

