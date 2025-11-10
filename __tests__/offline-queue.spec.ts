import { __clear, enqueueBundle, flushQueue } from '@/src/lib/offlineQueue';

describe('offline queue', () => {
  beforeEach(() => {
    __clear();
  });

  test('groups multiple bundles per patient', async () => {
    const post = jest.fn().mockResolvedValue(undefined);
    await enqueueBundle('patient-1', [{ request: { method: 'POST' } }]);
    await enqueueBundle('patient-1', [{ request: { method: 'POST' } }]);
    await enqueueBundle('patient-2', [{ request: { method: 'POST' } }]);

    await flushQueue(post);

    expect(post).toHaveBeenCalledTimes(2);
    const firstCall = post.mock.calls[0][0];
    expect(firstCall.entry.length).toBe(2);
  });
});
