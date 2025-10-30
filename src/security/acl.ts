import Constants from 'expo-constants';

function allowAllUnitsEnabled(): boolean {
  const extraFlag = (Constants?.expoConfig?.extra as any)?.ALLOW_ALL_UNITS;
  if (typeof extraFlag !== 'undefined') {
    return String(extraFlag) === '1';
  }

  return process.env.EXPO_PUBLIC_ALLOW_ALL_UNITS === '1';
}

const DEV_FLAG = (() => {
  try {
    const globalDev = (globalThis as Record<string, unknown> | undefined)?.__DEV__;
    if (typeof globalDev === 'boolean') {
      return globalDev;
    }
  } catch {
    // ignore
  }

  if (typeof process !== 'undefined') {
    const env = process.env.NODE_ENV;
    return env === 'development';
  }

  return false;
})();

type AllowedUnitsSource =
  | string[]
  | {
      allowedUnits?: string[] | null;
      units?: string[] | null;
      user?: { allowedUnits?: string[] | null; units?: string[] | null } | null;
    }
  | null
  | undefined;

function collectUnits(source: AllowedUnitsSource): string[] {
  if (Array.isArray(source)) {
    return source;
  }

  if (source && typeof source === 'object') {
    const fromRoot = Array.isArray(source.allowedUnits) ? source.allowedUnits : [];
    const fromUnits = Array.isArray(source.units) ? source.units : [];
    const fromUserAllowed = Array.isArray(source.user?.allowedUnits) ? source.user?.allowedUnits ?? [] : [];
    const fromUserUnits = Array.isArray(source.user?.units) ? source.user?.units ?? [] : [];
    return [...fromRoot, ...fromUnits, ...fromUserAllowed, ...fromUserUnits];
  }

  return [];
}

function normalizeList(values: AllowedUnitsSource): Set<string> {
  return new Set(
    collectUnits(values)
      .map((value) => value?.trim?.())
      .filter((value): value is string => Boolean(value))
  );
}

export function hasUnitAccess(unitId?: string | null, allowedUnits?: AllowedUnitsSource): boolean {
  const allowAll = allowAllUnitsEnabled() || DEV_FLAG;
  if (!unitId) return allowAll;
  if (allowAll) return true;

  const normalized = normalizeList(allowedUnits);
  if (normalized.has('*')) return true;
  return normalized.has(unitId);
}

