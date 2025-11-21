import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import {
  appendAuditEvent,
  createAsyncStorageAuditStorage,
  groupByShift,
  makeAuditEvent,
  pruneOldEvents,
  type AuditEvent,
} from '@/src/lib/audit';

describe('audit module', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  describe('makeAuditEvent', () => {
    it('creates events without PHI and stable timestamps', () => {
      const fixedNow = () => new Date('2025-01-01T08:00:00Z');
      const event = makeAuditEvent(
        {
          type: 'patient_open',
          patientId: 'pat-001',
          userId: 'user-1',
          unitId: 'UCI',
        },
        fixedNow,
      );

      expect(event.id).toBeTypeOf('string');
      expect(event.id.length).toBeGreaterThan(0);
      expect(event.at).toBe('2025-01-01T08:00:00.000Z');
      expect(event.type).toBe('patient_open');
      expect(event.userId).toBe('user-1');
      expect(event.unitId).toBe('UCI');
      expect(event.meta).toBeUndefined();
    });

    it('rejects long strings in meta to avoid PHI leakage', () => {
      const longString = 'a'.repeat(101);
      expect(() =>
        makeAuditEvent({
          type: 'patient_edit',
          userId: 'user-2',
          meta: { debug: longString },
        }),
      ).toThrow('META_STRING_TOO_LONG');
    });
  });

  describe('groupByShift', () => {
    it('groups audit events by shift code with UNKNOWN fallback', () => {
      const events: AuditEvent[] = [
        { id: '1', type: 'patient_open', at: '2024-01-01T00:00:00Z', userId: 'u1', shiftCode: 'NIGHT' },
        { id: '2', type: 'patient_edit', at: '2024-01-01T01:00:00Z', userId: 'u1', shiftCode: 'NIGHT' },
        { id: '3', type: 'patient_open', at: '2024-01-01T02:00:00Z', userId: 'u1', shiftCode: 'MORNING' },
        { id: '4', type: 'patient_open', at: '2024-01-01T03:00:00Z', userId: 'u2' },
      ];

      const grouped = groupByShift(events);

      expect(grouped.NIGHT).toHaveLength(2);
      expect(grouped.MORNING).toHaveLength(1);
      expect(grouped.UNKNOWN).toHaveLength(1);
    });
  });

  describe('pruneOldEvents', () => {
    it('keeps only events within maxAgeDays', () => {
      const now = Date.now();
      const today = new Date(now).toISOString();
      const twoDays = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
      const fortyDays = new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString();

      const events: AuditEvent[] = [
        { id: '1', type: 'patient_open', at: today, userId: 'u' },
        { id: '2', type: 'patient_open', at: twoDays, userId: 'u' },
        { id: '3', type: 'patient_open', at: fortyDays, userId: 'u' },
      ];

      const pruned = pruneOldEvents(events, { maxAgeDays: 30 });

      expect(pruned).toHaveLength(2);
      expect(pruned.find((e) => e.id === '3')).toBeUndefined();
    });

    it('limits max events per patient keeping most recent', () => {
      const base = Date.parse('2024-01-01T00:00:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-10T00:00:00Z'));
      const events: AuditEvent[] = Array.from({ length: 5 }).map((_, idx) => ({
        id: `${idx + 1}`,
        type: 'patient_edit',
        at: new Date(base + idx * 1000).toISOString(),
        userId: 'u',
        patientId: 'pat-123',
      }));

      const pruned = pruneOldEvents(events, { maxAgeDays: 365, maxPerPatient: 3 });

      expect(pruned).toHaveLength(3);
      expect(pruned.map((e) => e.id)).toEqual(['3', '4', '5']);
      vi.useRealTimers();
    });
  });

  describe('storage', () => {
    beforeEach(() => {
      vi.resetModules();
      vi.doMock('@react-native-async-storage/async-storage', () => {
        const store: Record<string, string> = {};
        return {
          default: {
            getItem: vi.fn(async (key: string) => store[key] ?? null),
            setItem: vi.fn(async (key: string, value: string) => {
              store[key] = value;
            }),
            removeItem: vi.fn(async (key: string) => {
              delete store[key];
            }),
          },
        };
      });
    });

    afterEach(() => {
      vi.doUnmock('@react-native-async-storage/async-storage');
    });

    it('persists and loads audit events via async storage', async () => {
      const storage = createAsyncStorageAuditStorage('test:audit');
      const events: AuditEvent[] = [
        { id: '1', type: 'patient_open', at: '2024-01-01T00:00:00Z', userId: 'u1' },
        { id: '2', type: 'patient_edit', at: '2024-01-01T01:00:00Z', userId: 'u1', patientId: 'pat' },
      ];

      await storage.save(events);
      const loaded = await storage.load();

      expect(loaded).toEqual(events);
    });

    it('appendAuditEvent saves the new entry', async () => {
      const storage = createAsyncStorageAuditStorage('test:audit');
      const event: AuditEvent = { id: '1', type: 'patient_open', at: '2024-01-01T00:00:00Z', userId: 'u1' };

      await appendAuditEvent(storage, event);
      const loaded = await storage.load();

      expect(loaded).toHaveLength(1);
      expect(loaded[0]).toEqual(event);
    });
  });
});
