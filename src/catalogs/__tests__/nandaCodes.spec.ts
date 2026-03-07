import { describe, expect, it } from 'vitest';

import type { DiagnosisCode } from '../diagnosisCodes';
import {
  buildDiagnosisSearchIndex,
  getNandaPlaceholderCatalog,
  NANDA_LICENSE_WARNING,
  searchDiagnosisIndex,
} from '../nandaCodes';

function buildLargeCatalog(size: number): DiagnosisCode[] {
  return Array.from({ length: size }, (_, index) => ({
    system: 'NANDA',
    code: String(100000 + index),
    display: `Diagnostico de prueba ${index}`,
    synonyms: [`termino ${index}`],
  }));
}

describe('nandaCodes', () => {
  it('expone un catálogo placeholder con advertencia de licencia', () => {
    const catalog = getNandaPlaceholderCatalog();

    expect(catalog.licensed).toBe(false);
    expect(catalog.warning).toBe(NANDA_LICENSE_WARNING);
    expect(catalog.codes.length).toBeGreaterThan(0);
  });

  it('normaliza búsquedas sin acentos', () => {
    const catalog = getNandaPlaceholderCatalog();
    const results = searchDiagnosisIndex(catalog.index, 'oxigenacion');

    expect(results.some((item) => item.code === '00001')).toBe(true);
  });

  it('mantiene la búsqueda indexada fluida con datasets grandes', () => {
    const largeCatalog = buildLargeCatalog(12000);
    largeCatalog.push({
      system: 'NANDA',
      code: '999999',
      display: 'Diagnostico escalable critico',
      synonyms: ['catalogo grande critico'],
    });

    const index = buildDiagnosisSearchIndex(largeCatalog);
    const startedAt = Date.now();
    const results = searchDiagnosisIndex(index, 'catalogo critico', 10);
    const elapsedMs = Date.now() - startedAt;

    expect(results[0]?.code).toBe('999999');
    expect(elapsedMs).toBeLessThan(250);
  });
});
