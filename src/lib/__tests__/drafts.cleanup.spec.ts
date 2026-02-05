import { beforeEach, describe, expect, it } from 'vitest';

import { clearAllDrafts, __test__ } from '@/src/lib/drafts';

describe('clearAllDrafts legacy cleanup', () => {
  beforeEach(async () => {
    await clearAllDrafts();
  });

  it('elimina drafts nuevos y legacy', async () => {
    const patientId = 'Patient/123';
    const normalizedId = __test__.normalizePatientId(patientId);
    const draftKey = __test__.keyNorm(patientId);
    const legacyPrefix = __test__.legacyPrefixes[0];
    const legacyKey = `${legacyPrefix}${normalizedId}`;

    await __test__.writeRaw(draftKey, JSON.stringify({ note: 'draft' }));
    await __test__.writeRaw(__test__.indexKey, JSON.stringify([draftKey]));
    await __test__.writeRaw(legacyKey, JSON.stringify({ note: 'legacy' }));

    await clearAllDrafts();

    await expect(__test__.readRaw(draftKey)).resolves.toBeNull();
    await expect(__test__.readRaw(legacyKey)).resolves.toBeNull();
    await expect(__test__.readRaw(__test__.indexKey)).resolves.toBeNull();
  });

  it('no revienta con keys huérfanas', async () => {
    const orphanPrefix = __test__.legacyPrefixes[0];
    const orphanKey = `${orphanPrefix}orphan`;

    await __test__.writeRaw(orphanKey, JSON.stringify({ note: 'orphan' }));

    await expect(clearAllDrafts()).resolves.toBeUndefined();
    await expect(__test__.readRaw(orphanKey)).resolves.toBeNull();
  });
});
