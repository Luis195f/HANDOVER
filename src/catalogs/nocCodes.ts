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

export type NocCode = GovernedCatalogCode<'NOC'>;
export type NocSearchIndex = GovernedCatalogSearchIndex<'NOC', NocCode>;
export type NocCatalogPayload = GovernedCatalogPayload<'NOC', NocCode>;

export const NOC_LICENSE_WARNING = 'Licencia NOC requerida';
export const NOC_CATALOG_ENDPOINT_PATH = '/api/catalogs/noc';
export const NOC_PLACEHOLDER_CODES: readonly NocCode[] = [
  {
    system: 'NOC',
    code: '0402',
    display: 'Estado respiratorio: permeabilidad de las vías aéreas',
    synonyms: ['permeabilidad de vias aereas', 'estado respiratorio'],
  },
  {
    system: 'NOC',
    code: '0802',
    display: 'Signos vitales',
    synonyms: ['constantes vitales', 'monitorización de signos vitales'],
  },
  {
    system: 'NOC',
    code: '1605',
    display: 'Control del dolor',
    synonyms: ['manejo del dolor', 'dolor controlado'],
  },
  {
    system: 'NOC',
    code: '1813',
    display: 'Conocimiento: régimen terapéutico',
    synonyms: ['educación terapéutica', 'régimen terapéutico'],
  },
] as const;

const runtime = createGovernedCatalogRuntime<'NOC', NocCode>({
  system: 'NOC',
  endpointPath: NOC_CATALOG_ENDPOINT_PATH,
  apiBaseUrl: API_BASE_URL,
  licenseWarning: NOC_LICENSE_WARNING,
  placeholderCodes: NOC_PLACEHOLDER_CODES,
  placeholderVersion: 'placeholder-2026-03',
  inlineEnvKeys: ['EXPO_PUBLIC_NOC_CATALOG_JSON', 'NOC_CATALOG_JSON'],
  urlEnvKeys: ['EXPO_PUBLIC_NOC_CATALOG_URL', 'NOC_CATALOG_URL'],
});

export function normalizeNocSearchText(value: string): string {
  return normalizeCatalogSearchText(value);
}

export function buildNocSearchIndex(codes: readonly NocCode[]): NocSearchIndex {
  return buildCatalogSearchIndex<'NOC', NocCode>(codes);
}

export function searchNocIndex(index: NocSearchIndex, query: string, limit = 40): NocCode[] {
  return searchCatalogIndex<'NOC', NocCode>(index, query, limit);
}

export const getNocPlaceholderCatalog = runtime.getPlaceholderCatalog;
export const loadNocCatalog = runtime.loadCatalog;
export const resolveNocCatalogEndpointUrl = runtime.resolveCatalogEndpointUrl;
