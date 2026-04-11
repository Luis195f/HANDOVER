import { apiGet } from '@/src/lib/api';
import type { RootStackParamList } from '@/src/navigation/types';
import { secureDeleteItem, secureGetItem, secureSetItem } from '@/src/security/secure-storage';

export type CapabilityPermissions = {
  canWriteHandover: boolean;
  canReadPatients: boolean;
  canCreatePatients: boolean;
  canSignHandover: boolean;
  canViewAudit: boolean;
  canSendAuditEvents: boolean;
  isAdmin: boolean;
};

export type FhirProfile = {
  canonical: string;
  version?: string;
  title?: string;
};

export type FhirCapabilities = {
  version: string;
  transaction: boolean;
  profiles: FhirProfile[];
};

export type Capabilities = {
  userSub: string;
  roles: string[];
  scopes: string[];
  unitIds: string[];
  permissions: CapabilityPermissions;
  fhir?: FhirCapabilities;
};

export type RouteName = keyof RootStackParamList;

const STORAGE_NAMESPACE = (process.env.EXPO_PUBLIC_STORAGE_NAMESPACE ?? 'handover').replace(
  /[^a-zA-Z0-9._-]/g,
  '_',
);
const CAPABILITIES_KEY = `${STORAGE_NAMESPACE}_capabilities`;
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

type CapabilitiesCacheEntry = {
  capabilities: Capabilities;
  cachedAt: number;
};

let memoryCache: CapabilitiesCacheEntry | null = null;
let inflight: Promise<Capabilities | null> | null = null;

function isCapabilities(value: unknown): value is Capabilities {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Capabilities;
  return (
    typeof candidate.userSub === 'string' &&
    Array.isArray(candidate.roles) &&
    Array.isArray(candidate.scopes) &&
    typeof candidate.permissions === 'object' &&
    candidate.permissions !== null
  );
}

function isCacheEntry(value: unknown): value is CapabilitiesCacheEntry {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as CapabilitiesCacheEntry;
  return (
    typeof candidate.cachedAt === 'number' &&
    isCapabilities(candidate.capabilities)
  );
}

function parseCapabilities(raw: string | null): CapabilitiesCacheEntry | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isCacheEntry(parsed)) return parsed;
    if (isCapabilities(parsed)) {
      return { capabilities: parsed, cachedAt: 0 };
    }
    return null;
  } catch {
    return null;
  }
}

function isFresh(cache: CapabilitiesCacheEntry, maxAgeMs: number): boolean {
  return maxAgeMs >= 0 && Date.now() - cache.cachedAt <= maxAgeMs;
}

async function persistCapabilitiesCache(entry: CapabilitiesCacheEntry): Promise<void> {
  memoryCache = entry;
  await secureSetItem(CAPABILITIES_KEY, JSON.stringify(entry));
}

async function hydrateCapabilitiesCache(): Promise<CapabilitiesCacheEntry | null> {
  if (memoryCache) return memoryCache;
  const stored = await secureGetItem(CAPABILITIES_KEY);
  const parsed = parseCapabilities(stored);
  if (parsed) memoryCache = parsed;
  return memoryCache;
}

export function getDemoCapabilities(userSub = 'demo-user'): Capabilities {
  return {
    userSub,
    roles: ['nurse'],
    scopes: ['handover:write', 'fhir:transaction'],
    unitIds: [],
    permissions: {
      canWriteHandover: true,
      canReadPatients: true,
      canCreatePatients: true,
      // ✅ Nurse NO firma entregas (reservado a supervisor/admin)
      canSignHandover: false,
      // ✅ si quieres que demo vea auditoría, déjalo true; si no, pon false
      canViewAudit: false,
      canSendAuditEvents: false,
      isAdmin: false,
    },
    fhir: {
      version: 'R4',
      transaction: true,
      profiles: [
        {
          canonical: 'http://hl7.org/fhir/StructureDefinition/Bundle',
          version: '4.0.1',
          title: 'FHIR R4 Bundle',
        },
      ],
    },
  };
}

export async function fetchCapabilities(
  options: { forceRefresh?: boolean; maxAgeMs?: number } = {},
): Promise<Capabilities | null> {
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;

  if (!options.forceRefresh && !memoryCache) {
    await hydrateCapabilitiesCache();
  }

  if (!options.forceRefresh && memoryCache && isFresh(memoryCache, maxAgeMs)) {
    return memoryCache.capabilities;
  }

  if (!options.forceRefresh && inflight) {
    const result = await inflight;
    return result ?? memoryCache?.capabilities ?? null;
  }

  inflight = (async () => {
    try {
      const fresh = (await apiGet('/api/me/capabilities')) as Capabilities;

      if (isCapabilities(fresh)) {
        const next = { capabilities: fresh, cachedAt: Date.now() };

        // ✅ IMPORTANTE: actualiza cache en memoria SIEMPRE
        memoryCache = next;

        // persistencia (disco/secure store)
        await persistCapabilitiesCache(next);

        // ✅ devuelve el fresh inmediatamente (evita null)
        return fresh;
      }
    } catch (error) {
      const status = (error as { status?: number }).status;
      const message = (error as { message?: string }).message ?? '';
      const isAuthError =
        status === 401 ||
        status === 403 ||
        /^401\b/.test(message) ||
        /^403\b/.test(message);

      if (isAuthError) {
        await invalidateCapabilitiesCache();
        throw error;
      }

      // keep cached capabilities if network fails
    } finally {
      inflight = null;
    }

    return memoryCache?.capabilities ?? null;
  })();

  const updated = await inflight;
  return updated ?? memoryCache?.capabilities ?? null;
}

export async function invalidateCapabilitiesCache(): Promise<void> {
  memoryCache = null;
  inflight = null;
  await secureDeleteItem(CAPABILITIES_KEY);
}

export async function clearCapabilitiesCache(): Promise<void> {
  await invalidateCapabilitiesCache();
}

export function canAccess(route: RouteName, capabilities: Capabilities | null | undefined): boolean {
  if (!capabilities) return false;
  const perms = capabilities.permissions;
  const roles = capabilities.roles;

  switch (route) {
    case 'HandoverMain':
    case 'HandoverForm':
    case 'AudioNote':
    case 'ShiftDetails':
    case 'QRScan':
    case 'SyncCenter':
      return perms.canWriteHandover;
    case 'PatientList':
    case 'PatientDashboard':
      return perms.canReadPatients;
    case 'AuditLog':
      return perms.canViewAudit;
    case 'SupervisorDashboard':
      return perms.canSignHandover && (roles.includes('supervisor') || roles.includes('admin'));
    case 'AdminDashboard':
      return roles.includes('admin') || roles.includes('supervisor');
    case 'Login':
    case 'Onboarding':
    case 'Unauthorized':
    case 'PrivacyConsent':
    case 'PrivacyPolicy':
      return true;
    default:
      return false;
  }
}
