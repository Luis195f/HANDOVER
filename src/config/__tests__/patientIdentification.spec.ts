import { afterEach, describe, expect, it, vi } from 'vitest';

describe('patientIdentification', () => {
  const originalQrFlag = process.env.EXPO_PUBLIC_ENABLE_QR_PATIENT_SCAN;
  const originalUnitsConfig = process.env.UNITS_CONFIG;

  afterEach(() => {
    vi.resetModules();
    if (typeof originalQrFlag === 'string') {
      process.env.EXPO_PUBLIC_ENABLE_QR_PATIENT_SCAN = originalQrFlag;
    } else {
      delete process.env.EXPO_PUBLIC_ENABLE_QR_PATIENT_SCAN;
    }

    if (typeof originalUnitsConfig === 'string') {
      process.env.UNITS_CONFIG = originalUnitsConfig;
    } else {
      delete process.env.UNITS_CONFIG;
    }
  });

  it('keeps QR enabled by default outside behavioral health contexts', async () => {
    delete process.env.EXPO_PUBLIC_ENABLE_QR_PATIENT_SCAN;
    const { isQrPatientScanEnabled } = await import('@/src/config/patientIdentification');

    expect(isQrPatientScanEnabled({ unitId: 'icu-a' })).toBe(true);
  });

  it('disables QR by default for behavioral health contexts', async () => {
    delete process.env.EXPO_PUBLIC_ENABLE_QR_PATIENT_SCAN;
    const { isQrPatientScanEnabled } = await import('@/src/config/patientIdentification');

    expect(isQrPatientScanEnabled({ specialtyId: 'behavioral-health' })).toBe(false);
    expect(isQrPatientScanEnabled({ specialtyId: ' psych ' })).toBe(false);
    expect(isQrPatientScanEnabled({ unitId: 'psych-adult-a' })).toBe(false);
    expect(isQrPatientScanEnabled({ unitId: 'psych-adult-b' })).toBe(false);
    expect(isQrPatientScanEnabled({ unitId: 'psych-child-adolescent' })).toBe(false);
    expect(isQrPatientScanEnabled({ unitId: 'psychogeriatrics' })).toBe(false);
  });

  it('allows an explicit feature flag to re-enable QR when needed', async () => {
    process.env.EXPO_PUBLIC_ENABLE_QR_PATIENT_SCAN = 'true';
    const { isQrPatientScanEnabled } = await import('@/src/config/patientIdentification');

    expect(isQrPatientScanEnabled({ specialtyId: 'behavioral-health' })).toBe(true);
    expect(isQrPatientScanEnabled({ specialtyId: 'psych' })).toBe(true);
    expect(isQrPatientScanEnabled({ unitId: 'psych-adult-a' })).toBe(true);
  });

  it('disables QR by default for a custom psych unit resolved from UNITS_CONFIG', async () => {
    delete process.env.EXPO_PUBLIC_ENABLE_QR_PATIENT_SCAN;
    process.env.UNITS_CONFIG = JSON.stringify({
      units: [
        {
          id: 'custom-psych-unit',
          name: 'Unidad Salud Mental Custom',
          specialty: 'psych',
          profileId: 'behavioral-health',
          features: { enablePsychosocialExtra: true },
        },
      ],
    });

    const { isQrPatientScanEnabled } = await import('@/src/config/patientIdentification');

    expect(isQrPatientScanEnabled({ unitId: 'custom-psych-unit' })).toBe(false);
  });

  it('allows an explicit QR flag for a custom psych unit resolved from UNITS_CONFIG', async () => {
    process.env.EXPO_PUBLIC_ENABLE_QR_PATIENT_SCAN = 'true';
    process.env.UNITS_CONFIG = JSON.stringify({
      units: [
        {
          id: 'custom-psych-unit',
          name: 'Unidad Salud Mental Custom',
          specialty: 'psych',
          profileId: 'behavioral-health',
          features: { enablePsychosocialExtra: true },
        },
      ],
    });

    const { isQrPatientScanEnabled } = await import('@/src/config/patientIdentification');

    expect(isQrPatientScanEnabled({ unitId: 'custom-psych-unit' })).toBe(true);
  });
});
