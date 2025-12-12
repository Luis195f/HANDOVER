import { describe, expect, it } from 'vitest';
import { getUserFacingNetworkMessage, normalizeNetError } from '../src/lib/net-errors';

describe('normalizeNetError', () => {
  it('extracts HTTP status and retry-after from response context', () => {
    const response = new Response('unauthorized', {
      status: 401,
      statusText: 'Unauthorized',
      headers: { 'Retry-After': '5' },
    });

    const normalized = normalizeNetError(new Error('Unauthorized'), {
      response,
      url: 'https://api.example.com/login',
    });

    expect(normalized).toMatchObject({
      kind: 'HTTP',
      status: 401,
      url: 'https://api.example.com/login',
      retryAfterMs: 5000,
    });
  });

  it('detects offline errors from generic fetch failures', () => {
    const normalized = normalizeNetError(new Error('Network request failed'));
    expect(normalized.kind).toBe('OFFLINE');
  });
});

describe('getUserFacingNetworkMessage', () => {
  it('maps 401 to login CTA', () => {
    const { title, cta } = getUserFacingNetworkMessage({ kind: 'HTTP', status: 401 });
    expect(title).toBe('Sesión expirada');
    expect(cta?.action).toBe('LOGIN');
  });

  it('maps gateway timeouts to retry CTA', () => {
    const message = getUserFacingNetworkMessage({ kind: 'HTTP', status: 504 });
    expect(message.title).toContain('Servidor no disponible');
    expect(message.cta?.action).toBe('RETRY');
  });

  it('maps 403 to login CTA', () => {
    const message = getUserFacingNetworkMessage({ kind: 'HTTP', status: 403 });
    expect(message.title).toBe('Acceso restringido');
    expect(message.cta?.action).toBe('LOGIN');
  });

  it('maps offline to sync center CTA', () => {
    const message = getUserFacingNetworkMessage({ kind: 'OFFLINE' });
    expect(message.title).toBe('Sin conexión');
    expect(message.cta?.action).toBe('OPEN_SYNC');
  });
});
