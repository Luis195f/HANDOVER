import { describe, expect, it } from 'vitest';

import { DIAGNOSIS_CODES, filterDiagnosisCodes } from '../diagnosisCodes';

describe('filterDiagnosisCodes', () => {
  it('devuelve coincidencias por display', () => {
    const result = filterDiagnosisCodes('ansiedad');
    const match = result.find((code) => code.code === '00146');
    expect(match?.display).toBe('Ansiedad');
  });

  it('filtra por sistemas permitidos y sinónimos', () => {
    const result = filterDiagnosisCodes('dm2', ['SNOMED']);
    expect(result.some((code) => code.code === '44054006')).toBe(true);
    expect(result.every((code) => code.system === 'SNOMED')).toBe(true);
  });

  it('devuelve vacío sin coincidencias', () => {
    expect(filterDiagnosisCodes('no existe')).toEqual([]);
  });

  it('omite resultados si no hay query', () => {
    expect(filterDiagnosisCodes('   ')).toEqual([]);
    expect(filterDiagnosisCodes('')).toEqual([]);
  });

  it('honra systemsAllowed', () => {
    const result = filterDiagnosisCodes('ansiedad', ['SNOMED']);
    expect(result).toEqual([]);
  });
});
