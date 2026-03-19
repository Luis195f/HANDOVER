import type { SpecialtyOverlayRuntimePack } from '../../../types/profile';

export const TRAUMA_SPECIALTY_OVERLAY_RUNTIME_PACK = {
  id: 'trauma',
  label: 'Overlay trauma',
  enabledSections: ['mobilitySkin', 'examenes'],
  requiredExtraFields: ['Mecanismo lesional', 'Sangrado activo o sospecha', 'Inmovilizacion', 'Dolor y control neurovascular distal'],
  optionalExtraFields: ['Heridas, drenajes o fijadores', 'Riesgo de hemorragia oculta o compartimental'],
  focusAreas: [
    'Mecanismo, sangrado y dolor con reevaluacion estructurada',
    'Inmovilizacion, perfusion distal y seguridad neurovascular durante el relevo',
  ],
  explanations: [
    'Aumenta el foco en sangrado, inmovilizacion y perfusion distal sin abrir un formulario paralelo.',
    'Hace visible que trauma vigilar primero y que reevaluaciones no pueden diferirse.',
  ],
  scales: ['EVA', 'Glasgow cuando aplique'],
  sentinelEvents: ['Hemorragia oculta', 'Sindrome compartimental', 'Deterioro ABCDE', 'Dolor no controlado'],
  quickPicks: {
    treatments: [
      { id: 'trauma-bleeding', type: 'woundCare', description: 'Revisar sangrado activo, curaciones y necesidad de cuantificar perdidas' },
      { id: 'trauma-neurovascular', type: 'other', description: 'Confirmar pulso, perfusion distal y sensibilidad/motricidad distal' },
      { id: 'trauma-immobilization', type: 'mobilization', description: 'Validar inmovilizacion, fijacion y traslado seguro sin perder alineacion' },
      { id: 'trauma-pain', type: 'other', description: 'Reevaluar dolor, analgesia efectiva y gatillos de escalado' },
    ],
  },
  visibleOutputs: [
    'Quien primero: trauma con sangrado, dolor refractario o deterioro ABCDE',
    'No omitir: perfusion distal, sangrado, inmovilizacion y dolor',
    'Cuando reevaluar: este turno ante cambio neurovascular, edema o analgesia inefectiva',
  ],
} as const satisfies SpecialtyOverlayRuntimePack & { id: 'trauma' };
