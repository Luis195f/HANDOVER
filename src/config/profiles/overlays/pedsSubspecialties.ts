import type { SpecialtyOverlayRuntimePack } from '../../../types/profile';

export const PEDS_SUBSPECIALTIES_SPECIALTY_OVERLAY_RUNTIME_PACK = {
  id: 'pedsSubspecialties',
  label: 'Overlay pediatrico',
  enabledSections: ['psychosocial', 'escalas'],
  requiredExtraFields: ['Peso y edad', 'Dependencia aumentada', 'Tolerancia oral', 'Comunicacion con familia'],
  optionalExtraFields: ['Seguridad de dosis por kg', 'Soporte familiar dominante'],
  focusAreas: [
    'Dependencia pediatrica, peso/edad y seguridad farmacologica',
    'Tolerancia, hidratacion y comunicacion con familia/cuidador',
  ],
  explanations: [
    'Queda registrado para overlays pediatrico-subespecializados cuando exista una base pediatrica compatible.',
    'Se mantiene pilot-off por prudencia: catalogado y trazable, sin ampliar por defecto la activacion clinica.',
  ],
  scales: ['PEWS local', 'Dolor pediatrico'],
  sentinelEvents: ['Deshidratacion', 'Deterioro rapido', 'Error de dosis', 'Ruptura de comunicacion con familia'],
  quickPicks: {
    treatments: [
      { id: 'peds-weight-check', type: 'other', description: 'Confirmar peso/edad y seguridad de dosis antes del cierre del turno' },
      { id: 'peds-hydration', type: 'other', description: 'Registrar tolerancia oral, hidratacion y signos de alarma pediatrica' },
      { id: 'peds-family-communication', type: 'education', description: 'Dejar visible que entiende la familia y que debe vigilar' },
    ],
  },
  visibleOutputs: [
    'Quien primero: paciente pediatrico con alta dependencia o cambio rapido',
    'No omitir: peso/edad, tolerancia y comunicacion con familia',
    'Cuando reevaluar: ante intolerancia oral, dificultad respiratoria o duda de dosis',
  ],
} as const satisfies SpecialtyOverlayRuntimePack & { id: 'pedsSubspecialties' };
