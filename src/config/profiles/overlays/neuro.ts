import type { SpecialtyOverlayRuntimePack } from '../../../types/profile';

export const NEURO_SPECIALTY_OVERLAY_RUNTIME_PACK = {
  id: 'neuro',
  label: 'Overlay neurologico',
  enabledSections: ['escalas', 'examenes'],
  requiredExtraFields: ['Glasgow o estado mental', 'Deficit focal y pupilas', 'Convulsion o crisis reciente', 'Via oral/deglucion'],
  optionalExtraFields: ['AVPU cuando aplique', 'Neurovigilancia o ventana de reevaluacion'],
  focusAreas: [
    'Nivel de conciencia, deficit focal y cambios neurologicos sutiles',
    'Convulsion, pupilas y seguridad deglutoria sin perder trazabilidad del turno',
  ],
  explanations: [
    'Prioriza neurodeterioro, pupilas y via oral/deglucion sobre el mismo stack Core + UPP.',
    'Hace visible cuando reevaluar y que datos neurologicos no pueden omitirse en el relevo.',
  ],
  scales: ['Glasgow', 'AVPU', 'EVA'],
  sentinelEvents: ['Deterioro neurologico', 'Crisis convulsiva', 'Broncoaspiracion', 'Hipertension intracraneal sospechada'],
  quickPicks: {
    treatments: [
      { id: 'neuro-glasgow', type: 'other', description: 'Actualizar Glasgow/AVPU y documentar cambio neurologico no basal' },
      { id: 'neuro-pupils', type: 'other', description: 'Revisar pupilas, deficit focal y signos de alarma neurologa' },
      { id: 'neuro-swallow', type: 'education', description: 'Confirmar seguridad de deglucion y via oral antes de administrar por boca' },
      { id: 'neuro-seizure', type: 'other', description: 'Dejar visible ultima crisis, tratamiento y gatillo de reevaluacion' },
    ],
  },
  visibleOutputs: [
    'Quien primero: paciente con neurodeterioro o crisis reciente',
    'No omitir: Glasgow, pupilas, deglucion y convulsiones',
    'Cuando reevaluar: ante cambio del estado mental, pupilas o seguridad de via oral',
  ],
} as const satisfies SpecialtyOverlayRuntimePack & { id: 'neuro' };
