import { describe, expect, it } from 'vitest';

import { CLIENT_OPENAI_DISABLED_ERROR, openAIClient } from '@/src/lib/openai';

describe('openAIClient hardening', () => {
  it('never enables direct OpenAI access from the client bundle', async () => {
    expect(openAIClient.isConfigured).toBe(false);
    await expect(openAIClient.complete('hola')).rejects.toThrow(CLIENT_OPENAI_DISABLED_ERROR);
  });
});
