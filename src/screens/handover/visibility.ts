import { isOn } from '@/src/config/flags';
import type { HandoverSectionKey } from '@/src/types/profile';

export type HandoverSectionLike = { key: HandoverSectionKey | string; title: string };

const isSectionEnabledByFlags = (sectionKey: string): boolean => {
  const map = {
    sbar: isOn('SHOW_SBAR'),
    signos: isOn('SHOW_VITALS'),
    oxigenoterapia: isOn('SHOW_OXY'),
    medicacion: isOn('SHOW_MEDS'),
    adjuntos: isOn('SHOW_ATTACH'),
  } as const;

  if (sectionKey in map) {
    return map[sectionKey as keyof typeof map];
  }

  return true;
};

export const getHandoverVisibleSections = <T extends HandoverSectionLike>(
  sections: readonly T[],
  sectionVisibility?: Partial<Record<string, boolean>>,
): T[] =>
  sections.filter((section) => {
    if (sectionVisibility && typeof sectionVisibility[section.key] === 'boolean') {
      return sectionVisibility[section.key] === true;
    }

    return isSectionEnabledByFlags(section.key);
  });
