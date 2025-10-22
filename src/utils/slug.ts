// src/utils/slug.ts
export const toSlug = (s?: string) =>
  (s ?? '')
    .normalize('NFD')                // quita acentos
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-]/g, '');
