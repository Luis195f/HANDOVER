import Constants from 'expo-constants';

import { API_BASE_URL } from '../config/env';
import { getToken } from '../security/tokenSupplier';
import type { DiagnosisCode } from './diagnosisCodes';

export const NANDA_LICENSE_WARNING = 'Licencia NANDA-I requerida';
export const NANDA_CATALOG_ENDPOINT_PATH = '/api/catalogs/nanda';
export const NANDA_PLACEHOLDER_CODES: readonly DiagnosisCode[] = [
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

type CatalogSource = 'local-placeholder' | 'env-json' | 'env-url' | 'backend' | 'backend-placeholder';

interface IndexedDiagnosisCode extends DiagnosisCode {
  normalizedCode: string;
  normalizedDisplay: string;
  normalizedSynonyms: string[];
  searchText: string;
  tokens: string[];
}

export interface DiagnosisSearchIndex {
  readonly entries: readonly IndexedDiagnosisCode[];
  readonly prefixBuckets: ReadonlyMap<string, readonly number[]>;
}

export interface NandaCatalogPayload {
  system: 'NANDA';
  licensed: boolean;
  version: string;
  source: CatalogSource;
  warning: string;
  codes: DiagnosisCode[];
  index: DiagnosisSearchIndex;
  etag?: string;
}

const INLINE_CATALOG_ENV_KEYS = ['EXPO_PUBLIC_NANDA_CATALOG_JSON', 'NANDA_CATALOG_JSON'] as const;
const URL_CATALOG_ENV_KEYS = ['EXPO_PUBLIC_NANDA_CATALOG_URL', 'NANDA_CATALOG_URL'] as const;
const PREFIX_INDEX_MAX_LENGTH = 18;
const SEARCH_TERM_SPLIT_REGEX = /[^a-z0-9]+/g;

const remoteCatalogCache = new Map<string, NandaCatalogPayload>();
const inFlightCatalogLoads = new Map<string, Promise<NandaCatalogPayload>>();

function getExpoExtra(): Record<string, unknown> {
  const extra = Constants.expoConfig?.extra;
  return extra && typeof extra === 'object' ? (extra as Record<string, unknown>) : {};
}

function readRuntimeConfig(keys: readonly string[]): string | null {
  const extra = getExpoExtra();
  for (const key of keys) {
    const envValue = process.env[key];
    if (typeof envValue === 'string' && envValue.trim()) {
      return envValue.trim();
    }

    const extraValue = extra[key];
    if (typeof extraValue === 'string' && extraValue.trim()) {
      return extraValue.trim();
    }
  }

  return null;
}

export function normalizeDiagnosisSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function tokenizeSearchValue(value: string): string[] {
  const normalized = normalizeDiagnosisSearchText(value);
  if (!normalized) {
    return [];
  }

  return Array.from(new Set(normalized.split(SEARCH_TERM_SPLIT_REGEX).filter(Boolean)));
}

function addTokenToPrefixIndex(prefixBuckets: Map<string, number[]>, token: string, entryIndex: number): void {
  const tokenPrefix = token.slice(0, PREFIX_INDEX_MAX_LENGTH);
  for (let cursor = 1; cursor <= tokenPrefix.length; cursor += 1) {
    const prefix = tokenPrefix.slice(0, cursor);
    const existingBucket = prefixBuckets.get(prefix);
    if (existingBucket) {
      if (existingBucket[existingBucket.length - 1] !== entryIndex) {
        existingBucket.push(entryIndex);
      }
      continue;
    }

    prefixBuckets.set(prefix, [entryIndex]);
  }
}

function buildIndexedDiagnosisCode(code: DiagnosisCode): IndexedDiagnosisCode {
  const normalizedCode = normalizeDiagnosisSearchText(code.code);
  const normalizedDisplay = normalizeDiagnosisSearchText(code.display);
  const normalizedSynonyms = (code.synonyms ?? [])
    .map((value) => normalizeDiagnosisSearchText(value))
    .filter(Boolean);
  const tokens = Array.from(
    new Set([
      normalizedCode,
      ...tokenizeSearchValue(code.display),
      ...(code.synonyms ?? []).flatMap((value) => tokenizeSearchValue(value)),
    ]),
  ).filter(Boolean);

  return {
    ...code,
    normalizedCode,
    normalizedDisplay,
    normalizedSynonyms,
    searchText: [normalizedDisplay, normalizedCode, ...normalizedSynonyms].filter(Boolean).join(' '),
    tokens,
  };
}

export function buildDiagnosisSearchIndex(codes: readonly DiagnosisCode[]): DiagnosisSearchIndex {
  const prefixBuckets = new Map<string, number[]>();
  const entries = codes.map((code, entryIndex) => {
    const indexedCode = buildIndexedDiagnosisCode(code);
    indexedCode.tokens.forEach((token) => addTokenToPrefixIndex(prefixBuckets, token, entryIndex));
    return indexedCode;
  });

  return {
    entries,
    prefixBuckets,
  };
}

function intersectSortedLists(left: readonly number[], right: readonly number[]): number[] {
  const results: number[] = [];
  let leftCursor = 0;
  let rightCursor = 0;

  while (leftCursor < left.length && rightCursor < right.length) {
    const leftValue = left[leftCursor];
    const rightValue = right[rightCursor];

    if (leftValue === rightValue) {
      results.push(leftValue);
      leftCursor += 1;
      rightCursor += 1;
      continue;
    }

    if (leftValue < rightValue) {
      leftCursor += 1;
      continue;
    }

    rightCursor += 1;
  }

  return results;
}

function scoreIndexedMatch(entry: IndexedDiagnosisCode, normalizedQuery: string): number {
  let score = 0;

  if (entry.normalizedDisplay === normalizedQuery) score -= 30;
  else if (entry.normalizedDisplay.startsWith(normalizedQuery)) score -= 18;
  else if (entry.normalizedDisplay.includes(normalizedQuery)) score -= 10;

  if (entry.normalizedCode === normalizedQuery) score -= 22;
  else if (entry.normalizedCode.startsWith(normalizedQuery)) score -= 12;

  const synonymMatch = entry.normalizedSynonyms.find(
    (value) => value === normalizedQuery || value.startsWith(normalizedQuery),
  );
  if (synonymMatch) {
    score -= synonymMatch === normalizedQuery ? 14 : 8;
  }

  return score + entry.normalizedDisplay.length / 1000;
}

export function searchDiagnosisIndex(
  index: DiagnosisSearchIndex,
  query: string,
  limit = 40,
): DiagnosisCode[] {
  const normalizedQuery = normalizeDiagnosisSearchText(query);
  if (!normalizedQuery) {
    return [];
  }

  const queryTokens = tokenizeSearchValue(normalizedQuery);
  if (!queryTokens.length) {
    return [];
  }

  let candidateIndexes: number[] | null = null;
  for (const token of queryTokens) {
    const bucketKey = token.slice(0, PREFIX_INDEX_MAX_LENGTH);
    const bucket = index.prefixBuckets.get(bucketKey) ?? [];
    candidateIndexes = candidateIndexes ? intersectSortedLists(candidateIndexes, bucket) : [...bucket];
    if (!candidateIndexes.length) {
      return [];
    }
  }

  if (!candidateIndexes) {
    return [];
  }

  return candidateIndexes
    .map((candidateIndex) => index.entries[candidateIndex])
    .filter((entry) => queryTokens.every((token) => entry.searchText.includes(token)))
    .map((entry) => ({
      entry,
      score: scoreIndexedMatch(entry, normalizedQuery),
    }))
    .sort((left, right) => left.score - right.score || left.entry.display.localeCompare(right.entry.display, 'es'))
    .slice(0, limit)
    .map(({ entry }) => ({
      system: entry.system,
      code: entry.code,
      display: entry.display,
      ...(entry.synonyms?.length ? { synonyms: entry.synonyms } : {}),
    }));
}

function sanitizeCatalogCode(value: unknown): DiagnosisCode | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const code = typeof record.code === 'string' ? record.code.trim() : '';
  const display = typeof record.display === 'string' ? record.display.trim() : '';
  if (!code || !display) {
    return null;
  }

  const system = typeof record.system === 'string' ? record.system.trim().toUpperCase() : 'NANDA';
  if (system !== 'NANDA') {
    return null;
  }

  const synonyms = Array.isArray(record.synonyms)
    ? record.synonyms
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : undefined;

  return {
    system: 'NANDA',
    code,
    display,
    ...(synonyms?.length ? { synonyms } : {}),
  };
}

function buildCatalogPayload(
  codes: DiagnosisCode[],
  options: {
    licensed: boolean;
    source: CatalogSource;
    version?: string;
    warning?: string;
    etag?: string;
  },
): NandaCatalogPayload {
  return {
    system: 'NANDA',
    licensed: options.licensed,
    source: options.source,
    version: options.version?.trim() || 'placeholder-2026-03',
    warning: options.warning?.trim() || NANDA_LICENSE_WARNING,
    codes,
    index: buildDiagnosisSearchIndex(codes),
    ...(options.etag ? { etag: options.etag } : {}),
  };
}

export function getNandaPlaceholderCatalog(): NandaCatalogPayload {
  return buildCatalogPayload([...NANDA_PLACEHOLDER_CODES], {
    licensed: false,
    source: 'local-placeholder',
    version: 'placeholder-2026-03',
    warning: NANDA_LICENSE_WARNING,
  });
}

function normalizeCatalogPayload(
  payload: unknown,
  source: Exclude<CatalogSource, 'local-placeholder'>,
  etag?: string,
): NandaCatalogPayload {
  const isObjectPayload = payload && typeof payload === 'object' && !Array.isArray(payload);
  const payloadRecord = isObjectPayload ? (payload as Record<string, unknown>) : null;
  const codesSource = Array.isArray(payload)
    ? payload
    : Array.isArray(payloadRecord?.codes)
      ? payloadRecord.codes
      : Array.isArray(payloadRecord?.entries)
        ? payloadRecord.entries
        : [];

  const sanitizedCodes = codesSource
    .map((item) => sanitizeCatalogCode(item))
    .filter((item): item is DiagnosisCode => Boolean(item));
  if (!sanitizedCodes.length) {
    return buildCatalogPayload([...NANDA_PLACEHOLDER_CODES], {
      licensed: false,
      source: source === 'backend' ? 'backend-placeholder' : source,
      version: 'placeholder-2026-03',
      warning:
        typeof payloadRecord?.warning === 'string' && payloadRecord.warning.trim()
          ? payloadRecord.warning.trim()
          : NANDA_LICENSE_WARNING,
      etag,
    });
  }

  const licensed =
    typeof payloadRecord?.licensed === 'boolean'
      ? payloadRecord.licensed
      : source === 'env-json' || source === 'env-url';

  return buildCatalogPayload(sanitizedCodes, {
    licensed,
    source: licensed ? source : source === 'backend' ? 'backend-placeholder' : source,
    version: typeof payloadRecord?.version === 'string' ? payloadRecord.version : undefined,
    warning: typeof payloadRecord?.warning === 'string' ? payloadRecord.warning : undefined,
    etag,
  });
}

async function fetchCatalogFromUrl(sourceUrl: string, source: 'env-url' | 'backend'): Promise<NandaCatalogPayload> {
  const cacheKey = `${source}:${sourceUrl}`;
  const cachedCatalog = remoteCatalogCache.get(cacheKey);
  const inFlight = inFlightCatalogLoads.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const loader = (async () => {
    const headers = new Headers({ Accept: 'application/json' });
    const token = await getToken('api');
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (cachedCatalog?.etag) {
      headers.set('If-None-Match', cachedCatalog.etag);
    }

    const response = await fetch(sourceUrl, {
      method: 'GET',
      headers,
    });

    if (response.status === 304 && cachedCatalog) {
      return cachedCatalog;
    }

    if (!response.ok) {
      throw new Error(`NANDA catalog request failed (${response.status})`);
    }

    const payload = await response.json();
    const catalog = normalizeCatalogPayload(payload, source, response.headers.get('ETag') ?? undefined);
    remoteCatalogCache.set(cacheKey, catalog);
    return catalog;
  })();

  inFlightCatalogLoads.set(cacheKey, loader);
  try {
    return await loader;
  } finally {
    inFlightCatalogLoads.delete(cacheKey);
  }
}

function resolveInlineCatalogJson(): string | null {
  return readRuntimeConfig(INLINE_CATALOG_ENV_KEYS);
}

function resolveCatalogUrl(): string | null {
  return readRuntimeConfig(URL_CATALOG_ENV_KEYS);
}

export function resolveNandaCatalogEndpointUrl(): string {
  return `${API_BASE_URL}${NANDA_CATALOG_ENDPOINT_PATH}`;
}

export async function loadNandaCatalog(): Promise<NandaCatalogPayload> {
  const inlineCatalogJson = resolveInlineCatalogJson();
  if (inlineCatalogJson) {
    const cacheKey = 'env-json:inline';
    const cachedCatalog = remoteCatalogCache.get(cacheKey);
    if (cachedCatalog) {
      return cachedCatalog;
    }

    const parsedPayload = JSON.parse(inlineCatalogJson) as unknown;
    const catalog = normalizeCatalogPayload(parsedPayload, 'env-json');
    remoteCatalogCache.set(cacheKey, catalog);
    return catalog;
  }

  const configuredCatalogUrl = resolveCatalogUrl();
  if (configuredCatalogUrl) {
    return fetchCatalogFromUrl(configuredCatalogUrl, 'env-url');
  }

  return fetchCatalogFromUrl(resolveNandaCatalogEndpointUrl(), 'backend');
}

