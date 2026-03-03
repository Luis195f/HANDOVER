import { isOn } from '@/src/config/flags';

export type HandoverSectionLike = { key: string; title: string };

export const getHandoverVisibleSections = <T extends HandoverSectionLike>(sections: readonly T[]): T[] => {
  const map = {
    sbar: isOn('SHOW_SBAR'),
    signos: isOn('SHOW_VITALS'),
    oxigenoterapia: isOn('SHOW_OXY'),
    medicacion: isOn('SHOW_MEDS'),
    adjuntos: isOn('SHOW_ATTACH'),
  } as const;

  return sections.filter((section) => {
    if (section.key in map) {
      return map[section.key as keyof typeof map];
    }
    return true;
  });
};
