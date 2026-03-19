import type { SpecialtyOverlayRuntimePack } from '../../../types/profile';

export const ENDO_SPECIALTY_OVERLAY_RUNTIME_PACK = {
  id: 'endo',
  label: 'Overlay endocrino',
  enabledSections: ['nutrition', 'examenes'],
  requiredExtraFields: ['Glucemia', 'Insulina activa', 'Ingesta/tolerancia oral', 'Esteroides', 'Signos de descompensacion'],
  optionalExtraFields: ['Cetosis o cetonas cuando aplique', 'Bomba/CGM si existe'],
  focusAreas: [
    'Glucemia, insulinoterapia y seguridad metabolica',
    'Ingesta, esteroides y crisis endocrinas tiempo-dependientes',
  ],
  explanations: [
    'Prioriza descompensacion metabolica e interacciones entre glucemia, insulina e ingesta sin modificar el payload clinico.',
    'Hace visible que datos metabolicos no deben omitirse y cuando reevaluarlos durante el turno.',
  ],
  scales: ['Glucemia seriada', 'NEWS2'],
  sentinelEvents: ['Hipoglucemia', 'Hiperglucemia grave', 'DKA/HHS', 'Insuficiencia suprarrenal', 'Descompensacion tiroidea'],
  quickPicks: {
    treatments: [
      { id: 'endo-glucose', type: 'other', description: 'Actualizar glucemia, tendencia y siguiente control critico' },
      { id: 'endo-insulin', type: 'other', description: 'Confirmar insulina activa, pauta y ultimo ajuste relevante' },
      { id: 'endo-oral-intake', type: 'education', description: 'Relacionar ingesta/tolerancia oral con riesgo metabolico del turno' },
      { id: 'endo-steroids', type: 'other', description: 'Verificar esteroides y signos de crisis suprarrenal o tiroidea' },
    ],
  },
  visibleOutputs: [
    'Quien primero: paciente con descompensacion metabolica o alto riesgo de hipoglucemia',
    'No omitir: glucemia, insulina, ingesta y esteroides',
    'Cuando reevaluar: ante glucemia extrema, ayuno no previsto o signos de crisis endocrina',
  ],
} as const satisfies SpecialtyOverlayRuntimePack & { id: 'endo' };
