import { describe, expect, it, beforeEach, vi } from 'vitest';

import { generateSbarViaBackend } from '@/src/lib/ai-sbar';

vi.mock('@/src/config/env', () => ({ AI_BACKEND_BASE_URL: 'https://ai.test' }));

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface Global {
      fetch?: typeof fetch;
    }
  }
}

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  (globalThis as any).fetch = mockFetch;
});

describe('generateSbarViaBackend', () => {
  it('envía el cuerpo esperado al backend de IA', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        situation: 'S',
        background: 'B',
        assessment: 'A',
        recommendation: 'R',
        full_text: 'Texto completo',
      }),
    });

    const result = await generateSbarViaBackend('evolución', { vitals: { hr: 80 } }, 'es');

    expect(mockFetch).toHaveBeenCalledWith('https://ai.test/ai/summarize-sbar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ free_text: 'evolución', context: { vitals: { hr: 80 } }, language: 'es' }),
    });
    expect(result).toEqual({
      situation: 'S',
      background: 'B',
      assessment: 'A',
      recommendation: 'R',
      fullText: 'Texto completo',
    });
  });

  it('lanza error cuando el backend responde con error', async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) });

    await expect(generateSbarViaBackend('texto libre')).rejects.toThrow('No se pudo generar el SBAR con IA');
  });

  it('lanza error cuando la respuesta no contiene las claves esperadas', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    await expect(generateSbarViaBackend('texto libre')).rejects.toThrow('No se pudo generar el SBAR con IA');
  });
});
