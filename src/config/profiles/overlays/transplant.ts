import type { SpecialtyOverlayRuntimePack } from '../../../types/profile';

export const TRANSPLANT_SPECIALTY_OVERLAY_RUNTIME_PACK = {
  id: 'transplant',
  label: 'Overlay trasplante',
  enabledSections: ['examenes', 'fluidBalance'],
  requiredExtraFields: ['Inmunosupresion activa', 'Signos de rechazo o infeccion', 'Acceso o drenajes', 'Adherencia/continuidad'],
  optionalExtraFields: ['Funcion del injerto cuando sea visible', 'Aislamiento o riesgo biologico dominante'],
  focusAreas: [
    'Inmunosupresion, rechazo e infeccion con vigilancia biologica compleja',
    'Acceso, adherencia y continuidad critica del injerto entre turnos',
  ],
  explanations: [
    'Queda completo en catalogo/runtime pero pilot-off para activarse solo con gobernanza clinica especifica.',
    'Refuerza injerto, infeccion y continuidad sin crear una experiencia distinta del formulario central.',
  ],
  scales: ['Balance', 'EVA'],
  sentinelEvents: ['Rechazo agudo', 'Sepsis', 'Sangrado', 'Fallo del injerto'],
  quickPicks: {
    treatments: [
      { id: 'transplant-immunosuppression', type: 'other', description: 'Confirmar inmunosupresion activa, ultimo cambio y riesgo de omision' },
      { id: 'transplant-graft-check', type: 'other', description: 'Dejar visible signos de rechazo o funcion del injerto cuando haya fuente' },
      { id: 'transplant-continuity', type: 'education', description: 'Alinear adherencia, vigilancia y coordinacion critica del siguiente turno' },
    ],
  },
  visibleOutputs: [
    'Quien primero: sospecha de rechazo, infeccion o fallo del injerto',
    'No omitir: inmunosupresion, acceso y continuidad critica',
    'Cuando reevaluar: ante fiebre, dolor del injerto o cambios de funcion',
  ],
} as const satisfies SpecialtyOverlayRuntimePack & { id: 'transplant' };
