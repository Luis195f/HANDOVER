import { MEDICATIONS_QUICKPICK_ICU } from '../../../lib/codes';
import type { UnitProfileId, UnitProfileRuntimePack } from '../../../types/profile';
import { HANDOVER_CORE_RUNTIME_PACK } from './core';

const SHARED_CORE_SECTIONS = HANDOVER_CORE_RUNTIME_PACK.enabledSections ?? [];

const createPack = (
  pack: UnitProfileRuntimePack & { id: UnitProfileId },
): UnitProfileRuntimePack & { id: UnitProfileId } => ({
  ...pack,
  enabledSections: Array.from(new Set([...(SHARED_CORE_SECTIONS ?? []), ...(pack.enabledSections ?? [])])),
});

export const UNIT_PROFILE_RUNTIME_PACKS: Readonly<Record<UnitProfileId, UnitProfileRuntimePack & { id: UnitProfileId }>> = {
  emergency: createPack({
    id: 'emergency',
    label: 'Urgencias y emergencias',
    enabledSections: ['oxigenoterapia', 'examenes'],
    requiredExtraFields: ['Motivo de reevaluacion', 'Ventana temporal critica'],
    optionalExtraFields: ['Observacion breve', 'Traslado o destino'],
    scales: ['EVA', 'Glasgow'],
    sentinelEvents: ['Deterioro en sala de espera', 'Compromiso ABCDE', 'Pendiente tiempo dependiente'],
    quickPicks: {
      treatments: [
        { id: 'ed-airway', type: 'respiratory', description: 'Vigilar via aerea y reevaluar saturacion' },
        { id: 'ed-sepsis', type: 'other', description: 'Completar bundle inicial de sepsis y controles seriados' },
        { id: 'ed-transfer', type: 'education', description: 'Preparar traslado con resumen verbal y pendientes criticos' },
      ],
    },
    visibleOutputs: ['Alertas contextuales', 'Pendientes criticos de reevaluacion'],
  }),
  'general-inpatient': createPack({
    id: 'general-inpatient',
    label: 'Hospitalizacion general',
    enabledSections: ['nutrition', 'elimination', 'mobilitySkin', 'psychosocial', 'examenes', 'outcomes'],
    requiredExtraFields: ['Dependencia funcional', 'Plan de alta o continuidad', 'Riesgo de caidas o UPP'],
    optionalExtraFields: ['Soporte familiar', 'Conciliacion terapeutica'],
    scales: ['EVA', 'Braden'],
    sentinelEvents: ['Caida', 'UPP', 'Error de continuidad', 'Deterioro insidioso'],
    quickPicks: {
      treatments: [
        { id: 'inpatient-turning', type: 'mobilization', description: 'Cambios posturales programados cada 2 horas' },
        { id: 'inpatient-education', type: 'education', description: 'Refuerzo de educacion para alta y autocuidado' },
        { id: 'inpatient-skin', type: 'woundCare', description: 'Vigilancia de piel y superficies de apoyo' },
      ],
    },
    visibleOutputs: ['Plan de continuidad', 'Resultados esperados visibles para enfermeria'],
  }),
  'critical-care': createPack({
    id: 'critical-care',
    label: 'UCI adulto',
    enabledSections: ['oxigenoterapia', 'fluidBalance', 'escalas', 'examenes'],
    requiredExtraFields: ['Soporte ventilatorio', 'Balance hidrico fino', 'Dispositivos invasivos'],
    optionalExtraFields: ['Perfusion y vasoactivos', 'Objetivos hemodinamicos'],
    scales: ['EVA', 'Glasgow', 'Braden'],
    sentinelEvents: ['Cambio neurologico nuevo', 'Desconexion de dispositivo', 'Escalada de soporte'],
    quickPicks: {
      medications: MEDICATIONS_QUICKPICK_ICU,
      treatments: [
        { id: 'icu-neuro', type: 'other', description: 'Reevaluacion neurologica horaria y tendencia de Glasgow' },
        { id: 'icu-resp', type: 'respiratory', description: 'Control de secreciones y objetivos de ventilacion' },
        { id: 'icu-lines', type: 'woundCare', description: 'Revision de fijacion y curacion de accesos invasivos' },
      ],
    },
    visibleOutputs: ['Resumen de microvigilancia', 'Eventos centinela del turno'],
  }),
  'pediatric-critical-care': createPack({
    id: 'pediatric-critical-care',
    label: 'UCI neonatal y pediatrica',
    enabledSections: ['oxigenoterapia', 'fluidBalance', 'escalas', 'psychosocial'],
    requiredExtraFields: ['Peso y edad', 'Soporte familiar', 'Seguridad de dosis'],
    optionalExtraFields: ['Termorregulacion', 'Soporte respiratorio pediatrico'],
    scales: ['EVA', 'Glasgow'],
    sentinelEvents: ['Desaturacion', 'Error de dosis', 'Cambio conductual o neurologico'],
    visibleOutputs: ['Riesgos ajustados por edad y peso'],
    notes: ['Escalas pediatricas proximamente.'],
  }),
  'specialized-critical-care': createPack({
    id: 'specialized-critical-care',
    label: 'UCI especializada',
    enabledSections: ['oxigenoterapia', 'fluidBalance', 'escalas', 'examenes'],
    requiredExtraFields: ['Soporte critico dominante', 'Eventos centinela de subunidad'],
    optionalExtraFields: ['Objetivos de perfusion o neuroproteccion'],
    scales: ['EVA', 'Glasgow', 'Braden'],
    sentinelEvents: ['Cambio neurologico', 'Descompensacion hemodinamica', 'Incidencia con soporte avanzado'],
    quickPicks: {
      medications: MEDICATIONS_QUICKPICK_ICU,
      treatments: [
        { id: 'spec-critical-monitoring', type: 'other', description: 'Vigilancia focal de soporte critico especifico' },
      ],
    },
    visibleOutputs: ['Resumen de soporte critico especifico'],
  }),
  'maternal-perinatal': createPack({
    id: 'maternal-perinatal',
    label: 'Materno-perinatal',
    enabledSections: ['psychosocial', 'outcomes'],
    requiredExtraFields: ['Continuidad materno fetal', 'Sangrado y dolor'],
    optionalExtraFields: ['Lactancia', 'Plan inmediato posparto'],
    scales: ['EVA'],
    sentinelEvents: ['Sangrado', 'Hipertension', 'Cambio de bienestar materno fetal'],
    quickPicks: {
      treatments: [
        { id: 'ob-bleeding', type: 'other', description: 'Vigilar sangrado y cuantificar perdidas' },
        { id: 'ob-bonding', type: 'education', description: 'Apoyo a lactancia y educacion inmediata' },
      ],
    },
    visibleOutputs: ['Continuidad materno perinatal'],
  }),
  perioperative: createPack({
    id: 'perioperative',
    label: 'Quirofano y recuperacion',
    enabledSections: ['oxigenoterapia', 'examenes', 'outcomes'],
    requiredExtraFields: ['Dolor', 'Sangrado', 'Drenajes y dispositivos'],
    optionalExtraFields: ['Plan de traslado o alta de recuperacion'],
    scales: ['EVA'],
    sentinelEvents: ['Compromiso de via aerea', 'Sangrado postoperatorio', 'Dolor mal controlado'],
    quickPicks: {
      treatments: [
        { id: 'peri-airway', type: 'respiratory', description: 'Vigilar via aerea y saturacion en recuperacion' },
        { id: 'peri-drain', type: 'woundCare', description: 'Control de drenajes, heridas y vendajes' },
      ],
    },
    visibleOutputs: ['Checklist de traslado seguro'],
  }),
  ambulatory: createPack({
    id: 'ambulatory',
    label: 'Consulta externa y ambulatoria',
    enabledSections: ['outcomes', 'adjuntos'],
    requiredExtraFields: ['Educacion clave', 'Adherencia esperada'],
    optionalExtraFields: ['Sintomas de alarma para casa'],
    scales: ['EVA'],
    sentinelEvents: ['Extravasacion', 'Omisiones al egreso', 'Falta de comprension del plan'],
    quickPicks: {
      treatments: [
        { id: 'amb-education', type: 'education', description: 'Educar signos de alarma y adherencia al tratamiento' },
      ],
    },
    visibleOutputs: ['Plan de autocuidado', 'Instrucciones de continuidad'],
    notes: ['Campos oncologicos adicionales proximamente.'],
  }),
  rehabilitation: createPack({
    id: 'rehabilitation',
    label: 'Rehabilitacion y terapias',
    enabledSections: ['mobilitySkin', 'psychosocial', 'outcomes'],
    requiredExtraFields: ['Meta funcional del turno', 'Tolerancia al esfuerzo'],
    optionalExtraFields: ['Seguridad de movilizacion'],
    scales: ['EVA', 'Braden'],
    sentinelEvents: ['Caida', 'Retroceso funcional brusco'],
    quickPicks: {
      treatments: [
        { id: 'rehab-mobility', type: 'mobilization', description: 'Plan de movilizacion segura y metas funcionales' },
      ],
    },
    visibleOutputs: ['Metas funcionales visibles'],
  }),
  'long-term-care': createPack({
    id: 'long-term-care',
    label: 'Residencias y larga estadia',
    enabledSections: ['nutrition', 'elimination', 'mobilitySkin', 'psychosocial', 'outcomes'],
    requiredExtraFields: ['Cambios respecto al basal', 'Piel y nutricion longitudinal'],
    optionalExtraFields: ['Soporte familiar o de cuidadores'],
    scales: ['EVA', 'Braden'],
    sentinelEvents: ['Cambio agudo respecto al basal', 'UPP', 'Riesgo de deshidratacion'],
    visibleOutputs: ['Resumen longitudinal de continuidad'],
  }),
  'behavioral-health': createPack({
    id: 'behavioral-health',
    label: 'Salud mental',
    enabledSections: ['psychosocial'],
    requiredExtraFields: ['Riesgo conductual', 'Plan de observacion'],
    optionalExtraFields: ['Alianza terapeutica', 'Factores desencadenantes'],
    scales: ['EVA'],
    sentinelEvents: ['Riesgo auto o heteroagresivo', 'Descompensacion conductual'],
    visibleOutputs: ['Plan de observacion y seguridad'],
  }),
  'home-care': createPack({
    id: 'home-care',
    label: 'Atencion domiciliaria',
    enabledSections: ['adjuntos', 'psychosocial', 'outcomes'],
    requiredExtraFields: ['Cuidador principal', 'Disponibilidad de insumos'],
    optionalExtraFields: ['Barreras del domicilio', 'Plan de contingencia'],
    scales: ['EVA', 'Braden'],
    sentinelEvents: ['Falta de soporte', 'Riesgo de rehospitalizacion'],
    visibleOutputs: ['Plan domiciliario y continuidad'],
  }),
};

export { HANDOVER_CORE_RUNTIME_PACK };
