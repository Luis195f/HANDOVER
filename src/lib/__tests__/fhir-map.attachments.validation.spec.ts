import { describe, it, expect } from 'vitest';
import { buildHandoverBundle } from '../fhir-map';

const list = (b:any, rt:string) => (b.entry??[]).map((e:any)=>e.resource).filter((r:any)=>r?.resourceType===rt);

describe('Attachments — URL y MIME permitidos', () => {
  const patientId = 'pat-001';
  const now = '2025-10-21T19:22:00Z';

  it('acepta audio mp3 con contentType correcto', () => {
    const b = buildHandoverBundle(
      { patientId, attachments: [{ url: 'https://cdn.example.org/aud.mp3', contentType: 'audio/mpeg', description: 'Audio SBAR' }] },
      { now }
    );
    const docs = list(b,'DocumentReference');
    expect(docs.length).toBe(1);
    expect(docs[0]?.content?.[0]?.attachment?.contentType).toBe('audio/mpeg');
  });

  it('infiera contentType por extensión cuando no se provee', () => {
    const b = buildHandoverBundle(
      { patientId, attachments: [{ url: 'https://cdn.example.org/nota.pdf', description: 'Informe' }] },
      { now }
    );
    const docs = list(b,'DocumentReference');
    expect(docs[0]?.content?.[0]?.attachment?.contentType).toBe('application/pdf');
  });

  it('rechaza MIME no permitido si el usuario lo provee (p.ej., text/plain)', () => {
    expect(() =>
      buildHandoverBundle(
        { patientId, attachments: [{ url: 'https://x.example.org/voice.mp3', contentType: 'text/plain' }] },
        { now }
      )
    ).toThrow();
  });

  it('permite URL sin contentType con extensión desconocida (no rompe, queda octet-stream)', () => {
    const b = buildHandoverBundle(
      { patientId, attachments: [{ url: 'https://x.example.org/blob.unknown' }] },
      { now }
    );
    const docs = list(b,'DocumentReference');
    expect(docs[0]?.content?.[0]?.attachment?.contentType).toBe('application/octet-stream');
  });

  it('rechaza URL no http/https', () => {
    expect(() =>
      buildHandoverBundle(
        { patientId, attachments: [{ url: 'ftp://host/file.mp3', contentType: 'audio/mpeg' }] as any },
        { now }
      )
    ).toThrow();
  });
});
