import type { BedsideChecklistItem } from '@/src/config/bedsideChecklist';
import type { HandoverBedsideChecklist } from '@/src/types/handover';

export function getBedsideChecklistKeys(
  values: HandoverBedsideChecklist | undefined,
  items?: BedsideChecklistItem[],
): string[] {
  if (items?.length) {
    return items.map((item) => item.key);
  }
  if (!values) return [];
  return Object.keys(values).filter(
    (key) => typeof (values as Record<string, unknown>)[key] === 'boolean',
  );
}

export function isBedsideChecklistComplete(
  values: HandoverBedsideChecklist | undefined,
  items?: BedsideChecklistItem[],
): boolean {
  if (!values) return false;
  const keys = getBedsideChecklistKeys(values, items);
  if (!keys.length) return false;
  return keys.every((key) => values[key] === true);
}
