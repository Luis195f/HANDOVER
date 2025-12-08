// tests/security/auth.spec.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as SecureStore from 'expo-secure-store';

// ⚙️ Config común para TODOS los tests de sesión
beforeEach(() => {
  // 1) Resetear el mock de SecureStore entre tests (si expone __reset)
  const secureAsAny = SecureStore as any;
  if (typeof secureAsAny.__reset === 'function') {
    secureAsAny.__reset();
  } else {
    // Fallback por si acaso
    void SecureStore.deleteItemAsync('session');
  }

  // 2) Mock global de fetch para que loginWithOAuth pueda llamar al /userinfo
  const globalAny = globalThis as any;
  globalAny.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      sub: 'user-123',
      email: 'stored@example.com',
      roles: ['nurse'],
      units: ['icu-a'],
    }),
  }));
});

describe('auth session', () => {
  it('getCurrentSession returns null when there is no stored session', async () => {
    const { getCurrentSession } = await import('@/src/security/auth');

    const session = await getCurrentSession();
    expect(session).toBeNull();
  });

  it('loginWithOAuth stores session and getCurrentSession returns it', async () => {
    const { getCurrentSession, loginWithOAuth } = await import('@/src/security/auth');

    // Hace todo el flujo real de login (pero con mocks de AuthSession, fetch, etc.)
    const sessionFromLogin = (await loginWithOAuth()) as any;

    // Luego hidrata desde SecureStore
    const hydrated = (await getCurrentSession()) as any;

    expect(hydrated).not.toBeNull();

    // Debe ser el mismo modelo que devolvió loginWithOAuth
    expect(hydrated).toEqual(sessionFromLogin);

    // Y además debe incorporar la info del userinfo mockeado
    expect(hydrated.userId).toBe('user-123');
    expect(hydrated.email).toBe('stored@example.com');
    expect(hydrated.roles).toContain('nurse');
    expect(hydrated.units).toContain('icu-a');
    expect(typeof hydrated.expiresAt).toBe('string');
  });

  it('logout clears persisted session', async () => {
    const { getCurrentSession, loginWithOAuth, logout } = await import('@/src/security/auth');

    await loginWithOAuth();
    await logout();

    const afterLogout = await getCurrentSession();
    expect(afterLogout).toBeNull();
  });
});

