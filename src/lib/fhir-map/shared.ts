export const normalizeTextValue = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return '';
};

export const normalizeStringList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeTextValue(entry))
      .filter((entry) => entry.length > 0);
  }
  const single = normalizeTextValue(value);
  return single ? [single] : [];
};
