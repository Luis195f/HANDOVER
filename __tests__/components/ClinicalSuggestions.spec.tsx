import React from 'react';
import { act, create } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';

import ClinicalSuggestions from '@/src/components/ClinicalSuggestions';

describe('ClinicalSuggestions', () => {
  it('muestra sugerencias y rationale', () => {
    let renderer;
    act(() => {
      renderer = create(
        <ClinicalSuggestions
          suggestions={{
            section: 'vitals',
            interventions: ['Monitorizar constantes', 'Reforzar hidratación'],
            rationale: 'Basado en signos vitales',
          }}
          isLoading={false}
        />,
      );
    });

    const textNodes = renderer.root.findAllByType('Text').map((node) => node.props.children).flat();
    expect(textNodes).toContain('Monitorizar constantes');
    expect(textNodes).toContain('Reforzar hidratación');
    expect(textNodes).toContain('Basado en signos vitales');
  });

  it('muestra loader y botón deshabilitado cuando está cargando', () => {
    let renderer;
    const onRefresh = () => undefined;
    act(() => {
      renderer = create(
        <ClinicalSuggestions suggestions={null} isLoading={true} onRefresh={onRefresh} errorMessage="Sin datos" />,
      );
    });

    const button = renderer.root.findByProps({ accessibilityLabel: 'Refrescar sugerencias IA' });
    expect(button.props.disabled).toBe(true);
    const errorText = renderer.root.findAllByType('Text').map((node) => node.props.children).flat();
    expect(errorText).toContain('Sin datos');
  });
});
