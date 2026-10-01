import type { OxygenTherapy } from '../types/handover';

export function isSupplementalOxygen(oxygen?: Readonly<OxygenTherapy> | null): boolean {
  const device = oxygen?.device?.trim().toLowerCase().replace(/\s+/g, ' ');
  return (oxygen?.flowLMin ?? 0) > 0 || (oxygen?.fio2 ?? 0) > 21 ||
    Boolean(device && device !== 'aire ambiente');
}

export function resolveSupplementalOxygen(oxygen: Readonly<OxygenTherapy> | null | undefined, legacyO2?: boolean): boolean {
  const informative = Boolean(oxygen?.device?.trim()) ||
    Number.isFinite(oxygen?.flowLMin) || Number.isFinite(oxygen?.fio2);
  return informative ? isSupplementalOxygen(oxygen) : legacyO2 === true;
}

export function readLegacyOxygen(vitals: unknown): boolean | undefined {
  return vitals != null && typeof vitals === 'object' && 'o2' in vitals && typeof vitals.o2 === 'boolean'
    ? vitals.o2 : undefined;
}

export function withTransientOxygen<T extends object>(vitals: T | undefined, read: () => boolean | undefined): T | undefined {
  if (!vitals) return undefined;
  return Object.defineProperty({ ...vitals }, 'o2', { get: read, enumerable: false });
}
