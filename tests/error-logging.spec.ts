import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearErrorLogs,
  listErrorLogs,
  reportError,
  sanitizeText,
  setShareErrorLogsPreference,
} from '@/src/lib/error-logging';

describe('error logging', () => {
  afterEach(async () => {
    setShareErrorLogsPreference(false);
    await clearErrorLogs();
    vi.restoreAllMocks();
  });

  it('sanitizes patient identifiers and names', () => {
    const input = "Patient/abc-123 fullName: 'Jane Doe' user_id=001";
    expect(sanitizeText(input)).not.toContain('Jane Doe');
    expect(sanitizeText(input)).toContain('Patient/****');
    expect(sanitizeText(input)).toContain('user_id=****');
  });

  it('stores logs locally when sharing is disabled', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    setShareErrorLogsPreference(false);

    await reportError(new Error('local only'));

    const stored = await listErrorLogs();
    expect(stored.length).toBeGreaterThanOrEqual(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends logs when sharing is enabled', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as any);
    setShareErrorLogsPreference(true);

    await reportError(new Error('send me'));

    const stored = await listErrorLogs();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(stored.length).toBe(0);
  });
});
