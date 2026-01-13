import { describe, expect, it } from 'vitest';

import { getUserFacingNetworkMessage, normalizeNetError } from '@/src/lib/net-errors';

describe('getUserFacingNetworkMessage + normalizeNetError', () => {
  it('maps 401 errors to login prompt', () => {
    const ui = getUserFacingNetworkMessage({ kind: 'HTTP', status: 401 }, { log: false });

    expect(ui.title).toBe('Sesión expirada');
    expect(ui.cta).toEqual({ label: 'Iniciar sesión', action: 'LOGIN' });
  });

  it('maps 403 errors to permissions copy', () => {
    const ui = getUserFacingNetworkMessage({ kind: 'HTTP', status: 403 }, { log: false });

    expect(ui.title).toContain('Permisos insuficientes');
    expect(ui.cta).toEqual({ label: 'Entendido', action: 'DISMISS' });
  });

  it('maps 500 errors to server error copy', () => {
    const ui = getUserFacingNetworkMessage({ kind: 'HTTP', status: 500 }, { log: false });

    expect(ui.title).toContain('Error del servidor');
    expect(ui.cta).toEqual({ label: 'Reintentar', action: 'RETRY' });
  });

  it('detects offline errors and suggests opening sync center', () => {
    const normalized = normalizeNetError(new Error('Network request failed'));
    const ui = getUserFacingNetworkMessage(normalized, { log: false });

    expect(normalized.kind).toBe('OFFLINE');
    expect(ui.title).toBe('Sin conexión');
    expect(ui.cta).toEqual({ label: 'Ver cola', action: 'OPEN_SYNC' });
  });

  it('maps timeout errors to timeout copy', () => {
    const normalized = normalizeNetError({ name: 'AbortError' });
    const ui = getUserFacingNetworkMessage(normalized, { log: false });

    expect(ui.title).toContain('Tiempo de espera');
    expect(ui.cta).toEqual({ label: 'Reintentar', action: 'RETRY' });
  });

  it('maps unknown errors to default copy', () => {
    const normalized = normalizeNetError(new Error('Unexpected failure'));
    const ui = getUserFacingNetworkMessage(normalized, { log: false });

    expect(ui.title).toBe('No se pudo completar');
  });
});
