import type { SpecialtyOverlayRuntimePack } from '../../../types/profile';

export const CARDIO_SPECIALTY_OVERLAY_RUNTIME_PACK = {
  id: 'cardio',
  label: 'Overlay cardiovascular',
  enabledSections: ['fluidBalance', 'examenes'],
  requiredExtraFields: ['Dolor toracico activo', 'Ritmo o arritmia dominante', 'Perfusion/congestion', 'Anticoagulacion y diuresis/edema'],
  optionalExtraFields: ['ECG o hallazgo de perfusion disponible', 'Balance y respuesta a diureticos cuando aplique'],
  focusAreas: [
    'Dolor toracico, perfusion y congestion como foco del relevo',
    'Arritmias, anticoagulacion y diuresis con vigilancia de no omision',
  ],
  explanations: [
    'Refuerza perfusion, ritmo, anticoagulacion y diuresis sobre el mismo formulario sin abrir una UI propia.',
    'Mantiene visibles ECG, balance y reevaluacion clinica tiempo-dependiente durante el turno.',
  ],
  scales: ['NEWS2', 'EVA', 'Balance/perfusion local'],
  sentinelEvents: ['Sindrome coronario', 'Arritmia inestable', 'Edema agudo de pulmon', 'Shock cardiogenico', 'Sangrado por anticoagulacion'],
  quickPicks: {
    treatments: [
      { id: 'cardio-ecg-check', type: 'other', description: 'Verificar ECG, dolor toracico y cambio reciente del ritmo antes del cierre' },
      { id: 'cardio-perfusion-reeval', type: 'other', description: 'Reevaluar perfusion periferica, congestion y signos de hipoperfusion' },
      { id: 'cardio-balance', type: 'other', description: 'Cerrar diuresis, edema y respuesta a diureticos o balance negativo' },
      { id: 'cardio-anticoag', type: 'education', description: 'Confirmar anticoagulacion activa, sangrado y pendientes no delegables' },
    ],
  },
  visibleOutputs: [
    'Quien primero: perfusion comprometida, dolor isquemico o arritmia inestable',
    'No omitir: ECG, perfusion, diuresis y anticoagulacion',
    'Cuando reevaluar: este turno ante dolor toracico, edema o cambio del ritmo',
  ],
} as const satisfies SpecialtyOverlayRuntimePack & { id: 'cardio' };
