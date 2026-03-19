import type { SpecialtyOverlayRuntimePack } from '../../../types/profile';

export const GYN_OBS_SPECIALTY_OVERLAY_RUNTIME_PACK = {
  id: 'gynObs',
  label: 'Overlay gineco-obstetrico',
  enabledSections: ['fluidBalance', 'examenes'],
  requiredExtraFields: ['Sangrado', 'Dolor', 'TA', 'Contexto obstetrico/ginecologico', 'Perdidas', 'Signos de alarma'],
  optionalExtraFields: ['Puerperio/embarazo cuando aplique', 'Vigilancia materna inmediata'],
  focusAreas: [
    'Sangrado, dolor e hipertension con vigilancia materna visible',
    'Perdidas, puerperio/embarazo y continuidad del contexto gineco-obstetrico',
  ],
  explanations: [
    'Refuerza prioridad por sangrado, hipertension y dolor sin crear una pantalla distinta para gineco-obstetricia.',
    'Hace visible que no debe omitirse de perdidas, TA y vigilancia materna en el relevo.',
  ],
  scales: ['EVA', 'Signos vitales'],
  sentinelEvents: ['Hemorragia', 'Crisis hipertensiva', 'Sepsis puerperal', 'Dolor pelvico agudo'],
  quickPicks: {
    treatments: [
      { id: 'gynobs-bleeding', type: 'other', description: 'Cuantificar sangrado o perdidas y documentar cambio reciente' },
      { id: 'gynobs-bp', type: 'other', description: 'Revisar TA, sintomas asociados y gatillos de escalado' },
      { id: 'gynobs-pain', type: 'other', description: 'Reevaluar dolor, respuesta analgesica y signos de abdomen/pelvis aguda' },
      { id: 'gynobs-surveillance', type: 'education', description: 'Dejar visible vigilancia materna y proxima reevaluacion no delegable' },
    ],
  },
  visibleOutputs: [
    'Quien primero: sangrado, HTA o dolor gineco-obstetrico no controlado',
    'No omitir: perdidas, TA y vigilancia materna',
    'Cuando reevaluar: este turno ante cambio del sangrado, TA o dolor agudo',
  ],
} as const satisfies SpecialtyOverlayRuntimePack & { id: 'gynObs' };
