import type { SpecialtyOverlayRuntimePack } from '../../../types/profile';

export const NEFRO_URO_SPECIALTY_OVERLAY_RUNTIME_PACK = {
  id: 'nefroUro',
  label: 'Overlay nefro-uro',
  enabledSections: ['fluidBalance', 'elimination'],
  requiredExtraFields: ['Diuresis', 'Cateter o nefrostomia', 'Balance', 'Creatinina/electrolitos si visibles'],
  optionalExtraFields: ['Terapia renal sustitutiva cuando aplique', 'Riesgo de obstruccion o complicacion de acceso'],
  focusAreas: [
    'Diuresis, balance y obstruccion como foco clinico del turno',
    'Cateteres, accesos y terapia renal sustitutiva con trazabilidad explicable',
  ],
  explanations: [
    'Aumenta la prioridad por diuresis, balance, obstruccion y electrolitos sin crear una experiencia paralela.',
    'Hace visible acceso, cateter y necesidad de reevaluacion renal aguda durante el relevo.',
  ],
  scales: ['Balance y signos de sobrecarga'],
  sentinelEvents: ['Hiperpotasemia', 'Sobrecarga', 'Obstruccion', 'Deterioro renal agudo', 'Complicacion de acceso'],
  quickPicks: {
    treatments: [
      { id: 'nefro-balance', type: 'other', description: 'Cerrar balance, diuresis y signos de sobrecarga o deplecion' },
      { id: 'nefro-catheter', type: 'woundCare', description: 'Verificar cateter, nefrostomia o sonda y permeabilidad efectiva' },
      { id: 'nefro-electrolytes', type: 'other', description: 'Dejar visibles electrolitos criticos y ultima creatinina relevante' },
      { id: 'nefro-rst', type: 'other', description: 'Confirmar terapia renal sustitutiva, acceso y proxima ventana critica' },
    ],
  },
  visibleOutputs: [
    'Quien primero: diuresis comprometida, obstruccion o electrolitos de riesgo',
    'No omitir: balance, acceso y cateteres',
    'Cuando reevaluar: este turno ante oliguria, sobrecarga o cambio del acceso',
  ],
} as const satisfies SpecialtyOverlayRuntimePack & { id: 'nefroUro' };
