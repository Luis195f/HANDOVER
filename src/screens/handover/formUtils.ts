import { ALL_UNITS_OPTION } from '@/src/state/filterStore';
import { SHIFT_TYPES } from '@/src/types/administrative';
import type { RiskItem } from '@/src/types/handover';
import type { SignatureUser } from '@/src/screens/components/SignaturesSection';
import type { Session } from '@/src/security/auth';
import type { HandoverUser } from '@/src/security/auth-types';
import type { HandoverValues } from '@/src/validation/schemas';

import { normalizeUnitSelection } from './submission';

type HandoverFormValues = HandoverValues;
type BedsideChecklistValue = HandoverFormValues['bedsideChecklist'];
type SignatureInfo = HandoverValues['signatures'];
type SignatureRecord = NonNullable<SignatureInfo>;
type OutgoingSignature = NonNullable<SignatureRecord['outgoing']>;
type LooseSignatureInfo = Omit<SignatureRecord, 'outgoing'> & {
  outgoing?: Omit<OutgoingSignature, 'method'> & { method?: OutgoingSignature['method'] };
};

export function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function normalizeOptionalText(value?: string | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

export function resolveEffectiveHandoverUnitId(...values: Array<string | null | undefined>): string | undefined {
  for (const value of values) {
    const normalized = normalizeOptionalText(value);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

export function resolveCanonicalPilotContextUnitId(...values: Array<string | null | undefined>): string | undefined {
  for (const value of values) {
    const normalized = normalizeUnitSelection(value, ALL_UNITS_OPTION);
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

export const deriveShiftType = (shiftStartValue?: string | null) => {
  if (!shiftStartValue) return SHIFT_TYPES[0];
  const date = new Date(shiftStartValue);
  const hours = date.getHours();
  if (Number.isNaN(hours)) return SHIFT_TYPES[0];
  if (hours >= 6 && hours < 14) return 'Mañana';
  if (hours >= 14 && hours < 22) return 'Tarde';
  return 'Noche';
};

export const deriveShiftCode = (shiftStartValue?: string | null) => {
  if (!shiftStartValue) return undefined;
  const date = new Date(shiftStartValue);
  const hours = date.getHours();
  if (Number.isNaN(hours)) return undefined;
  if (hours >= 6 && hours < 14) return 'MORNING';
  if (hours >= 14 && hours < 22) return 'AFTERNOON';
  return 'NIGHT';
};

export const mergeDictationText = (currentValue: string | undefined, dictated: string) => {
  const addition = dictated.trim();
  if (!addition) {
    return currentValue ?? '';
  }
  if (!currentValue) {
    return addition;
  }
  const base = currentValue.trimEnd();
  if (!base) {
    return addition;
  }
  return `${base}\n${addition}`;
};

export const findActiveSection = <T extends string>(
  offset: number,
  positions: Partial<Record<T, number>>,
  sectionsInfo: readonly { key: T }[],
): T | null => {
  const entries = sectionsInfo
    .map(({ key }) => ({ key, y: positions[key] }))
    .filter((entry): entry is { key: T; y: number } => typeof entry.y === 'number')
    .sort((a, b) => a.y - b.y);

  if (entries.length === 0) return null;

  let current: T = entries[0].key;
  for (const entry of entries) {
    if (offset >= entry.y - 24) {
      current = entry.key;
    } else {
      break;
    }
  }

  return current;
};

export function deriveInitialRisksStructured(values: HandoverFormValues): RiskItem[] {
  if (Array.isArray(values.risksStructured) && values.risksStructured.length > 0) {
    return values.risksStructured.map((item) => ({
      ...item,
      actions: item.actions ?? [],
      notes: typeof item.notes === 'string' ? item.notes : undefined,
    }));
  }

  const items: RiskItem[] = [];
  if (values.risks?.fall) {
    items.push({ type: 'fall', present: true, notes: undefined, actions: [] });
  }
  if (values.risks?.pressureUlcer) {
    items.push({ type: 'pressureUlcer', present: true, notes: undefined, actions: [] });
  }
  if (values.risks?.isolation) {
    items.push({ type: 'isolation', present: true, notes: undefined, actions: [] });
  }

  return items;
}

function asStringArray(value: unknown[] | undefined): string[] | undefined {
  if (!value) return undefined;
  const normalized = value.filter((item): item is string => typeof item === 'string');
  return normalized.length ? normalized : undefined;
}

export function getSessionUser(session?: (Session & { user?: HandoverUser | null }) | null): HandoverUser | null {
  if (!session) return null;
  if (session.user) return session.user;
  return {
    id: session.userId,
    userId: session.userId,
    displayName: session.displayName,
    fullName: session.displayName,
    name: session.displayName,
    roles: session.roles,
    units: session.units,
  };
}

export function normalizeSignatureUser(session?: (Session & { user?: HandoverUser | null }) | null): SignatureUser | null {
  const base = getSessionUser(session);
  if (!base) return null;

  const roles = asStringArray(base.roles) ?? (base.role ? [base.role] : undefined);
  const units = asStringArray(base.units);

  return {
    id: base.id ?? base.userId ?? session?.userId,
    userId: base.userId ?? base.id ?? session?.userId,
    name: base.name ?? base.displayName ?? base.fullName ?? session?.displayName,
    fullName: base.fullName ?? base.name ?? base.displayName ?? session?.displayName,
    displayName: base.displayName ?? base.name ?? base.fullName ?? session?.displayName,
    role: base.role ?? roles?.[0],
    roles,
    units,
    activeUnitId: base.activeUnitId ?? units?.[0],
  };
}

export const BEDSIDE_CHECKLIST_KEYS = [
  'patientIdentityConfirmed',
  'allergiesReviewed',
  'linesAndDevicesChecked',
  'medicationPlanReviewed',
  'safetyMeasuresApplied',
  'questionsAnswered',
] as const;

export type BedsideChecklistKey = (typeof BEDSIDE_CHECKLIST_KEYS)[number];

const isBedsideChecklistKey = (value: string): value is BedsideChecklistKey =>
  (BEDSIDE_CHECKLIST_KEYS as readonly string[]).includes(value);

export const baseChecklistDefaults: BedsideChecklistValue = {
  patientIdentityConfirmed: false,
  allergiesReviewed: false,
  linesAndDevicesChecked: false,
  medicationPlanReviewed: false,
  safetyMeasuresApplied: false,
  questionsAnswered: false,
  bedsideNotes: '',
};

export function normalizeChecklistItems(rawItems: unknown): Array<{ key: BedsideChecklistKey }> {
  if (!Array.isArray(rawItems)) {
    return [];
  }

  return rawItems.reduce<Array<{ key: BedsideChecklistKey }>>((acc, item) => {
    const candidate =
      typeof item === 'object' && item !== null && 'key' in item
        ? String((item as { key?: unknown }).key ?? '')
        : '';

    if (isBedsideChecklistKey(candidate)) {
      acc.push({ key: candidate });
    }
    return acc;
  }, []);
}

export function buildChecklistDefaults(
  checklistItems: Array<{ key: BedsideChecklistKey }>,
  base: BedsideChecklistValue,
): BedsideChecklistValue {
  const next: BedsideChecklistValue = { ...base };
  for (const item of checklistItems) next[item.key] = false;
  return next;
}

export function buildCompletedChecklist(
  current: Partial<BedsideChecklistValue> | undefined,
  checklistItems: Array<{ key: BedsideChecklistKey }>,
): BedsideChecklistValue {
  const completed: BedsideChecklistValue = { ...baseChecklistDefaults };

  for (const key of BEDSIDE_CHECKLIST_KEYS) {
    const currentValue = current?.[key];
    if (typeof currentValue === 'boolean') {
      completed[key] = currentValue;
    }
  }

  if (typeof current?.bedsideNotes === 'string') {
    completed.bedsideNotes = current.bedsideNotes;
  }

  for (const item of checklistItems) {
    completed[item.key] = true;
  }

  return completed;
}

export function truncateNote(value?: string | null, maxLength = 400) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

export function compactObject<T extends Record<string, unknown>>(input: T): Partial<T> {
  const out: Partial<T> = {};
  (Object.keys(input) as Array<keyof T>).forEach((key) => {
    const value = input[key];
    if (value !== undefined && value !== null) {
      out[key] = value;
    }
  });
  return out;
}

export function compactNumberMap<T extends Record<string, number | undefined | null>>(input: T) {
  const out: Partial<Record<keyof T, number>> = {};
  (Object.keys(input) as Array<keyof T>).forEach((key) => {
    const value = input[key];
    if (typeof value === 'number') {
      out[key] = value;
    }
  });
  return out;
}

export function normalizeSignatureInfo(value?: SignatureInfo | LooseSignatureInfo): SignatureInfo | undefined {
  if (!value) {
    return undefined;
  }

  if (!value.outgoing) {
    return value.incoming ? { incoming: value.incoming } : {};
  }

  return {
    ...value,
    outgoing: {
      ...value.outgoing,
      method: value.outgoing.method ?? 'session',
    },
  };
}
