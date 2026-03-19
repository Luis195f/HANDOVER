import type { SpecialtyOverlayRuntimePack } from '../../../types/profile';

export const CRITICAL_EMERGENCY_SPECIALTY_OVERLAY_RUNTIME_PACK = {
  id: 'criticalEmergency',
  label: 'Overlay critico de urgencias',
  enabledSections: ['oxigenoterapia', 'examenes'],
  hiddenSections: ['psychosocial', 'outcomes'],
  requiredExtraFields: ['ABCDE dominante', 'Ventana de reevaluacion inmediata', 'Destino critico probable'],
  optionalExtraFields: ['Soporte avanzado activo', 'Gatillo de escalado no delegable'],
  focusAreas: [
    'ABCDE, soporte avanzado y respuesta inmediata',
    'Reevaluacion corta y destino critico sin duplicar el UPP base',
  ],
  explanations: [
    'Se mantiene registry-only y pilot-off por prudencia para no duplicar logica ya propia de emergency/critical-care.',
    'Solo reduce ruido y refuerza reevaluacion inmediata cuando el equipo lo active de forma deliberada.',
  ],
  scales: ['Glasgow', 'NEWS2'],
  sentinelEvents: ['Compromiso ABCDE', 'Shock refractario', 'Perdida de via aerea', 'Traslado critico inmediato'],
  visibility: {
    'legacy-nursing-diagnosis-text': false,
  },
  quickPicks: {
    treatments: [
      { id: 'critical-emergency-abcde', type: 'other', description: 'Repasar ABCDE, soporte avanzado y respuesta clinica inmediata' },
      { id: 'critical-emergency-reeval', type: 'other', description: 'Dejar visible la siguiente reevaluacion no delegable y su ventana' },
      { id: 'critical-emergency-transfer', type: 'education', description: 'Preparar destino critico y aviso urgente con resumen operativo breve' },
    ],
  },
  visibleOutputs: [
    'Quien primero: compromiso ABCDE o necesidad de soporte avanzado inmediato',
    'No omitir: reevaluacion inmediata, perfusion y destino critico',
    'Cuando reevaluar: en minutos ante cambio del ABCDE o respuesta al soporte',
  ],
} as const satisfies SpecialtyOverlayRuntimePack & { id: 'criticalEmergency' };
