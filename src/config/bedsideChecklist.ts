export type BedsideChecklistItem = {
  key: string;
  label: string;
  helper?: string;
};

export const DEFAULT_BEDSIDE_CHECKLIST_ITEMS: BedsideChecklistItem[] = [
  { key: 'patientIdentityConfirmed', label: 'Paciente identificado (nombre + pulsera)' },
  { key: 'allergiesReviewed', label: 'Alergias y alertas revisadas' },
  { key: 'linesAndDevicesChecked', label: 'Líneas, catéteres y dispositivos verificados' },
  { key: 'medicationPlanReviewed', label: 'Plan de medicación y tratamientos verificado' },
  { key: 'safetyMeasuresApplied', label: 'Medidas de seguridad aplicadas (barandillas, cama baja, etc.)' },
  { key: 'questionsAnswered', label: 'Preguntas del equipo entrante resueltas' },
];
