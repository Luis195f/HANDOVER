// BEGIN HANDOVER D3 – DiagnosisCatalog
export type DiagnosisSystem = 'NANDA' | 'SNOMED' | 'ICD10' | 'OTHER';

export interface DiagnosisCode {
  system: DiagnosisSystem;
  code: string;
  display: string;
  synonyms?: string[];
}

/**
 * Conjunto de códigos NANDA/SNOMED que pueden usarse sin licencia para pruebas.
 * Este catálogo es un mock reducido; los hospitales podrán ampliarlo con licencias.
 */
export const DIAGNOSIS_CODES: readonly DiagnosisCode[] = [
  // NANDA – Ejemplos comunes para pruebas
  {
    system: 'NANDA',
    code: '00001',
    display: 'Oxigenación alterada',
    synonyms: ['oxigenación alterada', 'oxygenation altered'],
  },
  {
    system: 'NANDA',
    code: '00004',
    display: 'Riesgo de infección',
    synonyms: ['riesgo de infección', 'infection risk'],
  },
  {
    system: 'NANDA',
    code: '00146',
    display: 'Ansiedad',
    synonyms: ['ansiedad', 'anxiety'],
  },
  {
    system: 'NANDA',
    code: '00155',
    display: 'Dolor agudo',
    synonyms: ['dolor agudo', 'acute pain'],
  },
  // SNOMED – Diagnósticos médicos de uso común
  {
    system: 'SNOMED',
    code: '44054006',
    display: 'Diabetes mellitus tipo 2',
    synonyms: ['diabetes tipo 2', 'dm2', 'type 2 diabetes'],
  },
  {
    system: 'SNOMED',
    code: '195967001',
    display: 'Asma',
    synonyms: ['asma', 'asthma'],
  },
  {
    system: 'SNOMED',
    code: '233604007',
    display: 'Insuficiencia cardíaca congestiva',
    synonyms: ['insuficiencia cardiaca', 'heart failure'],
  },
  {
    system: 'SNOMED',
    code: '11193006',
    display: 'Infarto agudo de miocardio',
    synonyms: ['infarto', 'myocardial infarction'],
  },
  {
    system: 'SNOMED',
    code: '72496004',
    display: 'Neumonía',
    synonyms: ['neumonia', 'pneumonia'],
  },
  // Otros códigos pueden añadirse aquí con licencia o mocks.
];
// END HANDOVER D3 – DiagnosisCatalog

export function filterDiagnosisCodes(
  query: string,
  systemsAllowed?: DiagnosisSystem[],
): DiagnosisCode[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  return DIAGNOSIS_CODES.filter((code) => {
    if (systemsAllowed && !systemsAllowed.includes(code.system)) {
      return false;
    }
    const haystack = [code.display, ...(code.synonyms ?? [])];
    return haystack.some((text) => text.toLowerCase().includes(normalized));
  });
}
