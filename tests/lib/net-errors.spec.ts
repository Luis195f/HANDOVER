import { describe, expect, it } from 'vitest';

import { getUserFacingNetworkMessage, normalizeNetError } from '@/src/lib/net-errors';

describe('getUserFacingNetworkMessage + normalizeNetError', () => {
  it('maps 401 errors to login prompt', () => {
    const ui = getUserFacingNetworkMessage({ kind: 'HTTP', status: 401 });

    expect(ui.title).toBe('Sesión expirada');
    expect(ui.cta).toEqual({ label: 'Iniciar sesión', action: 'LOGIN' });
  });

  it('maps 504 errors to retry prompt', () => {
    const ui = getUserFacingNetworkMessage({ kind: 'HTTP', status: 504 });

    expect(ui.title).toContain('Servidor');
    expect(ui.cta).toEqual({ label: 'Reintentar', action: 'RETRY' });
  });

  it('detects offline errors and suggests opening sync center', () => {
    const normalized = normalizeNetError(new Error('Network request failed'));
    const ui = getUserFacingNetworkMessage(normalized);

    expect(normalized.kind).toBe('OFFLINE');
    expect(ui.title).toBe('Sin conexión');
    expect(ui.cta).toEqual({ label: 'Ver estado de envío', action: 'OPEN_SYNC' });
  });
});
