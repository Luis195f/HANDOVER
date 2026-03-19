import type { SpecialtyOverlayRuntimePack } from '../../../types/profile';

export const OPHTHAL_ENT_SPECIALTY_OVERLAY_RUNTIME_PACK = {
  id: 'ophthalEnt',
  label: 'Overlay oftalmo-ORL',
  enabledSections: ['examenes', 'adjuntos'],
  requiredExtraFields: ['Dolor localizado', 'Sangrado o secrecion', 'Procedimiento o cura reciente'],
  optionalExtraFields: ['Via aerea superior cuando aplique', 'Educacion de alta especifica'],
  focusAreas: [
    'Dolor, sangrado y secrecion localizada',
    'Via aerea superior, curaciones y continuidad de cuidados al alta',
  ],
  explanations: [
    'Queda completo en catalogo/runtime pero pilot-off hasta validar su uso clinico por oleadas.',
    'Refuerza educacion de alta y complicaciones tempranas sin abrir formularios separados.',
  ],
  scales: ['EVA'],
  sentinelEvents: ['Sangrado localizado', 'Compromiso de via aerea alta', 'Dolor no controlado'],
  quickPicks: {
    treatments: [
      { id: 'ophthalent-bleeding', type: 'woundCare', description: 'Verificar sangrado, taponamiento o secrecion posprocedimiento' },
      { id: 'ophthalent-airway', type: 'respiratory', description: 'Confirmar permeabilidad de via aerea superior cuando corresponda' },
      { id: 'ophthalent-discharge', type: 'education', description: 'Repasar cuidados de alta, alarma y adherencia a indicaciones' },
    ],
  },
  visibleOutputs: [
    'Quien primero: sangrado, secrecion o compromiso ORL alto',
    'No omitir: dolor, sangrado y educacion de alta',
    'Cuando reevaluar: ante sangrado progresivo, edema o dolor refractario',
  ],
} as const satisfies SpecialtyOverlayRuntimePack & { id: 'ophthalEnt' };
