import type { RiskType } from '../types/handover';

export const RISK_ACTIONS_BY_TYPE: Record<
  RiskType,
  { id: string; label: string }[]
> = {
  fall: [
    { id: 'bedRailsUp', label: 'Barandillas elevadas' },
    { id: 'bedLowPosition', label: 'Cama en posición baja' },
    { id: 'callButtonWithinReach', label: 'Timbre al alcance' },
  ],
  pressureUlcer: [
    { id: 'pressureReliefSurface', label: 'Superficie de alivio de presión' },
    { id: 'scheduledReposition', label: 'Recolocación programada' },
  ],
  isolation: [
    { id: 'ppeInUse', label: 'EPP adecuado' },
    { id: 'isolationSignage', label: 'Señalización de aislamiento' },
  ],
  seizure: [
    { id: 'seizurePrecautions', label: 'Precauciones ante convulsiones' },
  ],
  suicide: [
    { id: 'suicidePrecautions', label: 'Precauciones riesgo suicida' },
  ],
  deviceDisconnection: [
    { id: 'secureLines', label: 'Líneas y catéteres asegurados' },
  ],
  infection: [
    { id: 'infectionControl', label: 'Medidas de control de infecciones' },
  ],
  other: [],
};

export const FALL_BASIC_ACTIONS = ['bedRailsUp', 'bedLowPosition', 'callButtonWithinReach'] as const;
export const PRESSURE_ULCER_PREVENTION_ACTIONS = ['pressureReliefSurface', 'scheduledReposition'] as const;
