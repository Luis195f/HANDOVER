import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NicCode } from '../nicCodes';

function buildLargeCatalog(size: number): NicCode[] {
  return Array.from({ length: size }, (_, index) => ({
    system: 'NIC',
    code: String(200000 + index),
    display: `Intervencion de prueba ${index}`,
    synonyms: [`termino ${index}`],
  }));
}

describe('nicCodes', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.EXPO_PUBLIC_NIC_CATALOG_JSON;
    delete process.env.NIC_CATALOG_JSON;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('expone un catálogo placeholder con advertencia de licencia', async () => {
    const module = await import('../nicCodes');
    const catalog = module.getNicPlaceholderCatalog();

    expect(catalog.licensed).toBe(false);
    expect(catalog.warning).toBe(module.NIC_LICENSE_WARNING);
    expect(catalog.codes.length).toBeGreaterThan(0);
  });

  it('carga catálogo inline licenciado por env', async () => {
    process.env.EXPO_PUBLIC_NIC_CATALOG_JSON = JSON.stringify({
      licensed: true,
      version: 'nic-2026',
      codes: [{ system: 'NIC', code: '9999', display: 'Intervención licenciada' }],
    });

    const module = await import('../nicCodes');
    const catalog = await module.loadNicCatalog();

    expect(catalog.licensed).toBe(true);
    expect(catalog.version).toBe('nic-2026');
    expect(catalog.codes[0]?.code).toBe('9999');
  });

  it('hace fallback al placeholder cuando no hay dataset utilizable', async () => {
    process.env.EXPO_PUBLIC_NIC_CATALOG_JSON = JSON.stringify({
      licensed: true,
      version: 'empty',
      codes: [],
    });

    const module = await import('../nicCodes');
    const catalog = await module.loadNicCatalog();

    expect(catalog.licensed).toBe(false);
    expect(catalog.codes[0]?.system).toBe('NIC');
    expect(catalog.warning).toBe(module.NIC_LICENSE_WARNING);
  });

  it('normaliza búsquedas sin acentos', async () => {
    const module = await import('../nicCodes');
    const catalog = module.getNicPlaceholderCatalog();
    const results = module.searchNicIndex(catalog.index, 'analgesicos');

    expect(results.some((item) => item.code === '2210')).toBe(true);
  });

  it('mantiene la búsqueda indexada fluida con datasets grandes', async () => {
    const module = await import('../nicCodes');
    const largeCatalog = buildLargeCatalog(12000);
    largeCatalog.push({
      system: 'NIC',
      code: '999999',
      display: 'Intervención escalable crítica',
      synonyms: ['catalogo grande critico'],
    });

    const index = module.buildNicSearchIndex(largeCatalog);
    const startedAt = Date.now();
    const results = module.searchNicIndex(index, 'catalogo critico', 10);
    const elapsedMs = Date.now() - startedAt;

    expect(results[0]?.code).toBe('999999');
    expect(elapsedMs).toBeLessThan(250);
  });
});
