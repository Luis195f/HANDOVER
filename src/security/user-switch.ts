import { secureDeleteItem, secureGetItem, secureSetItem } from './secure-storage';
import type { HandoverSession } from './auth-types';

export interface RecentUser {
  userId: string;
  displayName?: string;
  lastUsedAt: string; // ISO
}

export interface UserSwitchStorage {
  load(): Promise<RecentUser[]>;
  save(users: RecentUser[]): Promise<void>;
}

const DEFAULT_KEY = `${process.env.EXPO_PUBLIC_STORAGE_NAMESPACE ?? 'handover'}:recent-users`;
const MAX_USERS = 5;

type StorageParser = (raw: string | null) => RecentUser[];

function parseUsers(raw: string | null): RecentUser[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is RecentUser => typeof item?.userId === 'string' && typeof item?.lastUsedAt === 'string');
  } catch {
    return [];
  }
}

async function loadUsers(key: string, parse: StorageParser): Promise<RecentUser[]> {
  const raw = await secureGetItem(key);
  return parse(raw);
}

export function createUserSwitchStorage(key: string = DEFAULT_KEY, parser: StorageParser = parseUsers): UserSwitchStorage {
  return {
    async load() {
      return loadUsers(key, parser);
    },
    async save(users: RecentUser[]) {
      if (!users.length) {
        await secureDeleteItem(key);
        return;
      }
      await secureSetItem(key, JSON.stringify(users));
    },
  };
}

export async function rememberUser(
  storage: UserSwitchStorage,
  session: HandoverSession,
  now: () => Date = () => new Date(),
): Promise<void> {
  const users = await storage.load();
  const lastUsedAt = now().toISOString();
  const filtered = users.filter((user) => user.userId !== session.userId);
  const updated: RecentUser[] = [
    {
      userId: session.userId,
      displayName: session.displayName,
      lastUsedAt,
    },
    ...filtered,
  ];
  const limited = updated.slice(0, MAX_USERS);
  await storage.save(limited);
}

export async function listRecentUsers(storage: UserSwitchStorage, limit?: number): Promise<RecentUser[]> {
  const users = await storage.load();
  const sorted = [...users].sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
  if (typeof limit === 'number' && limit >= 0) {
    return sorted.slice(0, limit);
  }
  return sorted;
}

export async function clearAllUsers(storage: UserSwitchStorage): Promise<void> {
  await storage.save([]);
}
