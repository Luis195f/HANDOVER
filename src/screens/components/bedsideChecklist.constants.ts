import type { HandoverBedsideChecklist } from '@/src/types/handover';

export const BEDSIDE_CHECKLIST_BOOLEAN_KEYS = [
  'patientIdentityConfirmed',
  'allergiesReviewed',
  'linesAndDevicesChecked',
  'medicationPlanReviewed',
  'safetyMeasuresApplied',
  'questionsAnswered',
] as const;

export type BedsideChecklistBooleanKey = (typeof BEDSIDE_CHECKLIST_BOOLEAN_KEYS)[number];

export const BEDSIDE_CHECKLIST_ITEMS: Array<{
  key: BedsideChecklistBooleanKey;
  label: string;
  helper?: string;
}> = [
  { key: 'patientIdentityConfirmed', label: 'Paciente identificado (nombre + pulsera)' },
  { key: 'allergiesReviewed', label: 'Alergias y alertas revisadas' },
  { key: 'linesAndDevicesChecked', label: 'Líneas, catéteres y dispositivos verificados' },
  { key: 'medicationPlanReviewed', label: 'Plan de medicación y tratamientos verificado' },
  { key: 'safetyMeasuresApplied', label: 'Medidas de seguridad aplicadas (barandillas, cama baja, etc.)' },
  { key: 'questionsAnswered', label: 'Preguntas del equipo entrante resueltas' },
];

export function isBedsideChecklistComplete(values: HandoverBedsideChecklist | undefined): boolean {
  if (!values) return false;
  return BEDSIDE_CHECKLIST_BOOLEAN_KEYS.every((key) => values[key] === true);
}
