import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AttachError, buildHandoverBundle } from '../fhir-map';

const fileSystemMocks = vi.hoisted(() => ({
  getInfoAsync: vi.fn(async () => ({ exists: true, isDirectory: false, size: 123 })),
  readAsStringAsync: vi.fn(async () => 'YmFzZTY0RGF0YQ=='),
}));

vi.mock('expo-file-system', () => fileSystemMocks);

const listDocuments = (bundle: any) =>
  (bundle.entry ?? []).map((entry: any) => entry.resource).filter((res: any) => res?.resourceType === 'DocumentReference');

describe('Attachments mapping', () => {
  beforeEach(() => {
    fileSystemMocks.getInfoAsync.mockClear();
    fileSystemMocks.readAsStringAsync.mockClear();
  });

  it('embeds attachment data as base64 DocumentReference', async () => {
    const bundle = await buildHandoverBundle(
      {
        patientId: 'pat-001',
        attachments: [
          {
            uri: 'file://mock.pdf',
            contentType: 'application/pdf',
            name: 'mock.pdf',
            size: 123,
            kind: 'pdf',
          },
        ],
      },
      { now: () => '2025-01-01T00:00:00Z' },
    );

    const docs = listDocuments(bundle);
    expect(docs).toHaveLength(1);
    const attachment = docs[0]?.content?.[0]?.attachment;
    expect(attachment?.contentType).toBe('application/pdf');
    expect(attachment?.data).toBe('YmFzZTY0RGF0YQ==');
  });

  it('infers contentType from file extension when missing', async () => {
    const bundle = await buildHandoverBundle(
      {
        patientId: 'pat-001',
        attachments: [
          {
            uri: 'file://photo.jpg',
            name: 'photo.jpg',
            kind: 'image',
          },
        ],
      },
      { now: () => '2025-01-01T00:00:00Z' },
    );

    const docs = listDocuments(bundle);
    expect(docs[0]?.content?.[0]?.attachment?.contentType).toBe('image/jpeg');
  });

  it('throws AttachError when attachment is too large', async () => {
    fileSystemMocks.getInfoAsync.mockResolvedValueOnce({ exists: true, isDirectory: false, size: 6 * 1024 * 1024 });

    await expect(
      buildHandoverBundle(
        {
          patientId: 'pat-001',
          attachments: [{ uri: 'file://big.pdf', name: 'big.pdf', kind: 'pdf' }],
        },
        { now: () => '2025-01-01T00:00:00Z' },
      ),
    ).rejects.toBeInstanceOf(AttachError);
  });
});
