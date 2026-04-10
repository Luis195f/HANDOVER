import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NocCode } from '../nocCodes';

function buildLargeCatalog(size: number): NocCode[] {
  return Array.from({ length: size }, (_, index) => ({
    system: 'NOC',
    code: String(300000 + index),
    display: `Resultado de prueba ${index}`,
    synonyms: [`termino ${index}`],
  }));
}

describe('nocCodes', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.EXPO_PUBLIC_NOC_CATALOG_JSON;
    delete process.env.NOC_CATALOG_JSON;
    delete process.env.EXPO_PUBLIC_NOC_CATALOG_URL;
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('expone un catálogo placeholder con advertencia de licencia', async () => {
    const module = await import('../nocCodes');
    const catalog = module.getNocPlaceholderCatalog();

    expect(catalog.licensed).toBe(false);
    expect(catalog.warning).toBe(module.NOC_LICENSE_WARNING);
    expect(catalog.codes.length).toBeGreaterThan(0);
  });

  it('ignora catálogo inline público y carga el dataset por URL', async () => {
    process.env.EXPO_PUBLIC_NOC_CATALOG_JSON = JSON.stringify({
      licensed: true,
      version: 'bundle-inline-should-be-ignored',
      codes: [{ system: 'NOC', code: '0000', display: 'No debería entrar al bundle' }],
    });
    process.env.EXPO_PUBLIC_NOC_CATALOG_URL = 'https://terminology.example.test/noc.json';
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        licensed: true,
        version: 'noc-2026',
        codes: [{ system: 'NOC', code: '9999', display: 'Resultado licenciado' }],
      }),
      headers: new Headers(),
    } as Response);

    const module = await import('../nocCodes');
    const catalog = await module.loadNocCatalog();

    expect(fetch).toHaveBeenCalledWith(
      'https://terminology.example.test/noc.json',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(catalog.licensed).toBe(true);
    expect(catalog.version).toBe('noc-2026');
    expect(catalog.codes[0]?.code).toBe('9999');
  });

  it('hace fallback al placeholder cuando no hay dataset utilizable', async () => {
    process.env.EXPO_PUBLIC_NOC_CATALOG_URL = 'https://terminology.example.test/noc-empty.json';
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        licensed: true,
        version: 'empty',
        entries: [],
      }),
      headers: new Headers(),
    } as Response);

    const module = await import('../nocCodes');
    const catalog = await module.loadNocCatalog();

    expect(catalog.licensed).toBe(false);
    expect(catalog.codes[0]?.system).toBe('NOC');
    expect(catalog.warning).toBe(module.NOC_LICENSE_WARNING);
  });

  it('normaliza búsquedas sin acentos', async () => {
    const module = await import('../nocCodes');
    const catalog = module.getNocPlaceholderCatalog();
    const results = module.searchNocIndex(catalog.index, 'vias aereas');

    expect(results.some((item) => item.code === '0402')).toBe(true);
  });

  it('mantiene la búsqueda indexada fluida con datasets grandes', async () => {
    const module = await import('../nocCodes');
    const largeCatalog = buildLargeCatalog(12000);
    largeCatalog.push({
      system: 'NOC',
      code: '999999',
      display: 'Resultado escalable crítico',
      synonyms: ['catalogo grande critico'],
    });

    const index = module.buildNocSearchIndex(largeCatalog);
    const startedAt = Date.now();
    const results = module.searchNocIndex(index, 'catalogo critico', 10);
    const elapsedMs = Date.now() - startedAt;

    expect(results[0]?.code).toBe('999999');
    expect(elapsedMs).toBeLessThan(250);
  });
});
