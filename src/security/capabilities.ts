import { apiGet } from '@/src/lib/api';
import type { RootStackParamList } from '@/src/navigation/types';
import { secureDeleteItem, secureGetItem, secureSetItem } from '@/src/security/secure-storage';

export type CapabilityPermissions = {
  canWriteHandover: boolean;
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
  permissions: CapabilityPermissions;
  fhir?: FhirCapabilities;
};

export type RouteName = keyof RootStackParamList;

const STORAGE_NAMESPACE = (process.env.EXPO_PUBLIC_STORAGE_NAMESPACE ?? 'handover').replace(
  /[^a-zA-Z0-9._-]/g,
  '_',
);
const CAPABILITIES_KEY = `${STORAGE_NAMESPACE}_capabilities`;

let memoryCache: Capabilities | null = null;
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

function parseCapabilities(raw: string | null): Capabilities | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isCapabilities(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function hydrateCapabilitiesCache(): Promise<Capabilities | null> {
  if (memoryCache) return memoryCache;
  const stored = await secureGetItem(CAPABILITIES_KEY);
  const parsed = parseCapabilities(stored);
  if (parsed) memoryCache = parsed;
  return memoryCache;
}

export function getDemoCapabilities(userSub = 'demo-user'): Capabilities {
  return {
    userSub,
    roles: ['admin'],
    scopes: ['handover:write', 'audit:read', 'audit:write', 'fhir:transaction'],
    permissions: {
      canWriteHandover: true,
      canSignHandover: true,
      canViewAudit: true,
      canSendAuditEvents: true,
      isAdmin: true,
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

export async function fetchCapabilities(options: { forceRefresh?: boolean } = {}): Promise<Capabilities | null> {
  if (memoryCache && !options.forceRefresh) return memoryCache;
  if (!options.forceRefresh && !memoryCache) {
    await hydrateCapabilitiesCache();
  }

  if (!options.forceRefresh && inflight) return inflight;

  inflight = (async () => {
    try {
      const fresh = (await apiGet('/api/me/capabilities')) as Capabilities;
      if (isCapabilities(fresh)) {
        memoryCache = fresh;
        await secureSetItem(CAPABILITIES_KEY, JSON.stringify(fresh));
      }
    } catch {
      // keep cached capabilities if network fails
    } finally {
      inflight = null;
    }
    return memoryCache;
  })();

  return inflight;
}

export async function clearCapabilitiesCache(): Promise<void> {
  memoryCache = null;
  inflight = null;
  await secureDeleteItem(CAPABILITIES_KEY);
}

export function canAccess(route: RouteName, capabilities: Capabilities | null | undefined): boolean {
  if (!capabilities) return false;
  const perms = capabilities.permissions;

  switch (route) {
    case 'HandoverMain':
    case 'HandoverForm':
    case 'AudioNote':
    case 'ShiftDetails':
    case 'QRScan':
    case 'SyncCenter':
    case 'PatientList':
    case 'PatientDashboard':
      return perms.canWriteHandover;
    case 'AuditLog':
      return perms.canViewAudit;
    case 'SupervisorDashboard':
      return perms.canSignHandover;
    case 'AdminDashboard':
      return perms.isAdmin;
    case 'Login':
    case 'Onboarding':
    case 'Unauthorized':
    case 'PrivacyConsent':
    case 'PrivacyPolicy':
      return true;
    default:
      return true;
  }
}
