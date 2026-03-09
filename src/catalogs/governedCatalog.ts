import Constants from 'expo-constants';

import { getToken } from '../security/tokenSupplier';

export type GovernedCatalogSource =
  | 'local-placeholder'
  | 'env-json'
  | 'env-url'
  | 'backend'
  | 'backend-placeholder';

export interface GovernedCatalogCode<System extends string = string> {
  system: System;
  code: string;
  display: string;
  synonyms?: string[];
}

type IndexedGovernedCatalogCode<
  System extends string,
  Code extends GovernedCatalogCode<System>,
> = Code & {
  normalizedCode: string;
  normalizedDisplay: string;
  normalizedSynonyms: string[];
  searchText: string;
  tokens: string[];
};

export interface GovernedCatalogSearchIndex<
  System extends string,
  Code extends GovernedCatalogCode<System> = GovernedCatalogCode<System>,
> {
  readonly entries: readonly IndexedGovernedCatalogCode<System, Code>[];
  readonly prefixBuckets: ReadonlyMap<string, readonly number[]>;
}

export interface GovernedCatalogPayload<
  System extends string,
  Code extends GovernedCatalogCode<System> = GovernedCatalogCode<System>,
> {
  system: System;
  licensed: boolean;
  version: string;
  source: GovernedCatalogSource;
  warning: string;
  codes: Code[];
  index: GovernedCatalogSearchIndex<System, Code>;
  etag?: string;
}

interface GovernedCatalogConfig<
  System extends string,
  Code extends GovernedCatalogCode<System>,
> {
  system: System;
  endpointPath: string;
  apiBaseUrl: string;
  licenseWarning: string;
  placeholderCodes: readonly Code[];
  placeholderVersion: string;
  inlineEnvKeys: readonly string[];
  urlEnvKeys: readonly string[];
}

const PREFIX_INDEX_MAX_LENGTH = 18;
const SEARCH_TERM_SPLIT_REGEX = /[^a-z0-9]+/g;

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

export function normalizeCatalogSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function tokenizeSearchValue(value: string): string[] {
  const normalized = normalizeCatalogSearchText(value);
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

function buildIndexedCatalogCode<System extends string, Code extends GovernedCatalogCode<System>>(
  code: Code,
): IndexedGovernedCatalogCode<System, Code> {
  const normalizedCode = normalizeCatalogSearchText(code.code);
  const normalizedDisplay = normalizeCatalogSearchText(code.display);
  const normalizedSynonyms = (code.synonyms ?? [])
    .map((value) => normalizeCatalogSearchText(value))
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

export function buildCatalogSearchIndex<System extends string, Code extends GovernedCatalogCode<System>>(
  codes: readonly Code[],
): GovernedCatalogSearchIndex<System, Code> {
  const prefixBuckets = new Map<string, number[]>();
  const entries = codes.map((code, entryIndex) => {
    const indexedCode = buildIndexedCatalogCode(code);
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

function scoreIndexedMatch<System extends string, Code extends GovernedCatalogCode<System>>(
  entry: IndexedGovernedCatalogCode<System, Code>,
  normalizedQuery: string,
): number {
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

export function searchCatalogIndex<System extends string, Code extends GovernedCatalogCode<System>>(
  index: GovernedCatalogSearchIndex<System, Code>,
  query: string,
  limit = 40,
): Code[] {
  const normalizedQuery = normalizeCatalogSearchText(query);
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
    .map(({ entry }) => {
      const payload: Code = {
        system: entry.system,
        code: entry.code,
        display: entry.display,
      } as Code;

      if (entry.synonyms?.length) {
        payload.synonyms = entry.synonyms;
      }

      return payload;
    });
}

function sanitizeCatalogEntry<System extends string, Code extends GovernedCatalogCode<System>>(
  value: unknown,
  system: System,
): Code | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const code = typeof record.code === 'string' ? record.code.trim() : '';
  const display = typeof record.display === 'string' ? record.display.trim() : '';
  if (!code || !display) {
    return null;
  }

  const normalizedSystem =
    typeof record.system === 'string' ? record.system.trim().toUpperCase() : system;
  if (normalizedSystem !== system) {
    return null;
  }

  const synonyms = Array.isArray(record.synonyms)
    ? record.synonyms
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    : undefined;

  const payload: Code = {
    system,
    code,
    display,
  } as Code;

  if (synonyms?.length) {
    payload.synonyms = synonyms;
  }

  return payload;
}

function buildCatalogPayload<System extends string, Code extends GovernedCatalogCode<System>>(
  config: GovernedCatalogConfig<System, Code>,
  codes: Code[],
  options: {
    licensed: boolean;
    source: GovernedCatalogSource;
    version?: string;
    warning?: string;
    etag?: string;
  },
): GovernedCatalogPayload<System, Code> {
  return {
    system: config.system,
    licensed: options.licensed,
    source: options.source,
    version: options.version?.trim() || config.placeholderVersion,
    warning: options.warning?.trim() || config.licenseWarning,
    codes,
    index: buildCatalogSearchIndex(codes),
    ...(options.etag ? { etag: options.etag } : {}),
  };
}

export function createGovernedCatalogRuntime<
  System extends string,
  Code extends GovernedCatalogCode<System>,
>(config: GovernedCatalogConfig<System, Code>) {
  const remoteCatalogCache = new Map<string, GovernedCatalogPayload<System, Code>>();
  const inFlightCatalogLoads = new Map<string, Promise<GovernedCatalogPayload<System, Code>>>();

  function getPlaceholderCatalog(): GovernedCatalogPayload<System, Code> {
    return buildCatalogPayload(config, [...config.placeholderCodes], {
      licensed: false,
      source: 'local-placeholder',
      version: config.placeholderVersion,
      warning: config.licenseWarning,
    });
  }

  function normalizeCatalogPayload(
    payload: unknown,
    source: Exclude<GovernedCatalogSource, 'local-placeholder'>,
    etag?: string,
  ): GovernedCatalogPayload<System, Code> {
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
      .map((item) => sanitizeCatalogEntry<System, Code>(item, config.system))
      .filter((item): item is Code => Boolean(item));

    if (!sanitizedCodes.length) {
      return buildCatalogPayload(config, [...config.placeholderCodes], {
        licensed: false,
        source: source === 'backend' ? 'backend-placeholder' : source,
        version: config.placeholderVersion,
        warning:
          typeof payloadRecord?.warning === 'string' && payloadRecord.warning.trim()
            ? payloadRecord.warning.trim()
            : config.licenseWarning,
        etag,
      });
    }

    const licensed =
      typeof payloadRecord?.licensed === 'boolean'
        ? payloadRecord.licensed
        : source === 'env-json' || source === 'env-url';

    return buildCatalogPayload(config, sanitizedCodes, {
      licensed,
      source: licensed ? source : source === 'backend' ? 'backend-placeholder' : source,
      version: typeof payloadRecord?.version === 'string' ? payloadRecord.version : undefined,
      warning: typeof payloadRecord?.warning === 'string' ? payloadRecord.warning : undefined,
      etag,
    });
  }

  async function fetchCatalogFromUrl(
    sourceUrl: string,
    source: 'env-url' | 'backend',
  ): Promise<GovernedCatalogPayload<System, Code>> {
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
        throw new Error(`${config.system} catalog request failed (${response.status})`);
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
    return readRuntimeConfig(config.inlineEnvKeys);
  }

  function resolveCatalogUrl(): string | null {
    return readRuntimeConfig(config.urlEnvKeys);
  }

  function resolveCatalogEndpointUrl(): string {
    return `${config.apiBaseUrl}${config.endpointPath}`;
  }

  async function loadCatalog(): Promise<GovernedCatalogPayload<System, Code>> {
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

    return fetchCatalogFromUrl(resolveCatalogEndpointUrl(), 'backend');
  }

  return {
    getPlaceholderCatalog,
    loadCatalog,
    normalizeCatalogPayload,
    resolveCatalogEndpointUrl,
  };
}
