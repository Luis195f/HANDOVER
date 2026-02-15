import { describe, expect, it, vi, afterEach } from 'vitest';

vi.mock('@/src/config/env', () => ({
  API_BASE_URL: 'https://example.com',
  AI_TRANSCRIBE_ENDPOINT: 'https://example.com/api/ai/transcribe',
}));


vi.mock('@/src/security/auth', () => ({
  ensureFreshAccessToken: vi.fn(async () => 'tok_test_123'),
}));
vi.mock('expo-file-system', () => ({
  getInfoAsync: vi.fn(async () => ({ exists: true })),
  deleteAsync: vi.fn(async () => undefined),
}));

import { transcribeAudioWithResult } from '../stt';

describe('transcribeAudioWithResult', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a network error when fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Network error'));

    const result = await transcribeAudioWithResult('file:///tmp/audio.m4a', { language: 'es' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('NETWORK');
    }
  });
});
