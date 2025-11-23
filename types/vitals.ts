// BEGIN HANDOVER D2 – VitalTrends types
export interface VitalPoint {
  time: string; // ISO 8601 (ej. fecha/hora de la Observation)
  value: number; // valor numérico normalizado
}

export interface VitalTrendsData {
  hr: VitalPoint[];
  sbp: VitalPoint[];
  rr: VitalPoint[];
  spo2: VitalPoint[];
  temp: VitalPoint[];
}
// END HANDOVER D2 – VitalTrends types
