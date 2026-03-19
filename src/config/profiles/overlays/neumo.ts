import type { SpecialtyOverlayRuntimePack } from '../../../types/profile';

export const NEUMO_SPECIALTY_OVERLAY_RUNTIME_PACK = {
  id: 'neumo',
  label: 'Overlay respiratorio',
  enabledSections: ['oxigenoterapia', 'examenes'],
  requiredExtraFields: ['Soporte O2 o NIV', 'Disnea y trabajo respiratorio', 'Secreciones', 'Tolerancia al esfuerzo'],
  optionalExtraFields: ['Gasometria cuando aplique', 'Fatiga respiratoria o broncoespasmo dominante'],
  focusAreas: [
    'Oxigenacion, ventilacion y trabajo respiratorio',
    'Secreciones, NIV y fatiga respiratoria con reevaluacion frecuente',
  ],
  explanations: [
    'Refuerza soporte respiratorio activo, trabajo ventilatorio y secreciones sin duplicar secciones.',
    'Hace visible FiO2, tolerancia y momento de reevaluacion del intercambio gaseoso.',
  ],
  scales: ['NEWS2', 'Disnea local'],
  sentinelEvents: ['Insuficiencia respiratoria', 'Agotamiento respiratorio', 'Broncoaspiracion', 'Deterioro del intercambio gaseoso'],
  quickPicks: {
    treatments: [
      { id: 'neumo-fio2', type: 'respiratory', description: 'Confirmar FiO2, dispositivo y objetivo de saturacion del turno' },
      { id: 'neumo-work-of-breathing', type: 'respiratory', description: 'Reevaluar uso de musculatura accesoria, disnea y fatiga' },
      { id: 'neumo-secretions', type: 'respiratory', description: 'Registrar secreciones, tolerancia a fisioterapia y necesidad de aspiracion' },
      { id: 'neumo-niv', type: 'other', description: 'Verificar tolerancia a NIV y gatillos de escalado respiratorio' },
    ],
  },
  visibleOutputs: [
    'Quien primero: paciente con mayor soporte respiratorio o trabajo ventilatorio',
    'No omitir: FiO2, trabajo respiratorio y secreciones',
    'Cuando reevaluar: ante fatiga, desaturacion o intolerancia a NIV/O2',
  ],
} as const satisfies SpecialtyOverlayRuntimePack & { id: 'neumo' };
