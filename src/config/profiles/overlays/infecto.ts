import type { SpecialtyOverlayRuntimePack } from '../../../types/profile';

export const INFECTO_SPECIALTY_OVERLAY_RUNTIME_PACK = {
  id: 'infecto',
  label: 'Overlay infectologico',
  enabledSections: ['examenes', 'alertas'],
  requiredExtraFields: ['Foco infeccioso sospechado', 'Aislamiento activo', 'Antimicrobiano en curso', 'Cultivos o pendientes', 'Dispositivo asociado'],
  optionalExtraFields: ['Control de foco en curso', 'Riesgo de transmision cruzada'],
  focusAreas: [
    'Foco infeccioso, sepsis y adherencia a aislamiento',
    'Cultivos, antimicrobianos y control de foco con continuidad segura',
  ],
  explanations: [
    'Refuerza prioridad por sepsis, aislamiento y control de foco dentro del formulario unico.',
    'Hace visible que no se debe omitir de cultivos, antibiotico y dispositivos asociados.',
  ],
  scales: ['NEWS2'],
  sentinelEvents: ['Sepsis', 'Deterioro infeccioso', 'Transmision cruzada', 'Fallo de control de foco'],
  quickPicks: {
    treatments: [
      { id: 'infecto-isolation', type: 'education', description: 'Confirmar aislamiento, EPP y medidas de transmision del turno' },
      { id: 'infecto-cultures', type: 'other', description: 'Dejar visibles cultivos pendientes y ultima toma relevante' },
      { id: 'infecto-antibiotic', type: 'other', description: 'Verificar antimicrobiano activo, hora critica y reevaluacion clinica' },
      { id: 'infecto-source-control', type: 'other', description: 'Confirmar control de foco, dispositivo asociado y necesidad de escalado' },
    ],
  },
  visibleOutputs: [
    'Quien primero: sepsis sospechada o aislamiento con alto riesgo de omision',
    'No omitir: cultivos, antibiotico y control de foco',
    'Cuando reevaluar: ante fiebre, hipotension o fallo del control de foco',
  ],
} as const satisfies SpecialtyOverlayRuntimePack & { id: 'infecto' };
