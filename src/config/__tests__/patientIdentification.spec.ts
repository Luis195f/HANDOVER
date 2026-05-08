import { afterEach, describe, expect, it, vi } from 'vitest';

describe('patientIdentification', () => {
  const originalQrFlag = process.env.EXPO_PUBLIC_ENABLE_QR_PATIENT_SCAN;

  afterEach(() => {
    vi.resetModules();
    if (typeof originalQrFlag === 'string') {
      process.env.EXPO_PUBLIC_ENABLE_QR_PATIENT_SCAN = originalQrFlag;
    } else {
      delete process.env.EXPO_PUBLIC_ENABLE_QR_PATIENT_SCAN;
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
    expect(isQrPatientScanEnabled({ unitId: 'sjd-a' })).toBe(false);
    expect(isQrPatientScanEnabled({ unitId: 'sjd-b' })).toBe(false);
    expect(isQrPatientScanEnabled({ unitId: 'sjd-infanto' })).toBe(false);
    expect(isQrPatientScanEnabled({ unitId: 'udcc-psychogeriatrics' })).toBe(false);
  });

  it('allows an explicit feature flag to re-enable QR when needed', async () => {
    process.env.EXPO_PUBLIC_ENABLE_QR_PATIENT_SCAN = 'true';
    const { isQrPatientScanEnabled } = await import('@/src/config/patientIdentification');

    expect(isQrPatientScanEnabled({ specialtyId: 'behavioral-health' })).toBe(true);
    expect(isQrPatientScanEnabled({ specialtyId: 'psych' })).toBe(true);
    expect(isQrPatientScanEnabled({ unitId: 'sjd-a' })).toBe(true);
  });
});
