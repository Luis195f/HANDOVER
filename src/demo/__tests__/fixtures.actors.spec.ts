import { describe, expect, it } from 'vitest';

import {
  DEMO_ACTORS,
  DEMO_RECEIVER_USER_ID,
  DEMO_USER_ID,
  ensureDemoSessionTemplate,
} from '@/src/demo/fixtures';
import { getDemoCapabilities } from '@/src/security/capabilities';

describe('demo actor fixtures', () => {
  it('defines exactly two explicit synthetic nursing identities', () => {
    expect(DEMO_ACTORS).toHaveLength(2);
    expect(DEMO_ACTORS.map((actor) => actor.userId)).toEqual([
      DEMO_USER_ID,
      DEMO_RECEIVER_USER_ID,
    ]);
    expect(new Set(DEMO_ACTORS.map((actor) => actor.userId)).size).toBe(2);

    for (const actor of DEMO_ACTORS) {
      expect(actor.synthetic).toBe(true);
      expect(actor.displayName.toLowerCase()).toContain('demo');
      expect(actor.email.endsWith('.invalid')).toBe(true);
      expect(actor.roles).toEqual(['nurse']);
    }
  });

  it('keeps role, unit scope and capabilities identical across actors', () => {
    const outgoing = ensureDemoSessionTemplate(DEMO_USER_ID);
    const incoming = ensureDemoSessionTemplate(DEMO_RECEIVER_USER_ID);

    expect(outgoing.mode).toBe('demo');
    expect(incoming.mode).toBe('demo');
    expect(incoming.roles).toEqual(outgoing.roles);
    expect(incoming.units).toEqual(outgoing.units);
    expect(getDemoCapabilities(incoming.userId)).toEqual({
      ...getDemoCapabilities(outgoing.userId),
      userSub: incoming.userId,
    });
  });
});
