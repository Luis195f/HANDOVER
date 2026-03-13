import type {
  ProfileCatalogReadiness,
  SpecialtyOverlayId,
  UnitProfileId,
} from '../types/profile';

export interface UnitProfileCatalogEntry {
  id: UnitProfileId;
  label: string;
  aliases: readonly string[];
  baseUnitType: string;
  clinicalFocus: string;
  readiness: ProfileCatalogReadiness;
}

export interface SpecialtyOverlayCatalogEntry {
  id: SpecialtyOverlayId;
  label: string;
  aliases: readonly string[];
  clinicalFocus: string;
  allowedUnitProfiles: readonly UnitProfileId[];
  readiness: ProfileCatalogReadiness;
}

export const UNIT_PROFILE_CATALOG: readonly UnitProfileCatalogEntry[] = [
  {
    id: 'emergency',
    label: 'Urgencias y emergencias',
    aliases: ['urgencias', 'emergencias', 'triage', 'boxes', 'observacion', 'resucitacion'],
    baseUnitType: 'emergency',
    clinicalFocus: 'Triage, reevaluacion obligatoria, ventanas cortas de deterioro y gestion de flujo saturado.',
    readiness: 'wave-1',
  },
  {
    id: 'general-inpatient',
    label: 'Hospitalizacion general',
    aliases: ['hospitalizacion', 'medicina-interna', 'planta-medica', 'planta-quirurgica'],
    baseUnitType: 'inpatient',
    clinicalFocus: 'Continuidad de cuidados, dependencia, conciliacion, plan de alta y riesgo de omision en planta.',
    readiness: 'wave-1',
  },
  {
    id: 'critical-care',
    label: 'UCI adulto',
    aliases: ['uci-adulto', 'adult-icu', 'cuidados-criticos-adulto'],
    baseUnitType: 'critical-care',
    clinicalFocus: 'Inestabilidad minuto a minuto, ventilacion, perfusion, drogas vasoactivas y microvigilancia.',
    readiness: 'wave-1',
  },
  {
    id: 'pediatric-critical-care',
    label: 'UCI neonatal y pediatrica',
    aliases: ['ucin', 'ucip', 'uci-neonatal', 'uci-pediatrica', 'neonatal-pediatric-icu'],
    baseUnitType: 'pediatric-critical-care',
    clinicalFocus: 'Variabilidad fisiologica por edad/peso, termorregulacion, soporte respiratorio y rol familiar.',
    readiness: 'scaffold',
  },
  {
    id: 'specialized-critical-care',
    label: 'UCI especializada',
    aliases: ['uci-especializada', 'neuro-uci', 'cardio-uci', 'burn-icu', 'specialized-icu'],
    baseUnitType: 'specialized-critical-care',
    clinicalFocus: 'Vigilancia altamente especifica segun soporte o dano organico predominante.',
    readiness: 'wave-1',
  },
  {
    id: 'maternal-perinatal',
    label: 'Materno-perinatal',
    aliases: ['obstetricia', 'alto-riesgo-obstetrico', 'puerperio', 'binomio-madre-hijo'],
    baseUnitType: 'maternal-perinatal',
    clinicalFocus: 'Binomio madre-hijo, sangrado, hipertension, lactancia y adaptacion neonatal.',
    readiness: 'wave-1',
  },
  {
    id: 'perioperative',
    label: 'Quirofano y recuperacion',
    aliases: ['quirofano', 'urpa', 'recuperacion', 'perioperatorio'],
    baseUnitType: 'perioperative',
    clinicalFocus: 'Seguridad perioperatoria, dolor, sangrado, drenajes y criterios de alta o traslado.',
    readiness: 'wave-1',
  },
  {
    id: 'ambulatory',
    label: 'Consulta externa y ambulatoria',
    aliases: ['consulta-externa', 'ambulatorio', 'hospital-de-dia', 'seguimiento-cronico'],
    baseUnitType: 'ambulatory',
    clinicalFocus: 'Adherencia, educacion, seguridad del tratamiento y continuidad longitudinal.',
    readiness: 'wave-1',
  },
  {
    id: 'rehabilitation',
    label: 'Rehabilitacion y terapias',
    aliases: ['rehabilitacion', 'terapias', 'kinesioterapia', 'terapia-ocupacional'],
    baseUnitType: 'rehabilitation',
    clinicalFocus: 'Evolucion funcional, tolerancia al esfuerzo, riesgo de caida y metas de autonomia.',
    readiness: 'scaffold',
  },
  {
    id: 'long-term-care',
    label: 'Residencias y larga estadia',
    aliases: ['larga-estadia', 'residencia', 'geriatria-residencial', 'cuidados-prolongados'],
    baseUnitType: 'long-term-care',
    clinicalFocus: 'Fragilidad, cognicion, piel, nutricion y continuidad longitudinal en cronicidad avanzada.',
    readiness: 'scaffold',
  },
  {
    id: 'behavioral-health',
    label: 'Salud mental',
    aliases: ['salud-mental', 'psiquiatria', 'psiquiatria-aguda'],
    baseUnitType: 'behavioral-health',
    clinicalFocus: 'Riesgo conductual, adherencia, observacion especial y alianza terapeutica.',
    readiness: 'scaffold',
  },
  {
    id: 'home-care',
    label: 'Atencion domiciliaria',
    aliases: ['domiciliaria', 'hospitalizacion-domiciliaria', 'visita-domiciliaria', 'paliativos-domicilio'],
    baseUnitType: 'home-care',
    clinicalFocus: 'Entorno, cuidadores, insumos, soporte social y riesgo de rehospitalizacion.',
    readiness: 'scaffold',
  },
] as const;

export const SPECIALTY_OVERLAY_CATALOG: readonly SpecialtyOverlayCatalogEntry[] = [
  {
    id: 'cvicu',
    label: 'Cardiologia y cirugia cardiovascular',
    aliases: ['cardiologia', 'cirugia-cardiovascular', 'hemodinamia', 'cardio-icu'],
    clinicalFocus: 'Perfusion, arritmias, dolor isquemico, balance fino y dispositivos cardiovasculares.',
    allowedUnitProfiles: ['specialized-critical-care', 'critical-care', 'general-inpatient', 'perioperative', 'ambulatory'],
    readiness: 'wave-1',
  },
  {
    id: 'neuroicu',
    label: 'Neurologia y neurocirugia',
    aliases: ['neurologia', 'neurocirugia', 'stroke-unit', 'neuro-uvi'],
    clinicalFocus: 'Cambios neurologicos sutiles, conciencia, PIC y seguridad deglutoria.',
    allowedUnitProfiles: ['specialized-critical-care', 'critical-care', 'general-inpatient', 'emergency', 'rehabilitation'],
    readiness: 'wave-1',
  },
  {
    id: 'onc',
    label: 'Oncologia y hematologia',
    aliases: ['oncologia-hematologia', 'hematologia', 'eoprop-ia', 'urgencias-oncologicas'],
    clinicalFocus: 'Toxicidad, neutropenia, dolor, extravasacion y soporte anticipatorio.',
    allowedUnitProfiles: ['general-inpatient', 'ambulatory', 'emergency', 'home-care'],
    readiness: 'wave-1',
  },
  {
    id: 'trauma',
    label: 'Traumatologia y ortopedia',
    aliases: ['traumatologia', 'ortopedia', 'movilizacion-segura'],
    clinicalFocus: 'Dolor, movilidad, perfusion distal, tromboprofilaxis y seguridad en movilizacion.',
    allowedUnitProfiles: ['general-inpatient', 'perioperative', 'rehabilitation', 'emergency'],
    readiness: 'scaffold',
  },
  {
    id: 'neph',
    label: 'Nefrologia y urologia',
    aliases: ['nefrologia', 'urologia', 'dialisis', 'hemodialisis'],
    clinicalFocus: 'Balance hidrico, accesos, diuresis, electrolitos y riesgo infeccioso.',
    allowedUnitProfiles: ['general-inpatient', 'ambulatory', 'home-care', 'perioperative'],
    readiness: 'wave-1',
  },
  {
    id: 'gastro',
    label: 'Gastroenterologia y hepatologia',
    aliases: ['gastroenterologia', 'hepatologia', 'digestivo', 'endoscopia'],
    clinicalFocus: 'Sangrado digestivo, encefalopatia, nutricion, ostomias y drenajes.',
    allowedUnitProfiles: ['general-inpatient', 'ambulatory', 'perioperative'],
    readiness: 'scaffold',
  },
  {
    id: 'endo',
    label: 'Endocrinologia',
    aliases: ['endocrinologia', 'diabetes-compleja', 'bomba-insulina', 'cgm'],
    clinicalFocus: 'Seguridad metabolica, hipoglucemia/hiperglucemia, cetosis y adherencia.',
    allowedUnitProfiles: ['general-inpatient', 'emergency', 'ambulatory', 'home-care'],
    readiness: 'scaffold',
  },
  {
    id: 'pulm',
    label: 'Neumologia',
    aliases: ['neumologia', 'respiratorio', 'ventilacion-prolongada', 'fisioterapia-respiratoria'],
    clinicalFocus: 'Intercambio gaseoso, secreciones, soporte respiratorio y fatiga.',
    allowedUnitProfiles: ['critical-care', 'specialized-critical-care', 'general-inpatient', 'rehabilitation', 'ambulatory', 'home-care', 'emergency'],
    readiness: 'scaffold',
  },
  {
    id: 'infect',
    label: 'Infectologia',
    aliases: ['infectologia', 'aislamiento', 'vih', 'multirresistencia'],
    clinicalFocus: 'Aislamiento, sepsis, adherencia antimicrobiana y prevencion de transmision cruzada.',
    allowedUnitProfiles: ['critical-care', 'specialized-critical-care', 'general-inpatient', 'ambulatory', 'home-care', 'emergency'],
    readiness: 'scaffold',
  },
  {
    id: 'ped',
    label: 'Pediatria y subespecialidades',
    aliases: ['subespecialidades-pediatricas', 'onco-pediatria', 'peso-y-edad'],
    clinicalFocus: 'Edad, peso, hidratacion, dolor y rol del cuidador.',
    allowedUnitProfiles: ['general-inpatient', 'pediatric-critical-care', 'ambulatory', 'home-care', 'emergency'],
    readiness: 'wave-1',
  },
  {
    id: 'ob',
    label: 'Ginecologia y obstetricia',
    aliases: ['ginecologia', 'obstetricia', 'gyn', 'alto-riesgo-obstetrico', 'puerperio'],
    clinicalFocus: 'Sangrado, dolor, infeccion, vigilancia obstetrica y continuidad del binomio cuando aplica.',
    allowedUnitProfiles: ['general-inpatient', 'maternal-perinatal', 'perioperative', 'ambulatory', 'emergency'],
    readiness: 'wave-1',
  },
  {
    id: 'ent',
    label: 'Oftalmologia y otorrinolaringologia',
    aliases: ['oftalmologia', 'otorrinolaringologia', 'orl', 'postoperatorio-orl'],
    clinicalFocus: 'Dolor, sangrado localizado, taponamientos y educacion de alta.',
    allowedUnitProfiles: ['ambulatory', 'perioperative', 'general-inpatient'],
    readiness: 'scaffold',
  },
  {
    id: 'burns',
    label: 'Cirugia plastica y quemados',
    aliases: ['plastica', 'quemados', 'injertos', 'superficie-corporal-quemada'],
    clinicalFocus: 'Dolor, fluidos, injertos, aislamiento y riesgo infeccioso.',
    allowedUnitProfiles: ['specialized-critical-care', 'critical-care', 'perioperative', 'general-inpatient', 'rehabilitation'],
    readiness: 'scaffold',
  },
  {
    id: 'critical-emergency',
    label: 'Medicina critica y emergencias',
    aliases: ['medicina-critica', 'emergencias-criticas', 'criticos', 'resuscitation-critical'],
    clinicalFocus: 'ABCDE real, reevaluacion inmediata, soporte avanzado y velocidad de intervencion.',
    allowedUnitProfiles: ['emergency', 'critical-care', 'pediatric-critical-care', 'specialized-critical-care'],
    readiness: 'wave-1',
  },
  {
    id: 'transplant',
    label: 'Trasplante de organos solidos',
    aliases: ['trasplante', 'injerto-solido', 'inmunosupresion', 'rechazo-agudo'],
    clinicalFocus: 'Inmunosupresion, rechazo, infeccion y vigilancia del injerto.',
    allowedUnitProfiles: ['critical-care', 'specialized-critical-care', 'general-inpatient', 'ambulatory'],
    readiness: 'scaffold',
  },
] as const;

export const UNIT_PROFILE_CATALOG_BY_ID: Readonly<Record<UnitProfileId, UnitProfileCatalogEntry>> =
  UNIT_PROFILE_CATALOG.reduce(
    (acc, entry) => ({ ...acc, [entry.id]: entry }),
    {} as Record<UnitProfileId, UnitProfileCatalogEntry>,
  );

export const SPECIALTY_OVERLAY_CATALOG_BY_ID: Readonly<Record<SpecialtyOverlayId, SpecialtyOverlayCatalogEntry>> =
  SPECIALTY_OVERLAY_CATALOG.reduce(
    (acc, entry) => ({ ...acc, [entry.id]: entry }),
    {} as Record<SpecialtyOverlayId, SpecialtyOverlayCatalogEntry>,
  );

export const WAVE_1_UNIT_PROFILE_IDS = UNIT_PROFILE_CATALOG.filter((entry) => entry.readiness === 'wave-1').map(
  (entry) => entry.id,
);

export const WAVE_1_SPECIALTY_OVERLAY_IDS = SPECIALTY_OVERLAY_CATALOG.filter(
  (entry) => entry.readiness === 'wave-1',
).map((entry) => entry.id);
