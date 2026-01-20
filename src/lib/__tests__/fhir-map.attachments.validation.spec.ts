import { describe, it, expect } from 'vitest';
import { buildHandoverBundle } from '../fhir-map';

const list = (b:any, rt:string) => (b.entry??[]).map((e:any)=>e.resource).filter((r:any)=>r?.resourceType===rt);

describe('Attachments — base64 y metadatos', () => {
  const patientId = 'pat-001';
  const now = '2025-10-21T19:22:00Z';

  it('acepta adjuntos base64 con contentType y título', () => {
    const b = buildHandoverBundle(
      {
        patientId,
        attachments: [
          {
            uri: 'file:///nota.pdf',
            contentType: 'application/pdf',
            name: 'Informe',
            data: 'SGVsbG8=',
          },
        ],
      },
      { now },
    );
    const docs = list(b, 'DocumentReference');
    expect(docs.length).toBe(1);
    expect(docs[0]?.content?.[0]?.attachment?.contentType).toBe('application/pdf');
    expect(docs[0]?.content?.[0]?.attachment?.data).toBe('SGVsbG8=');
    expect(docs[0]?.content?.[0]?.attachment?.title).toBe('Informe');
  });

  it('rechaza adjunto sin data', () => {
    expect(() =>
      buildHandoverBundle(
        {
          patientId,
          attachments: [
            {
              uri: 'file:///nota.pdf',
              contentType: 'application/pdf',
              name: 'Informe',
              data: '',
            },
          ],
        },
        { now },
      ),
    ).toThrow();
  });
});
