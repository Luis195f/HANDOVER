export type Specialty = {
  id: string;
  name: string;
  devicesQuickPick: string[];
  risksQuickPick: string[];
  pendingQuickPick: string[];
  careQuickPick: string[];
};

export const SPECIALTIES: Specialty[] = [
  {
    id: 'icu',
    name: 'UCI Adulto',
    devicesQuickPick: ['CVC','Arterial','PICC','Midline','Foley','SNG','Drenaje torácico','Traqueostomía','VM invasiva','VM no invasiva','Alto Flujo','CRRT','Marcapasos','IABP','Epidural','VAC'],
    risksQuickPick: ['Caídas','CLABSI','NAV','ITU','Úlcera por presión','Delirium','Tromboembolismo','Error medicación'],
    pendingQuickPick: ['Gasometría','Rx tórax','Cambio apósito CVC','Diálisis','Sedación SAT/SBT','Retiro drenaje'],
    careQuickPick: ['Cambios posturales','Curación traqueo','Higiene oral','Fisioterapia resp','Balance hídrico 24h'],
  },
  {
    id: 'ed',
    name: 'Urgencias',
    devicesQuickPick: ['Vía periférica','Foley','Collarín','Oxígeno','Monitor','SNG'],
    risksQuickPick: ['Caídas','Violencia/contención','Sepsis','IAM/ACV ventana','Politrauma'],
    pendingQuickPick: ['Laboratorio ingreso','ECG','Imágenes (TC/Rx)','Cultivos','Antibiótico 1ª dosis'],
    careQuickPick: ['Sepsis bundle 1h','Analgesia','Inmovilización','Educación alta'],
  },
  {
    id: 'onc',
    name: 'Oncología',
    devicesQuickPick: ['Port-a-Cath','PICC','Foley','SNG','Bomba infusión'],
    risksQuickPick: ['Neutropenia','Mucositis','Náuseas/vómitos','Extravasación'],
    pendingQuickPick: ['Hemograma','Quimio próxima','Antieméticos programados'],
    careQuickPick: ['Manejo efectos adversos','Educación cuidador'],
  },
  {
    id: 'neph',
    name: 'Nefrología/Diálisis',
    devicesQuickPick: ['FAV','Catéter hemodiálisis','Foley','SNG'],
    risksQuickPick: ['Hipotensión diálisis','Infección acceso','Hiperkalemia'],
    pendingQuickPick: ['Diálisis próxima','K+ control','Peso seco'],
    careQuickPick: ['Cuidado acceso','Balance hídrico estricto'],
  },
  {
    id: 'ped',
    name: 'Pediatría',
    devicesQuickPick: ['Vía periférica','NPT','SOG','Oxígeno','VM no invasiva'],
    risksQuickPick: ['Deshidratación','Fallo resp','Dolor infantil','Fiebre'],
    pendingQuickPick: ['Antitérmico','Hidratación','Rx tórax'],
    careQuickPick: ['Educación padres','Control dolor'],
  },
  {
    id: 'ob',
    name: 'Obstetricia',
    devicesQuickPick: ['Venoclisis','Foley','Epidural','Monitor fetal'],
    risksQuickPick: ['Hemorragia posparto','Preeclampsia','Infección'],
    pendingQuickPick: ['Control loquios','Fármacos uterotónicos'],
    careQuickPick: ['Lactancia','Deambulación temprana'],
  },
  {
    id: 'neuroicu',
    name: 'Neuro UCI',
    devicesQuickPick: ['CVC','Arterial','DVE','Traqueostomía','VM','Foley'],
    risksQuickPick: ['HIC','Convulsiones','Neumonía asociada','Úlcera por presión'],
    pendingQuickPick: ['TAC control','Sedación objetivo','Profilaxis crisis'],
    careQuickPick: ['Escalas neurológicas','Cabeza 30°','Cuidado DVE'],
  },
  {
    id: 'cvicu',
    name: 'Cardio UCI',
    devicesQuickPick: ['CVC','Arterial','Marcapasos','Drenajes mediastinales','VM','Foley','Swan-Ganz'],
    risksQuickPick: ['Bajo gasto','Arritmias','Sangrado','Infección'],
    pendingQuickPick: ['ECG control','Gasometría','Balance 24h','Aminas titulación'],
    careQuickPick: ['Fisioterapia resp','Curación esternal','Deambulación guiada'],
  }
];

export const DEFAULT_SPECIALTY_ID = 'icu';
