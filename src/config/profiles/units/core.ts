import { HANDOVER_CORE_PROFILE_ID, type HandoverSectionKey, type UnitProfileRuntimePack } from '../../../types/profile';

export const HANDOVER_CORE_RUNTIME_PACK: UnitProfileRuntimePack = {
  id: HANDOVER_CORE_PROFILE_ID,
  label: 'HANDOVER Core',
  enabledSections: [
    'turno',
    'paciente',
    'sbar',
    'signos',
    'oxigenoterapia',
    'dispositivos',
    'seguridad',
    'alertas',
    'escalas',
    'examenes',
    'medicacion',
    'diagnosticos',
    'evolucion',
    'resumen',
    'bedsideChecklist',
    'firmas',
  ],
  requiredExtraFields: ['Unidad y turno', 'Riesgos de seguridad', 'Diagnosticos activos'],
  optionalExtraFields: ['Dispositivos', 'Observaciones relevantes del turno'],
  scales: ['EVA'],
  sentinelEvents: ['Cambio clinico agudo', 'Riesgo de omision en pendientes'],
  visibility: {
    'legacy-sbar-narrative': true,
    'legacy-medication-text': true,
    'legacy-nursing-diagnosis-text': true,
    'nic-coding-hint': false,
    'handover-timing-hint': false,
    'noc-outcomes': false,
  },
  visibleOutputs: ['Resumen de turno', 'Pendientes priorizados', 'Checklist de cabecera'],
};

export const HANDOVER_CORE_FALLBACK_ONLY_SECTIONS = [
  'oxigenoterapia',
  'escalas',
  'examenes',
] as const satisfies readonly HandoverSectionKey[];

const HANDOVER_CORE_FALLBACK_ONLY_SECTION_SET = new Set<HandoverSectionKey>(HANDOVER_CORE_FALLBACK_ONLY_SECTIONS);

export const HANDOVER_SHARED_CORE_RUNTIME_PACK: UnitProfileRuntimePack = {
  ...HANDOVER_CORE_RUNTIME_PACK,
  enabledSections: (HANDOVER_CORE_RUNTIME_PACK.enabledSections ?? []).filter(
    (section): section is HandoverSectionKey => !HANDOVER_CORE_FALLBACK_ONLY_SECTION_SET.has(section as HandoverSectionKey),
  ),
};
