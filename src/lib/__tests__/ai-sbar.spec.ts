import { describe, expect, it, vi, afterEach } from 'vitest';

vi.mock('@/src/config/env', () => ({
  AI_BACKEND_BASE_URL: 'https://example.com',
}));

vi.mock('@/src/security/auth', () => ({
  ensureFreshAccessToken: vi.fn(async () => 'tok-test-456'),
}));

import { generateSbarViaBackend } from '../ai-sbar';

describe('generateSbarViaBackend', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('includes all sections and legal notice in fullText', async () => {
    const mockResponse = {
      situation: 'Paciente estable',
      background: 'Ingreso por neumonia',
      assessment: 'Mejora clinica',
      recommendation: 'Continuar antibiotico',
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const result = await generateSbarViaBackend('Nota libre', { source: 'test' }, 'es');

    expect(result.situation).toBe(mockResponse.situation);
    expect(result.background).toBe(mockResponse.background);
    expect(result.assessment).toBe(mockResponse.assessment);
    expect(result.recommendation).toBe(mockResponse.recommendation);
    expect(result.fullText).toContain('Aviso legal: Asistente de apoyo');
  });
});
