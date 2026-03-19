import type { SpecialtyOverlayId, SpecialtyOverlayRuntimePack } from '../../../types/profile';
import { CARDIO_SPECIALTY_OVERLAY_RUNTIME_PACK } from './cardio';
import { CRITICAL_EMERGENCY_SPECIALTY_OVERLAY_RUNTIME_PACK } from './criticalEmergency';
import { ENDO_SPECIALTY_OVERLAY_RUNTIME_PACK } from './endo';
import { GASTRO_HEPATO_SPECIALTY_OVERLAY_RUNTIME_PACK } from './gastroHepato';
import { GYN_OBS_SPECIALTY_OVERLAY_RUNTIME_PACK } from './gynObs';
import { INFECTO_SPECIALTY_OVERLAY_RUNTIME_PACK } from './infecto';
import { NEFRO_URO_SPECIALTY_OVERLAY_RUNTIME_PACK } from './nefroUro';
import { NEUMO_SPECIALTY_OVERLAY_RUNTIME_PACK } from './neumo';
import { NEURO_SPECIALTY_OVERLAY_RUNTIME_PACK } from './neuro';
import { ONCOLOGY_HEMATOLOGY_OVERLAY_RUNTIME_PACK } from './oncologyHematology';
import { OPHTHAL_ENT_SPECIALTY_OVERLAY_RUNTIME_PACK } from './ophthalEnt';
import { PEDS_SUBSPECIALTIES_SPECIALTY_OVERLAY_RUNTIME_PACK } from './pedsSubspecialties';
import { PLASTICS_BURNS_SPECIALTY_OVERLAY_RUNTIME_PACK } from './plasticsBurns';
import { TRAUMA_SPECIALTY_OVERLAY_RUNTIME_PACK } from './trauma';
import { TRANSPLANT_SPECIALTY_OVERLAY_RUNTIME_PACK } from './transplant';

const createPack = <T extends SpecialtyOverlayRuntimePack & { id: SpecialtyOverlayId }>(pack: T): T => pack;

export const SPECIALTY_OVERLAY_RUNTIME_PACKS: Readonly<
  Record<SpecialtyOverlayId, SpecialtyOverlayRuntimePack & { id: SpecialtyOverlayId }>
> = {
  cardio: createPack(CARDIO_SPECIALTY_OVERLAY_RUNTIME_PACK),
  neuro: createPack(NEURO_SPECIALTY_OVERLAY_RUNTIME_PACK),
  onc: createPack(ONCOLOGY_HEMATOLOGY_OVERLAY_RUNTIME_PACK),
  trauma: createPack(TRAUMA_SPECIALTY_OVERLAY_RUNTIME_PACK),
  infecto: createPack(INFECTO_SPECIALTY_OVERLAY_RUNTIME_PACK),
  neumo: createPack(NEUMO_SPECIALTY_OVERLAY_RUNTIME_PACK),
  nefroUro: createPack(NEFRO_URO_SPECIALTY_OVERLAY_RUNTIME_PACK),
  gastroHepato: createPack(GASTRO_HEPATO_SPECIALTY_OVERLAY_RUNTIME_PACK),
  endo: createPack(ENDO_SPECIALTY_OVERLAY_RUNTIME_PACK),
  gynObs: createPack(GYN_OBS_SPECIALTY_OVERLAY_RUNTIME_PACK),
  pedsSubspecialties: createPack(PEDS_SUBSPECIALTIES_SPECIALTY_OVERLAY_RUNTIME_PACK),
  ophthalEnt: createPack(OPHTHAL_ENT_SPECIALTY_OVERLAY_RUNTIME_PACK),
  plasticsBurns: createPack(PLASTICS_BURNS_SPECIALTY_OVERLAY_RUNTIME_PACK),
  criticalEmergency: createPack(CRITICAL_EMERGENCY_SPECIALTY_OVERLAY_RUNTIME_PACK),
  transplant: createPack(TRANSPLANT_SPECIALTY_OVERLAY_RUNTIME_PACK),
};
