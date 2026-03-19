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
    clinicalFocus: 'Triage, motivo sindromico, reevaluacion obligatoria, aislamiento y gestion de flujo saturado.',
    readiness: 'wave-1',
  },
  {
    id: 'general-inpatient',
    label: 'Hospitalizacion general',
    aliases: ['hospitalizacion', 'medicina-interna', 'planta-medica', 'planta-quirurgica'],
    baseUnitType: 'inpatient',
    clinicalFocus: 'Continuidad de cuidados, fragilidad, dependencia, conciliacion, delirium, alta compleja y riesgo de omision en planta.',
    readiness: 'wave-1',
  },
  {
    id: 'critical-care',
    label: 'UCI adulto',
    aliases: ['uci-adulto', 'adult-icu', 'cuidados-criticos-adulto'],
    baseUnitType: 'critical-care',
    clinicalFocus: 'Inestabilidad minuto a minuto, ventilacion, sedacion, perfusion, drogas vasoactivas, balance fino y microvigilancia.',
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
    id: 'cardio',
    label: 'Cardiologia y cirugia cardiovascular',
    aliases: ['cardiologia', 'cirugia-cardiovascular', 'hemodinamia', 'cardio-icu', 'cvicu'],
    clinicalFocus: 'Perfusion, dolor toracico, insuficiencia cardiaca, arritmias, anticoagulacion y congestion.',
    allowedUnitProfiles: ['specialized-critical-care', 'critical-care', 'emergency', 'general-inpatient', 'home-care'],
    readiness: 'wave-1',
  },
  {
    id: 'neuro',
    label: 'Neurologia y neurocirugia',
    aliases: ['neurologia', 'neurocirugia', 'stroke-unit', 'neuro-uvi', 'neuroicu'],
    clinicalFocus: 'Conciencia, deficit focal, convulsiones, pupilas, deglucion y neurovigilancia.',
    allowedUnitProfiles: ['specialized-critical-care', 'critical-care', 'emergency', 'general-inpatient', 'rehabilitation'],
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
    clinicalFocus: 'Mecanismo lesional, sangrado, inmovilizacion, dolor y perfusion distal.',
    allowedUnitProfiles: ['emergency', 'critical-care', 'general-inpatient', 'rehabilitation'],
    readiness: 'wave-1',
  },
  {
    id: 'infecto',
    label: 'Infectologia',
    aliases: ['infectologia', 'aislamiento', 'vih', 'multirresistencia', 'infect'],
    clinicalFocus: 'Foco infeccioso, sepsis, aislamiento, antimicrobianos y control de foco.',
    allowedUnitProfiles: ['critical-care', 'general-inpatient', 'ambulatory', 'home-care', 'emergency'],
    readiness: 'wave-1',
  },
  {
    id: 'neumo',
    label: 'Neumologia',
    aliases: ['neumologia', 'respiratorio', 'ventilacion-prolongada', 'fisioterapia-respiratoria', 'pulm'],
    clinicalFocus: 'Oxigenacion, ventilacion, broncoespasmo, secreciones, NIV y fatiga respiratoria.',
    allowedUnitProfiles: ['critical-care', 'emergency', 'general-inpatient', 'home-care'],
    readiness: 'wave-1',
  },
  {
    id: 'nefroUro',
    label: 'Nefrologia y urologia',
    aliases: ['nefrologia', 'urologia', 'dialisis', 'hemodialisis', 'neph'],
    clinicalFocus: 'Diuresis, balance, AKI, electrolitos, obstruccion, cateteres y terapia renal sustitutiva.',
    allowedUnitProfiles: ['general-inpatient', 'emergency', 'ambulatory', 'home-care'],
    readiness: 'wave-1',
  },
  {
    id: 'gastroHepato',
    label: 'Gastroenterologia y hepatologia',
    aliases: ['gastroenterologia', 'hepatologia', 'digestivo', 'endoscopia', 'gastro'],
    clinicalFocus: 'Sangrado digestivo, encefalopatia, dolor abdominal, drenajes, ostomias e hidratacion/nutricion.',
    allowedUnitProfiles: ['general-inpatient', 'emergency', 'ambulatory', 'home-care'],
    readiness: 'wave-1',
  },
  {
    id: 'endo',
    label: 'Endocrinologia',
    aliases: ['endocrinologia', 'diabetes-compleja', 'bomba-insulina', 'cgm'],
    clinicalFocus: 'Glucemia, insulinoterapia, cetosis, esteroides y descompensacion metabolica.',
    allowedUnitProfiles: ['general-inpatient', 'emergency', 'ambulatory', 'home-care'],
    readiness: 'wave-1',
  },
  {
    id: 'gynObs',
    label: 'Ginecologia y obstetricia',
    aliases: ['ginecologia', 'obstetricia', 'gyn', 'ob', 'alto-riesgo-obstetrico', 'puerperio'],
    clinicalFocus: 'Sangrado, dolor, hipertension, puerperio/embarazo, perdidas y vigilancia materna.',
    allowedUnitProfiles: ['maternal-perinatal', 'general-inpatient', 'emergency', 'ambulatory', 'home-care'],
    readiness: 'wave-1',
  },
  {
    id: 'pedsSubspecialties',
    label: 'Pediatria y subespecialidades',
    aliases: ['subespecialidades-pediatricas', 'onco-pediatria', 'peso-y-edad', 'ped'],
    clinicalFocus: 'Dependencia pediatrica aumentada, peso/edad, tolerancia y comunicacion con familia.',
    allowedUnitProfiles: ['pediatric-critical-care'],
    readiness: 'registry-only',
  },
  {
    id: 'ophthalEnt',
    label: 'Oftalmologia y otorrinolaringologia',
    aliases: ['oftalmologia', 'otorrinolaringologia', 'orl', 'postoperatorio-orl', 'ent'],
    clinicalFocus: 'Dolor, sangrado, secrecion y vigilancia de via aerea superior cuando aplica.',
    allowedUnitProfiles: ['ambulatory', 'emergency', 'general-inpatient'],
    readiness: 'registry-only',
  },
  {
    id: 'plasticsBurns',
    label: 'Cirugia plastica y quemados',
    aliases: ['plastica', 'quemados', 'injertos', 'superficie-corporal-quemada', 'burns'],
    clinicalFocus: 'Quemaduras, curas complejas, dolor, balance, injertos y riesgo infeccioso.',
    allowedUnitProfiles: ['emergency', 'general-inpatient', 'home-care'],
    readiness: 'registry-only',
  },
  {
    id: 'criticalEmergency',
    label: 'Medicina critica y emergencias',
    aliases: ['medicina-critica', 'emergencias-criticas', 'criticos', 'resuscitation-critical', 'critical-emergency'],
    clinicalFocus: 'Overlay transversal prudente para ABCDE, soporte avanzado y reevaluacion inmediata sin duplicar UPP base.',
    allowedUnitProfiles: ['emergency', 'critical-care'],
    readiness: 'registry-only',
  },
  {
    id: 'transplant',
    label: 'Trasplante de organos solidos',
    aliases: ['trasplante', 'injerto-solido', 'inmunosupresion', 'rechazo-agudo'],
    clinicalFocus: 'Inmunosupresion, rechazo, infeccion, acceso, adherencia y continuidad del injerto.',
    allowedUnitProfiles: ['general-inpatient', 'ambulatory', 'home-care', 'critical-care'],
    readiness: 'registry-only',
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

export const REGISTRY_ONLY_SPECIALTY_OVERLAY_IDS = SPECIALTY_OVERLAY_CATALOG.filter(
  (entry) => entry.readiness === 'registry-only',
).map((entry) => entry.id);
