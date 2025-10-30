import * as React from 'react';

export const ALL_UNITS_OPTION = 'all';
export const DEFAULT_SELECTED_UNIT_ID = 'icu-a';

type FilterState = {
  selectedUnitId: string;
};

let state: FilterState = {
  selectedUnitId: DEFAULT_SELECTED_UNIT_ID,
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // ignore listener errors to avoid breaking other subscribers
    }
  });
}

function setState(partial: Partial<FilterState>) {
  const nextSelectedUnitId = partial.selectedUnitId ?? state.selectedUnitId;
  if (nextSelectedUnitId === state.selectedUnitId) {
    return;
  }

  state = { ...state, selectedUnitId: nextSelectedUnitId };
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return state;
}

function ensureUnitValue(unitId?: string | null): string {
  if (typeof unitId !== 'string') {
    return DEFAULT_SELECTED_UNIT_ID;
  }

  const trimmed = unitId.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_SELECTED_UNIT_ID;
}

export function useSelectedUnitId(): string {
  const [value, setValue] = React.useState<string>(getSnapshot().selectedUnitId);

  React.useEffect(() => {
    return subscribe(() => {
      setValue(getSnapshot().selectedUnitId);
    });
  }, []);

  return value;
}

export function getSelectedUnitId(): string {
  return state.selectedUnitId;
}

export function setSelectedUnitId(unitId?: string | null): void {
  const next = ensureUnitValue(unitId);
  setState({ selectedUnitId: next });
}

export function resetFilters(): void {
  setState({ selectedUnitId: DEFAULT_SELECTED_UNIT_ID });
}

