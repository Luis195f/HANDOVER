import { describe, expect, it, vi } from 'vitest';

import { apiGet } from '@/src/lib/api';
import { fetchWithRetry } from '@/src/lib/net';

// IMPORTANTE:
// apiGet ahora llama ensureFreshAccessToken() antes de hacer requests.
// Este test mockeaba auth pero no incluía ese export, causando fallo.
vi.mock('@/src/security/auth', () => ({
  getCurrentSession: vi.fn(async () => ({ mode: 'demo' })),
  // Para compatibilidad con la nueva capa de "fresh token" antes de llamadas HTTP
  ensureFreshAccessToken: vi.fn(async () => 'test-access-token'),
  // Si en algún punto se importa el alias/función antigua, también lo cubrimos
  ensureFreshToken: vi.fn(async () => 'test-access-token'),
}));

describe('Demo mode network interception', () => {
  it('intercepta fetchWithRetry en modo demo', async () => {
    const fetchSpy = vi.fn();

    const res = await fetchWithRetry('https://demo.hospital/api/ping', { fetchImpl: fetchSpy });
    const body = await res.json();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(body).toMatchObject({ mode: 'demo' });
  });

  it('intercepta apiGet y devuelve datos mock', async () => {
    const data = await apiGet('/api/ping');
    expect(data).toMatchObject({ mode: 'demo' });
  });
});
