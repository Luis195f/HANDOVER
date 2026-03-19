import type { SpecialtyOverlayRuntimePack } from '../../../types/profile';

export const PLASTICS_BURNS_SPECIALTY_OVERLAY_RUNTIME_PACK = {
  id: 'plasticsBurns',
  label: 'Overlay plastica/quemados',
  enabledSections: ['fluidBalance', 'mobilitySkin'],
  requiredExtraFields: ['Quemaduras o cobertura cutanea', 'Dolor', 'Curas complejas', 'Balance'],
  optionalExtraFields: ['Riesgo infeccioso dominante', 'Injertos o curaciones especiales'],
  focusAreas: [
    'Quemaduras, balance y dolor con vigilancia de curas complejas',
    'Cobertura cutanea, injertos y riesgo infeccioso con trazabilidad explicable',
  ],
  explanations: [
    'Se registra completo pero pilot-off, evitando activar por defecto un overlay de alta complejidad curativa.',
    'Puede coexistir con el contexto trauma cuando la base UPP siga siendo compatible y explicable.',
  ],
  scales: ['EVA', 'Balance'],
  sentinelEvents: ['Sepsis', 'Dolor extremo', 'Perdida de injerto', 'Desequilibrio hidrico'],
  quickPicks: {
    treatments: [
      { id: 'plasticsburns-balance', type: 'other', description: 'Cerrar balance, perdidas y respuesta hemodinamica del turno' },
      { id: 'plasticsburns-dressing', type: 'woundCare', description: 'Revisar curaciones, cobertura cutanea e injertos sin omitir dolor asociado' },
      { id: 'plasticsburns-infection', type: 'other', description: 'Dejar visible riesgo infeccioso y necesidad de reevaluacion precoz' },
    ],
  },
  visibleOutputs: [
    'Quien primero: quemado con dolor extremo, sepsis o desequilibrio hidrico',
    'No omitir: curas complejas, balance y riesgo infeccioso',
    'Cuando reevaluar: ante dolor refractario, exudado o inestabilidad de fluidos',
  ],
} as const satisfies SpecialtyOverlayRuntimePack & { id: 'plasticsBurns' };
