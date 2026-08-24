import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const secureStoreState: Record<string, string | null> = {};

vi.mock('expo-web-browser', () => ({ maybeCompleteAuthSession: vi.fn() }));
vi.mock('expo-auth-session', () => ({
  ResponseType: { Code: 'code' },
  AuthRequest: class {},
  fetchDiscoveryAsync: vi.fn(),
  makeRedirectUri: vi.fn(() => 'app://redirect'),
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (key: string) => secureStoreState[key] ?? null),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    secureStoreState[key] = value;
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    delete secureStoreState[key];
  }),
}));

function resetSecureStore() {
  Object.keys(secureStoreState).forEach((key) => delete secureStoreState[key]);
}

describe('multiuser auth session', () => {
  beforeEach(() => {
    resetSecureStore();
    vi.resetModules();
  });

  it('persists and retrieves a session', async () => {
    const session = {
      userId: 'nurse-1',
      displayName: 'Nurse Example',
      roles: ['nurse'],
      units: ['UCI-A'],
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };

    const { getCurrentSession, setCurrentSession } = await import('@/src/security/auth');

    await setCurrentSession(session);
    const restored = await getCurrentSession();

    expect(restored).toMatchObject({
  userId: 'nurse-1',
  displayName: 'Nurse Example',
  roles: ['nurse'],
  units: ['UCI-A'],
  accessToken: 'access-token',
  refreshToken: 'refresh-token',
});

  });

  it('clears session', async () => {
    const session = {
      userId: 'nurse-1',
      roles: ['nurse'],
      units: ['UCI-A'],
      accessToken: 'access-token',
    };
    const { getCurrentSession, setCurrentSession } = await import('@/src/security/auth');

    await setCurrentSession(session);
    await setCurrentSession(null);

    const restored = await getCurrentSession();
    expect(restored).toBeNull();
  });

  it('works with ACL helpers', async () => {
    const session = {
      userId: 'nurse-1',
      roles: ['nurse'],
      units: ['UCI-ADULTO'],
      accessToken: 'tk',
    };

    const { ensureRole, ensureUnitAccess } = await import('@/src/security/acl');

    expect(() => ensureRole(session, 'nurse')).not.toThrow();
    expect(() => ensureRole(session, 'admin' as never)).toThrowError();
    expect(() => ensureUnitAccess(session, 'UCI-ADULTO')).not.toThrow();
    expect(() => ensureUnitAccess(session, 'PEDIATRIA')).toThrowError();
  });
});

describe('user switch', () => {
  beforeEach(() => {
    resetSecureStore();
    vi.resetModules();
  });

  it('remembers recent users in order', async () => {
    const { createUserSwitchStorage, listRecentUsers, rememberUser } = await import('@/src/security/user-switch');
    const storage = createUserSwitchStorage('test:users');

    await rememberUser(
      storage,
      { userId: 'u1', displayName: 'One', roles: [], units: [], accessToken: 't1' },
      () => new Date('2024-01-01T10:00:00.000Z'),
    );
    await rememberUser(
      storage,
      { userId: 'u2', displayName: 'Two', roles: [], units: [], accessToken: 't2' },
      () => new Date('2024-01-01T11:00:00.000Z'),
    );
    await rememberUser(
      storage,
      { userId: 'u3', displayName: 'Three', roles: [], units: [], accessToken: 't3' },
      () => new Date('2024-01-01T12:00:00.000Z'),
    );

    const users = await listRecentUsers(storage);
    expect(users.map((u) => u.userId)).toEqual(['u3', 'u2', 'u1']);
  });

  it('deduplicates repeated users', async () => {
    const { createUserSwitchStorage, listRecentUsers, rememberUser } = await import('@/src/security/user-switch');
    const storage = createUserSwitchStorage('test:users');

    await rememberUser(
      storage,
      { userId: 'u1', displayName: 'One', roles: [], units: [], accessToken: 't1' },
      () => new Date('2024-01-01T10:00:00.000Z'),
    );
    await rememberUser(
      storage,
      { userId: 'u1', displayName: 'One', roles: [], units: [], accessToken: 't1' },
      () => new Date('2024-01-01T12:00:00.000Z'),
    );

    const users = await listRecentUsers(storage);
    expect(users).toHaveLength(1);
    expect(users[0].lastUsedAt).toBe('2024-01-01T12:00:00.000Z');
  });

  it('limits the maximum number of users', async () => {
    const { createUserSwitchStorage, listRecentUsers, rememberUser } = await import('@/src/security/user-switch');
    const storage = createUserSwitchStorage('test:users');

    for (let i = 0; i < 10; i += 1) {
      await rememberUser(
        storage,
        { userId: `u${i}`, roles: [], units: [], accessToken: `t${i}` },
        () => new Date(`2024-01-01T0${i % 10}:00:00.000Z`),
      );
    }

    const users = await listRecentUsers(storage, 5);
    expect(users).toHaveLength(5);
    expect(users[0].userId).toBe('u9');
    expect(users[4].userId).toBe('u5');
  });

  it('clears all users', async () => {
    const { createUserSwitchStorage, clearAllUsers, listRecentUsers, rememberUser } = await import('@/src/security/user-switch');
    const storage = createUserSwitchStorage('test:users');

    await rememberUser(
      storage,
      { userId: 'u1', roles: [], units: [], accessToken: 't1' },
      () => new Date('2024-01-01T10:00:00.000Z'),
    );

    await clearAllUsers(storage);

    const users = await listRecentUsers(storage);
    expect(users).toEqual([]);
  });
});

describe('demo actor session switch', () => {
  const originalDev = (globalThis as { __DEV__?: boolean }).__DEV__;
  const originalDemoFlag = process.env.EXPO_PUBLIC_ENABLE_DEMO;

  beforeEach(() => {
    resetSecureStore();
    vi.resetModules();
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
  });

  afterEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = originalDev;
    process.env.EXPO_PUBLIC_ENABLE_DEMO = originalDemoFlag;
  });

  it('switches between distinct demo sessions without widening role or unit scope', async () => {
    process.env.EXPO_PUBLIC_ENABLE_DEMO = 'true';
    const { DEMO_RECEIVER_USER_ID, DEMO_USER_ID } = await import('@/src/demo/fixtures');
    const { getCurrentSession, loginDemo, switchDemoActor } = await import('@/src/security/auth');

    const outgoing = await loginDemo();
    const incoming = await switchDemoActor(DEMO_RECEIVER_USER_ID);

    expect(outgoing.userId).toBe(DEMO_USER_ID);
    expect(incoming.userId).toBe(DEMO_RECEIVER_USER_ID);
    expect(incoming.userId).not.toBe(outgoing.userId);
    expect(incoming.roles).toEqual(outgoing.roles);
    expect(incoming.units).toEqual(outgoing.units);
    await expect(getCurrentSession()).resolves.toMatchObject({
      userId: DEMO_RECEIVER_USER_ID,
      mode: 'demo',
    });
  });

  it('rejects switching from an operational session even when the public flag is enabled', async () => {
    process.env.EXPO_PUBLIC_ENABLE_DEMO = 'true';
    const { DEMO_RECEIVER_USER_ID } = await import('@/src/demo/fixtures');
    const { getCurrentSession, setCurrentSession, switchDemoActor } = await import('@/src/security/auth');

    await setCurrentSession({
      userId: 'operational-user',
      displayName: 'Operational User',
      roles: ['nurse'],
      units: ['unit-1'],
      accessToken: 'operational-token',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      mode: 'normal',
    });

    await expect(switchDemoActor(DEMO_RECEIVER_USER_ID)).rejects.toThrowError(
      'DEMO_ACTOR_SWITCH_FORBIDDEN',
    );
    await expect(getCurrentSession()).resolves.toMatchObject({ userId: 'operational-user' });
  });

  it('rejects switching a demo session when the explicit public flag is absent', async () => {
    delete process.env.EXPO_PUBLIC_ENABLE_DEMO;
    const { DEMO_RECEIVER_USER_ID, ensureDemoSessionTemplate } = await import('@/src/demo/fixtures');
    const { setCurrentSession, switchDemoActor } = await import('@/src/security/auth');

    await setCurrentSession(ensureDemoSessionTemplate());

    await expect(switchDemoActor(DEMO_RECEIVER_USER_ID)).rejects.toThrowError(
      'DEMO_ACTOR_SWITCH_FORBIDDEN',
    );
  });
});
