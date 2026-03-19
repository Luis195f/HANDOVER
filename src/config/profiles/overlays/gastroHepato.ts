import type { SpecialtyOverlayRuntimePack } from '../../../types/profile';

export const GASTRO_HEPATO_SPECIALTY_OVERLAY_RUNTIME_PACK = {
  id: 'gastroHepato',
  label: 'Overlay gastro-hepato',
  enabledSections: ['elimination', 'fluidBalance'],
  requiredExtraFields: ['Sangrado digestivo', 'Dolor abdominal', 'Vomitos/diarrea', 'Ostomia o drenaje', 'Encefalopatia', 'Tolerancia oral'],
  optionalExtraFields: ['Hidratacion/nutricion dominante', 'Signos de peritonismo o fallo de drenaje'],
  focusAreas: [
    'Sangrado digestivo, encefalopatia y dolor abdominal',
    'Drenajes, ostomias, hidratacion y tolerancia oral con continuidad visible',
  ],
  explanations: [
    'Refuerza prioridad por sangrado, encefalopatia y seguridad de drenajes en el mismo formulario.',
    'Hace visible hidratacion, tolerancia oral y momento de reevaluacion abdominal o hepatica.',
  ],
  scales: ['EVA', 'Balance/hidratacion'],
  sentinelEvents: ['Hemorragia digestiva', 'Encefalopatia', 'Deshidratacion', 'Peritonismo', 'Fallo de drenaje'],
  quickPicks: {
    treatments: [
      { id: 'gastro-bleeding', type: 'other', description: 'Cuantificar sangrado digestivo y ultima eliminacion relevante' },
      { id: 'gastro-drains', type: 'woundCare', description: 'Revisar ostomia, drenajes y caracteristicas de salida' },
      { id: 'gastro-hydration', type: 'other', description: 'Cerrar hidratacion, perdidas y tolerancia oral del turno' },
      { id: 'gastro-encephalopathy', type: 'other', description: 'Dejar visible cambio del sensorio y reevaluacion de encefalopatia' },
    ],
  },
  visibleOutputs: [
    'Quien primero: sangrado, encefalopatia o abdomen agudo',
    'No omitir: drenajes, hidratacion y tolerancia oral',
    'Cuando reevaluar: ante sangrado, vomitos persistentes o cambio del sensorio',
  ],
} as const satisfies SpecialtyOverlayRuntimePack & { id: 'gastroHepato' };
