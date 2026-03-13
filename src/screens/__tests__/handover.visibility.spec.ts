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
  { key: 'medicacion', title: 'Medicacion y tratamientos' },
  { key: 'adjuntos', title: 'Adjuntos' },
  { key: 'outcomes', title: 'Resultados esperados (NOC)' },
] as const;

describe('handover visibility regression', () => {
  it('keeps only base sections when feature flags are disabled', () => {
    isOn.mockReturnValue(false);

    const visible = getHandoverVisibleSections(sections);

    expect(visible.map((item) => item.key)).toMatchInlineSnapshot(`
      [
        "turno",
        "outcomes",
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
        "outcomes",
      ]
    `);
  });

  it('honors runtime section visibility over broad flag defaults', () => {
    isOn.mockReturnValue(true);

    const visible = getHandoverVisibleSections(sections, {
      turno: true,
      sbar: false,
      signos: false,
      medicacion: true,
      adjuntos: false,
      outcomes: false,
    });

    expect(visible.map((item) => item.key)).toEqual(['turno', 'medicacion']);
  });
});
