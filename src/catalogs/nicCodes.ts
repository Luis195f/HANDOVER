import { API_BASE_URL } from '../config/env';
import {
  buildCatalogSearchIndex,
  createGovernedCatalogRuntime,
  normalizeCatalogSearchText,
  searchCatalogIndex,
  type GovernedCatalogCode,
  type GovernedCatalogPayload,
  type GovernedCatalogSearchIndex,
} from './governedCatalog';

export type NicCode = GovernedCatalogCode<'NIC'>;
export type NicSearchIndex = GovernedCatalogSearchIndex<'NIC', NicCode>;
export type NicCatalogPayload = GovernedCatalogPayload<'NIC', NicCode>;

export const NIC_LICENSE_WARNING = 'Licencia NIC requerida';
export const NIC_CATALOG_ENDPOINT_PATH = '/api/catalogs/nic';
export const NIC_PLACEHOLDER_CODES: readonly NicCode[] = [
  {
    system: 'NIC',
    code: '2210',
    display: 'Administración de analgésicos',
    synonyms: ['manejo analgésico', 'control del dolor'],
  },
  {
    system: 'NIC',
    code: '3350',
    display: 'Monitorización respiratoria',
    synonyms: ['vigilancia respiratoria', 'seguimiento respiratorio'],
  },
  {
    system: 'NIC',
    code: '6680',
    display: 'Monitorización de signos vitales',
    synonyms: ['vigilancia de signos vitales', 'signos vitales'],
  },
  {
    system: 'NIC',
    code: '5602',
    display: 'Enseñanza: proceso de enfermedad',
    synonyms: ['educación al paciente', 'proceso de enfermedad'],
  },
] as const;

const runtime = createGovernedCatalogRuntime<'NIC', NicCode>({
  system: 'NIC',
  endpointPath: NIC_CATALOG_ENDPOINT_PATH,
  apiBaseUrl: API_BASE_URL,
  licenseWarning: NIC_LICENSE_WARNING,
  placeholderCodes: NIC_PLACEHOLDER_CODES,
  placeholderVersion: 'placeholder-2026-03',
  inlineEnvKeys: [],
  urlEnvKeys: ['EXPO_PUBLIC_NIC_CATALOG_URL', 'NIC_CATALOG_URL'],
});

export function normalizeNicSearchText(value: string): string {
  return normalizeCatalogSearchText(value);
}

export function buildNicSearchIndex(codes: readonly NicCode[]): NicSearchIndex {
  return buildCatalogSearchIndex<'NIC', NicCode>(codes);
}

export function searchNicIndex(index: NicSearchIndex, query: string, limit = 40): NicCode[] {
  return searchCatalogIndex<'NIC', NicCode>(index, query, limit);
}

export const getNicPlaceholderCatalog = runtime.getPlaceholderCatalog;
export const loadNicCatalog = runtime.loadCatalog;
export const resolveNicCatalogEndpointUrl = runtime.resolveCatalogEndpointUrl;
