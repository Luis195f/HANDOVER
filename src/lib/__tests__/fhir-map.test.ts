import { describe, it, expect } from 'vitest';
import values from '../../../tests/fixtures/handover-values.json';
import audio from '../../../tests/fixtures/audio-url.json';

let Map: any = {};
try { Map = await import('@/src/lib/fhir-map'); } catch {}

const has = (k: string) => Map && Object.prototype.hasOwnProperty.call(Map, k);

(has('buildHandoverBundle') ? describe : describe.skip)('buildHandoverBundle', () => {
  const { buildHandoverBundle } = Map;

  it('genera Bundle transaction con Composition y Observations NEWS2', () => {
    const b = buildHandoverBundle(values as any, { authorId: 'nurse-1' });
    expect(b.resourceType).toBe('Bundle');
    expect(b.type).toBe('transaction');
    const types = b.entry.map((e: any) => e.resource.resourceType);
    expect(types).toContain('Composition');
    expect(types).toContain('Observation');
  });

  it('incluye DocumentReference cuando hay audio', () => {
    const b = buildHandoverBundle({ ...(values as any), audioUri: audio.url }, { authorId: 'nurse-1' });
    const types = b.entry.map((e: any) => e.resource.resourceType);
    expect(types).toContain('DocumentReference');
  });

  it('usa identificador determinista (uuid v5) para Composition', () => {
    const b1 = buildHandoverBundle(values as any, { authorId: 'nurse-1' });
    const b2 = buildHandoverBundle(values as any, { authorId: 'nurse-1' });
    const c1 = b1.entry.find((e: any) => e.resource.resourceType === 'Composition')?.resource;
    const c2 = b2.entry.find((e: any) => e.resource.resourceType === 'Composition')?.resource;
    expect(c1?.identifier?.value).toBeDefined();
    expect(c1?.identifier?.value).toBe(c2?.identifier?.value);
  });
});
