import { describe, expect, it, vi } from 'vitest';

const isOn = vi.fn<(name: string) => boolean>();

vi.mock('@/src/config/flags', () => ({
  isOn: (name: string) => isOn(name),
}));

import { getHandoverVisibleSections } from '../handover/visibility';

const sections = [
  { key: 'turno', title: 'Datos del turno' },
  { key: 'sbar', title: 'SBAR' },
  { key: 'signos', title: 'Signos vitales' },
  { key: 'medicacion', title: 'Medicación y tratamientos' },
  { key: 'adjuntos', title: 'Adjuntos' },
] as const;

describe('handover visibility regression', () => {
  it('keeps only base sections when feature flags are disabled', () => {
    isOn.mockReturnValue(false);

    const visible = getHandoverVisibleSections(sections);

    expect(visible.map((item) => item.key)).toMatchInlineSnapshot(`
      [
        "turno",
      ]
    `);
  });

  it('shows all optional sections when feature flags are enabled', () => {
    isOn.mockReturnValue(true);

    const visible = getHandoverVisibleSections(sections);

    expect(visible.map((item) => item.key)).toMatchInlineSnapshot(`
      [
        "turno",
        "sbar",
        "signos",
        "medicacion",
        "adjuntos",
      ]
    `);
  });
});
