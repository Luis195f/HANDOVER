import { API_BASE_URL } from '../config/env';
import {
  buildCatalogSearchIndex,
  createGovernedCatalogRuntime,
  normalizeCatalogSearchText,
  searchCatalogIndex,
  type GovernedCatalogPayload,
  type GovernedCatalogSearchIndex,
} from './governedCatalog';
import type { DiagnosisCode } from './diagnosisCodes';

export type NandaDiagnosisCode = DiagnosisCode & { system: 'NANDA' };

export const NANDA_LICENSE_WARNING = 'Licencia NANDA-I requerida';
export const NANDA_CATALOG_ENDPOINT_PATH = '/api/catalogs/nanda';
export const NANDA_PLACEHOLDER_CODES: readonly NandaDiagnosisCode[] = [
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
] as const;

export type DiagnosisSearchIndex = GovernedCatalogSearchIndex<'NANDA', NandaDiagnosisCode>;
export type NandaCatalogPayload = GovernedCatalogPayload<'NANDA', NandaDiagnosisCode>;

const runtime = createGovernedCatalogRuntime<'NANDA', NandaDiagnosisCode>({
  system: 'NANDA',
  endpointPath: NANDA_CATALOG_ENDPOINT_PATH,
  apiBaseUrl: API_BASE_URL,
  licenseWarning: NANDA_LICENSE_WARNING,
  placeholderCodes: NANDA_PLACEHOLDER_CODES,
  placeholderVersion: 'placeholder-2026-03',
  inlineEnvKeys: ['EXPO_PUBLIC_NANDA_CATALOG_JSON', 'NANDA_CATALOG_JSON'],
  urlEnvKeys: ['EXPO_PUBLIC_NANDA_CATALOG_URL', 'NANDA_CATALOG_URL'],
});

export function normalizeDiagnosisSearchText(value: string): string {
  return normalizeCatalogSearchText(value);
}

export function buildDiagnosisSearchIndex(codes: readonly NandaDiagnosisCode[]): DiagnosisSearchIndex {
  return buildCatalogSearchIndex<'NANDA', NandaDiagnosisCode>(codes);
}

export function searchDiagnosisIndex(
  index: DiagnosisSearchIndex,
  query: string,
  limit = 40,
): DiagnosisCode[] {
  return searchCatalogIndex<'NANDA', NandaDiagnosisCode>(index, query, limit);
}

export const getNandaPlaceholderCatalog = runtime.getPlaceholderCatalog;
export const loadNandaCatalog = runtime.loadCatalog;
export const resolveNandaCatalogEndpointUrl = runtime.resolveCatalogEndpointUrl;
