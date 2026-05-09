import type { BedsideChecklistItem } from '../../../config/bedsideChecklist';
import { MEDICATIONS_QUICKPICK_ICU } from '../../../lib/codes';
import type { UnitProfileId, UnitProfileRuntimePack } from '../../../types/profile';
import { HANDOVER_SHARED_CORE_RUNTIME_PACK } from './core';

const SHARED_CORE_SECTIONS = HANDOVER_SHARED_CORE_RUNTIME_PACK.enabledSections ?? [];

const createPack = (
  pack: UnitProfileRuntimePack & { id: UnitProfileId },
): UnitProfileRuntimePack & { id: UnitProfileId } => ({
  ...pack,
  enabledSections: Array.from(new Set([...(SHARED_CORE_SECTIONS ?? []), ...(pack.enabledSections ?? [])])),
});

export const UNIT_PROFILE_CHECKLIST_ITEMS: Partial<
  Record<UnitProfileId, readonly BedsideChecklistItem[]>
> = {
  emergency: [
    {
      key: 'patientIdentityConfirmed',
      label: 'Paciente, triage y motivo sindromico confirmados',
      helper: 'Incluye hora de llegada o ultima reevaluacion documentada.',
    },
    {
      key: 'allergiesReviewed',
      label: 'Alergias, aislamiento y alertas inmediatas revisadas',
      helper: 'Confirma precauciones y riesgos de transmision antes del relevo.',
    },
    {
      key: 'linesAndDevicesChecked',
      label: 'Via aerea, accesos y dispositivos iniciales verificados',
      helper: 'Comprueba permeabilidad, fijacion y soporte activo al cierre del turno.',
    },
    {
      key: 'medicationPlanReviewed',
      label: 'Tratamiento inicial y reevaluacion obligatoria revisados',
      helper: 'Haz visible lo ya administrado y lo que no puede omitirse en la siguiente ventana.',
    },
    {
      key: 'safetyMeasuresApplied',
      label: 'Medidas de aislamiento y seguridad de flujo aplicadas',
      helper: 'Prioriza contencion del riesgo, boxes seguros y alertas para sala de espera.',
    },
    {
      key: 'questionsAnswered',
      label: 'Preguntas del equipo entrante resueltas',
      helper: 'Aclara dudas críticas del relevo, incluyendo destino probable y gatillos de reevaluación.',
    },
  ],
  'general-inpatient': [
    {
      key: 'patientIdentityConfirmed',
      label: 'Paciente, basal funcional y referente identificados',
      helper: 'Incluye fragilidad, dependencia y quien sostiene la continuidad del cuidado.',
    },
    {
      key: 'allergiesReviewed',
      label: 'Alergias, conciliacion terapeutica y omisiones revisadas',
      helper: 'Contrasta medicacion basal, cambios del ingreso y riesgos de olvido.',
    },
    {
      key: 'linesAndDevicesChecked',
      label: 'Accesos, ayudas tecnicas y dispositivos verificados',
      helper: 'Asegura continuidad de sondas, vias y apoyos de movilizacion.',
    },
    {
      key: 'medicationPlanReviewed',
      label: 'Plan terapeutico, deprescripcion y pendientes revisados',
      helper: 'Visibiliza conciliacion, medicacion critica y horarios no delegables.',
    },
    {
      key: 'safetyMeasuresApplied',
      label: 'Prevencion de caidas, delirium y UPP aplicada',
      helper: 'Confirma medidas de orientacion, movilizacion y proteccion cutanea.',
    },
    {
      key: 'questionsAnswered',
      label: 'Preguntas del equipo entrante resueltas',
      helper: 'Aclara dudas del relevo sobre continuidad, educación pendiente y coordinaciones externas.',
    },
  ],
  'critical-care': [
    {
      key: 'patientIdentityConfirmed',
      label: 'Paciente, cama y objetivos criticos confirmados',
      helper: 'Verifica metas ventilatorias, hemodinamicas o neurologicas vigentes.',
    },
    {
      key: 'allergiesReviewed',
      label: 'Alergias, sedacion, analgesia y bombas revisadas',
      helper: 'Confirma infusiones activas, compatibilidad y objetivos de sedacion.',
    },
    {
      key: 'linesAndDevicesChecked',
      label: 'VM, accesos invasivos y fijaciones verificados',
      helper: 'Incluye via aerea artificial, cateteres, drenajes y alarmas activas.',
    },
    {
      key: 'medicationPlanReviewed',
      label: 'Vasoactivos, sedacion y titulaciones validadas',
      helper: 'Deja explicitos objetivos, limites y ultimo ajuste relevante.',
    },
    {
      key: 'safetyMeasuresApplied',
      label: 'Paquete de vigilancia critica aplicado',
      helper: 'Comprueba delirium, ulceras, prevencion de extubacion y eventos de alto dano.',
    },
    {
      key: 'questionsAnswered',
      label: 'Preguntas del equipo entrante resueltas',
      helper: 'Aclara dudas del relevo sobre microvigilancia, avisos y la siguiente reevaluación no delegable.',
    },
  ],
  'behavioral-health': [
    {
      key: 'patientIdentityConfirmed',
      label: 'Paciente, ubicacion funcional y referente del turno confirmados',
      helper: 'Prioriza censo, cama/planta o identificador del centro sin depender del QR.',
    },
    {
      key: 'allergiesReviewed',
      label: 'Observacion especial, riesgo de caidas y fuga/no retorno revisados',
      helper: 'Aclara cambio respecto al basal, necesidad de acompanamiento y siguiente reevaluacion prioritaria.',
    },
    {
      key: 'linesAndDevicesChecked',
      label: 'Entorno seguro, elementos retirables y tratamientos o dispositivos verificados',
      helper: 'Deja visible lo que requiere resguardo o puede retirarse, con estado y trazabilidad para el relevo.',
    },
    {
      key: 'medicationPlanReviewed',
      label: 'Adherencia, medicacion pendiente y tratamientos no omitibles revisados',
      helper: 'Haz visible rechazo terapeutico, ventanas horarias y necesidad de seguimiento del siguiente turno.',
    },
    {
      key: 'safetyMeasuresApplied',
      label: 'Continuidad, reevaluacion y evento de contencion trazables',
      helper:
        'Si existe una medida excepcional, registra solo autorizacion, revision, vigencia y proxima reevaluacion dentro del marco asistencial vigente.',
    },
    {
      key: 'questionsAnswered',
      label: 'Preguntas del equipo entrante resueltas',
      helper: 'Aclara gatillos de reevaluacion, avisos al equipo y coordinaciones pendientes del turno siguiente.',
    },
  ],
};

export const UNIT_PROFILE_RUNTIME_PACKS: Readonly<Record<UnitProfileId, UnitProfileRuntimePack & { id: UnitProfileId }>> = {
  emergency: createPack({
    id: 'emergency',
    label: 'Urgencias y emergencias',
    enabledSections: ['oxigenoterapia', 'examenes'],
    requiredExtraFields: ['Motivo sindromico', 'Hora de llegada o ultima reevaluacion', 'Destino probable'],
    optionalExtraFields: ['Aislamiento activo', 'Hallazgo gatillo para reevaluacion'],
    focusAreas: ['Triage, motivo sindromico y ventana desde la llegada', 'Reevaluacion obligatoria, aislamiento y destino probable'],
    explanations: ['Prioriza triage, hora de llegada, reevaluacion y destino sin abrir un formulario paralelo.'],
    scales: ['EVA', 'Glasgow', 'ESI / Manchester'],
    sentinelEvents: ['Deterioro en sala de espera', 'Compromiso ABCDE', 'Reevaluacion omitida', 'Cambio brusco de destino'],
    quickPicks: {
      treatments: [
        { id: 'ed-triage-reeval', type: 'other', description: 'Documentar triage, hora de llegada y proxima reevaluacion obligatoria' },
        { id: 'ed-airway', type: 'respiratory', description: 'Vigilar via aerea y reevaluar saturacion' },
        { id: 'ed-isolation', type: 'other', description: 'Confirmar aislamiento, muestras y medidas de transmision cruzada' },
        { id: 'ed-transfer', type: 'education', description: 'Preparar traslado con resumen verbal, destino probable y pendientes criticos' },
      ],
    },
    visibleOutputs: ['Alertas contextuales', 'Pendientes criticos de reevaluacion', 'Destino probable explicitado'],
  }),
  'general-inpatient': createPack({
    id: 'general-inpatient',
    label: 'Hospitalizacion general',
    enabledSections: ['nutrition', 'elimination', 'mobilitySkin', 'psychosocial', 'escalas', 'examenes', 'outcomes'],
    requiredExtraFields: ['Dependencia funcional y fragilidad', 'Conciliacion terapeutica', 'Plan de alta o continuidad'],
    optionalExtraFields: ['Riesgo de delirium u omision', 'Soporte familiar y barreras para el egreso'],
    focusAreas: ['Fragilidad, dependencia y delirium', 'Conciliacion terapeutica, omisiones y alta compleja'],
    explanations: ['Hace visible continuidad clinica, conciliacion y riesgo de omision sin duplicar el Core.'],
    scales: ['EVA', 'Braden', 'Barthel / Katz', 'CAM'],
    sentinelEvents: ['Caida', 'UPP', 'Error de continuidad', 'Delirium no detectado', 'Alta compleja sin cierre'],
    quickPicks: {
      treatments: [
        { id: 'inpatient-fragility', type: 'mobilization', description: 'Revisar dependencia funcional, ayuda tecnica y tolerancia a la movilizacion' },
        { id: 'inpatient-reconciliation', type: 'education', description: 'Conciliar medicacion basal, cambios del ingreso y pendientes de administracion' },
        { id: 'inpatient-delirium', type: 'other', description: 'Refuerzo de orientacion, sueno y prevencion de delirium durante el turno' },
        { id: 'inpatient-skin', type: 'woundCare', description: 'Vigilancia de piel, cambios posturales y superficies de apoyo' },
        { id: 'inpatient-discharge', type: 'education', description: 'Alinear alta compleja, educacion y coordinacion con familia o red externa' },
      ],
    },
    visibleOutputs: ['Plan de continuidad', 'Resultados esperados visibles para enfermeria', 'Riesgos de omision y alta compleja'],
  }),
  'critical-care': createPack({
    id: 'critical-care',
    label: 'UCI adulto',
    enabledSections: ['oxigenoterapia', 'fluidBalance', 'escalas', 'examenes'],
    requiredExtraFields: ['Soporte ventilatorio y objetivos', 'Sedacion o ventana neurologica', 'Balance hidrico fino y dispositivos invasivos'],
    optionalExtraFields: ['Vasoactivos y objetivos hemodinamicos', 'Eventos de vigilancia critica anticipados'],
    focusAreas: ['Ventilacion, sedacion y perfusion minuto a minuto', 'Balance hidrico, dispositivos invasivos y vigilancia critica'],
    explanations: ['Prioriza soporte ventilatorio, sedacion, vasoactivos y checklist de vigilancia critica dentro del formulario unico.'],
    scales: ['EVA', 'Glasgow', 'RASS / SAS', 'Braden'],
    sentinelEvents: ['Cambio neurologico nuevo', 'Desconexion de dispositivo', 'Escalada de soporte', 'Balance hidrico fuera de objetivo'],
    quickPicks: {
      medications: MEDICATIONS_QUICKPICK_ICU,
      treatments: [
        { id: 'icu-ventilation', type: 'respiratory', description: 'Revisar modo ventilatorio, secreciones y objetivo de saturacion/FiO2' },
        { id: 'icu-sedation', type: 'other', description: 'Validar sedacion, analgesia y ventana neurologica segura del turno' },
        { id: 'icu-vasoactive', type: 'other', description: 'Confirmar vasoactivos, perfusion y metas hemodinamicas activas' },
        { id: 'icu-balance', type: 'other', description: 'Cerrar balance hidrico fino y diuresis con siguiente corte horario' },
        { id: 'icu-lines', type: 'woundCare', description: 'Revision de fijacion, curacion y alarmas de accesos invasivos' },
      ],
    },
    visibleOutputs: ['Resumen de microvigilancia', 'Eventos centinela del turno', 'Checklist de vigilancia critica'],
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
    notes: ['Escalas pediátricas próximamente.'],
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
    notes: ['Campos oncológicos adicionales próximamente.'],
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
    enabledSections: ['psychosocial', 'nutrition', 'examenes'],
    requiredExtraFields: [
      'Estado basal y cambio observado',
      'Observacion especial, acompanamiento o nivel de supervision requerido',
      'Riesgo de caidas, movilidad segura y necesidad de deambulacion supervisada cuando aplique',
      'Riesgo de fuga o no retorno',
      'Entorno seguro y elementos que deban resguardarse',
      'Adherencia o rechazo terapeutico',
      'Coordinacion interna pendiente y reevaluacion del siguiente turno',
    ],
    optionalExtraFields: [
      'Sueno e ingesta/hidratacion',
      'Continencia, piel o ayudas funcionales cuando condicionen la continuidad del turno',
      'Responsable o referente de comunicacion interna y relacion terapeutica relevante',
      'Coordinacion con familia, tutor o cuidadores cuando aplique',
      'Deterioro funcional o cognitivo-conductual cuando aplique',
      'Dispositivos o tratamientos que el paciente pueda retirarse',
      'Evento de contencion trazable: autorizacion, revision, vigencia y reevaluacion',
    ],
    focusAreas: [
      'Observacion especial, entorno seguro y seguridad relacional',
      'Caidas, fuga/no retorno, movilidad segura y elementos retirables que requieren continuidad',
      'Cambio respecto al basal, adherencia terapeutica y riesgo de omision del turno siguiente',
      'Ingesta, hidratacion, sueno, supervision funcional y coordinacion interna pendiente',
    ],
    explanations: [
      'Refuerza salud mental con secciones y copy del runtime ya existentes, sin abrir un formulario paralelo ni convertir QR en flujo principal.',
      'Mantiene un unico nucleo behavioral-health y deja las variaciones por subunidad limitadas a checklist contextual y copy prudente.',
      'MPAC para salud mental se proyecta aqui como prioridades explicables de continuidad y seguridad; no sustituye juicio clinico ni activa scoring autonomo.',
      'No presenta ranking individual ni validacion clinica; ordena de forma prudente lo que el relevo no debe omitir.',
    ],
    scales: ['EVA', 'Observacion conductual estructurada cuando aplique'],
    sentinelEvents: [
      'Caida',
      'Descompensacion conductual',
      'Fuga o no retorno',
      'Retiro no planificado de dispositivo o tratamiento',
      'Rechazo terapeutico con riesgo de omision',
      'Cambio relevante respecto al basal',
    ],
    quickPicks: {
      treatments: [
        {
          id: 'psych-observation',
          type: 'other',
          description: 'Actualizar observacion especial, acompanamiento, riesgo de caidas y siguiente reevaluacion del turno',
        },
        {
          id: 'psych-adherence',
          type: 'education',
          description: 'Cerrar adherencia o rechazo terapeutico y pendientes de medicacion o tratamiento no omitibles',
        },
        {
          id: 'psych-safe-environment',
          type: 'other',
          description: 'Verificar entorno seguro, riesgo de fuga/no retorno y elementos, dispositivos o tratamientos retirables',
        },
        {
          id: 'psych-intake-sleep',
          type: 'other',
          description: 'Registrar sueno, ingesta, hidratacion y continencia o piel cuando condicionen la continuidad',
        },
        {
          id: 'psych-restraint-trace',
          type: 'other',
          description: 'Registrar evento de contencion solo con autorizacion, vigencia, revision y siguiente reevaluacion',
        },
        {
          id: 'psych-continuity',
          type: 'other',
          description: 'Resumir basal funcional, supervision requerida, coordinacion interna y avisos para el siguiente relevo',
        },
      ],
    },
    visibleOutputs: [
      'Continuidad del relevo explicitada para el siguiente turno',
      'Riesgo de omision en medicacion, tratamiento, vigilancia o coordinacion visible',
      'Cambio respecto al basal resumido sin etiquetas estigmatizantes',
      'Necesidad de reevaluacion y siguiente ventana del turno visibles',
      'Coordinacion interna pendiente y referente del relevo explicitados',
      'Seguridad del entorno y resguardo de elementos retirables visibles',
      'Adherencia o rechazo terapeutico con continuidad del plan',
      'Fuga o no retorno y supervision requerida visibles',
      'Caidas o movilidad supervisada explicitadas cuando apliquen',
      'Dispositivos o tratamientos retirables con trazabilidad para el relevo',
      'Observacion especial o acompanamiento explicitados',
      'Evento de contencion trazable sin instrucciones operativas',
    ],
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

export {
  HANDOVER_CORE_FALLBACK_ONLY_SECTIONS,
  HANDOVER_CORE_RUNTIME_PACK,
  HANDOVER_SHARED_CORE_RUNTIME_PACK,
} from './core';
