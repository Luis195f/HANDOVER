import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchInterventionsSuggestions,
  type ClinicalContext,
  type SuggestionsResult,
} from '@/src/lib/ai-suggestions';

vi.mock('@/src/config/env', () => ({ AI_BACKEND_BASE_URL: 'https://ai.example' }));

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

describe('fetchInterventionsSuggestions', () => {
  const ctx: ClinicalContext = {
    language: 'es',
    section: 'vitals',
    vitalSigns: { heartRate: 90 },
    scores: { news2: 2 },
  };

  it('envía el contexto clínico y devuelve las sugerencias', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ interventions: ['Oxigenoterapia'], rationale: 'Basado en signos', section: 'vitals' }),
    });

    const result = await fetchInterventionsSuggestions(ctx);

    expect(mockFetch).toHaveBeenCalledWith('https://ai.example/ai/suggest-interventions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ctx),
    });
    expect(result).toEqual<SuggestionsResult>({
      section: 'vitals',
      interventions: ['Oxigenoterapia'],
      rationale: 'Basado en signos',
    });
  });

  it('lanza error cuando la respuesta del backend es inválida', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    await expect(fetchInterventionsSuggestions(ctx)).rejects.toThrow('Respuesta de IA no válida');
  });

  it('lanza error cuando el backend responde con estado de error', async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({ message: 'fail' }) });

    await expect(fetchInterventionsSuggestions(ctx)).rejects.toThrow(
      'No se pudieron obtener sugerencias de intervenciones',
    );
  });
});
