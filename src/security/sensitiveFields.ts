export type SensitiveFieldPath = string;

/**
 * Inventario de rutas/campos que contienen datos sensibles de paciente o
 * credenciales. Sirve para revisar periódicamente qué campos se guardan en
 * local (cola offline, storage, etc.) y garantizar que todos ellos se
 * almacenan cifrados.
 *
 * Si en el futuro se añaden nuevos datos clínicos o tokens al storage local,
 * deben añadirse aquí para mantener el inventario actualizado.
 */
export const SENSITIVE_FIELDS: SensitiveFieldPath[] = [
  // Identificación de paciente
  'patientId',
  'patient.id',
  'patient.identifier',
  'patient.name',
  'administrativeData.unit',
  'administrativeData.staffIn',
  'administrativeData.staffOut',
  'administrativeData.shiftStart',
  'administrativeData.shiftEnd',
  'administrativeData.census',

  // Contenido clínico del handover
  'diagnosis',
  'evolution',
  'vitals',
  'vitalsHistory',
  'devices',
  'medications',
  'exams',
  'examsPending',
  'risks',
  'incidents',
  'summary',
  'audioNotes',
  'attachments',

  // Autenticación / tokens
  'auth.accessToken',
  'auth.refreshToken',
  'auth.userId',
];
