import snomedDict from './snomed-dict.json';

export const SNOMED_SYSTEM = 'http://snomed.info/sct' as const;

export type SnomedTerm = {
  code: string;
  display: string;
};

export type SnomedCoding = {
  system: typeof SNOMED_SYSTEM;
  code: string;
  display: string;
};

export type Coding = SnomedCoding;

export const snomedTerms = snomedDict as SnomedTerm[];

export const normalizeTerm = (value: string): string => {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
};

export const snomedDisplaySet = new Set<string>();
export const snomedDisplayToCodeMap = new Map<string, string>();
export const snomedCodeToDisplayMap = new Map<string, string>();

snomedTerms.forEach((term) => {
  const normalized = normalizeTerm(term.display);
  snomedDisplaySet.add(normalized);
  snomedDisplayToCodeMap.set(normalized, term.code);
  snomedCodeToDisplayMap.set(term.code, term.display);
});

export const resolveSnomedCoding = (value: unknown): SnomedCoding | null => {
  if (typeof value !== 'string') return null;
  const normalized = normalizeTerm(value);
  const code = snomedDisplayToCodeMap.get(normalized);
  if (!code) return null;
  const display = snomedCodeToDisplayMap.get(code) ?? value.trim();
  return {
    system: SNOMED_SYSTEM,
    code,
    display,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const normalizeLegacySnomedCoding = (value: unknown): SnomedCoding | null => {
  if (typeof value === 'string') {
    return resolveSnomedCoding(value);
  }
  if (isRecord(value)) {
    const system = value.system;
    const code = value.code;
    const display = value.display;
    if (system === SNOMED_SYSTEM && typeof code === 'string' && typeof display === 'string') {
      return { system: SNOMED_SYSTEM, code, display };
    }
  }
  return null;
};
