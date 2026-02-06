import { useEffect, useState } from 'react';

const esTranslations = require('./locales/es.json') as Record<string, unknown>;
const enTranslations = require('./locales/en.json') as Record<string, unknown>;

const resources = {
  es: esTranslations,
  en: enTranslations,
} as const;

export type SupportedLang = keyof typeof resources;
export type TranslationKey = string;

type TranslationParams = Record<string, string | number | undefined>;

type Listener = (lang: SupportedLang) => void;

const listeners = new Set<Listener>();

const getNavigatorLocale = (): string | undefined => {
  if (typeof navigator === 'undefined') return undefined;
  if ('language' in navigator && typeof navigator.language === 'string') return navigator.language;
  return undefined;
};

const detectLang = (): SupportedLang => {
  try {
    const locale =
      getNavigatorLocale() ||
      (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().locale) ||
      '';
    return String(locale).toLowerCase().startsWith('en') ? 'en' : 'es';
  } catch {
    return 'es';
  }
};

let currentLang: SupportedLang =
  process.env.NODE_ENV === 'test' || typeof window === 'undefined' ? 'es' : detectLang();

export const getCurrentLang = (): SupportedLang => currentLang;

export const setLanguage = (lang: SupportedLang) => {
  if (currentLang === lang) return;
  currentLang = lang;
  listeners.forEach((listener) => listener(lang));
};

const resolveNestedValue = (source: Record<string, unknown>, key: string): unknown =>
  key.split('.').reduce<unknown>((acc, part) => {
    if (!acc || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[part];
  }, source);

const interpolate = (template: string, params?: TranslationParams) => {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_match, token: string) => {
    const value = params[token];
    return value == null ? '' : String(value);
  });
};

export const t = (key: TranslationKey, params?: TranslationParams): string => {
  const bundle = resources[currentLang] ?? resources.es;
  const fallback = resources.es;
  const raw = resolveNestedValue(bundle, key) ?? resolveNestedValue(fallback, key);
  if (typeof raw !== 'string') return key;
  return interpolate(raw, params);
};

export const useTranslation = () => {
  const [lang, setLang] = useState(currentLang);

  useEffect(() => {
    const listener: Listener = (nextLang) => setLang(nextLang);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return {
    t,
    i18n: {
      language: lang,
      changeLanguage: setLanguage,
    },
  } as const;
};
