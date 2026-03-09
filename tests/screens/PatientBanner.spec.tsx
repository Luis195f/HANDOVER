import React from 'react';
import { render } from '@testing-library/react-native';
import { describe, expect, it } from 'vitest';

import { PatientBanner } from '@/src/screens/components/PatientBanner';

describe('PatientBanner', () => {
  it('muestra estado de carga', () => {
    const { getByTestId } = render(<PatientBanner summary={null} loading error={null} />);
    expect(getByTestId('patient-banner-loading').props.children).toContain('Cargando datos del paciente…');
  });

  it('renderiza nombre, sexo, edad, cama, MRN y alergias', () => {
    const { getByTestId } = render(
      <PatientBanner
        summary={{
          id: '1',
          name: 'Paciente Demo',
          gender: 'female',
          age: 65,
          bed: 'A-12',
          mrn: 'MRN123',
          allergies: ['Penicilina', 'Látex'],
        }}
        loading={false}
        error={null}
      />,
    );

    expect(getByTestId('patient-name').props.children).toBe('Paciente Demo');
    expect(getByTestId('patient-gender-age').props.children).toBe('Femenino, 65 años');
    const bedChildren = getByTestId('patient-bed').props.children;
    const bedText = Array.isArray(bedChildren) ? bedChildren.join('') : bedChildren;
    expect(bedText).toBe('Cama A-12');
    const mrnChildren = getByTestId('patient-mrn').props.children;
    const mrnText = Array.isArray(mrnChildren) ? mrnChildren.join('') : mrnChildren;
    expect(mrnText).toBe('MRN MRN123');
    const allergy0 = getByTestId('patient-allergy-0').props.children;
    const allergy1 = getByTestId('patient-allergy-1').props.children;
    const allergyText0 = allergy0?.props?.children ?? allergy0;
    const allergyText1 = allergy1?.props?.children ?? allergy1;
    expect(allergyText0).toBe('Penicilina');
    expect(allergyText1).toBe('Látex');
  });

  it('muestra apoyo analítico prudente cuando hay dato ICEA y avisa si está stale', () => {
    const { getByTestId } = render(
      <PatientBanner
        summary={{ id: '1', name: 'Paciente Demo' }}
        loading={false}
        error={null}
        showIceaRisk
        showIceaCausalSummary
        iceaRisk={{
          patientId: 'pat-1',
          unitId: 'icu-a',
          handoverId: 'bundle-1',
          requestId: 'req-1',
          clinicalStatus: 'provisional',
          stale: true,
          score: 82,
          scoreLabel: null,
          confidence: { value: 0.81, label: 'high' },
          warnings: [{ code: 'remote_warning', message: 'Apoyo analítico' }],
          message: 'Apoyo analítico ICEA+ provisional. No sustituye juicio clínico.',
          calculatedAt: '2026-03-09T09:00:00Z',
          lastUpdatedAt: '2026-03-09T09:00:00Z',
          provenance: {
            source: 'HANDOVER',
            provider: 'ICEA+',
            scoringMode: 'immediate_provisional',
            contractVersion: 'handover-icea-bridge-v1',
            formulaVersion: 'icea_plus_v1',
            bridgeStatus: 'scored',
            localStatusIsAuthoritative: true,
          },
          causalSummary: {
            available: true,
            summary: 'Resumen causal prudente',
            updatedAt: '2026-03-09T09:00:00Z',
          },
        }}
      />,
    );

    expect(getByTestId('patient-banner-icea-status').props.children).toBe('Provisional');
    expect(getByTestId('patient-banner-icea-score').props.children).toContain('Score 82.0');
    expect(getByTestId('patient-banner-icea-message').props.children).toContain('No sustituye juicio clínico');
    expect(getByTestId('patient-banner-icea-stale').props.children).toContain('desactualizado');
    expect(getByTestId('patient-banner-icea-causal').props.children).toContain('Resumen causal prudente');
  });

  it('muestra ausencia de dato cuando la feature está activa', () => {
    const { getByTestId } = render(
      <PatientBanner summary={{ id: '1', name: 'Paciente Demo' }} loading={false} error={null} showIceaRisk />,
    );

    expect(getByTestId('patient-banner-icea-empty').props.children).toContain('Sin apoyo analítico disponible');
  });

  it('oculta apoyo analítico si la feature UI está desactivada', () => {
    const { queryByTestId } = render(
      <PatientBanner summary={{ id: '1', name: 'Paciente Demo' }} loading={false} error={null} showIceaRisk={false} />,
    );

    expect(queryByTestId('patient-banner-icea')).toBeNull();
  });

  it('muestra mensaje de error', () => {
    const { getByTestId } = render(
      <PatientBanner
        summary={{ id: '1', name: 'Paciente Demo' }}
        loading={false}
        error="falló"
      />,
    );

    expect(getByTestId('patient-banner-error').props.children).toContain(
      'No se pudo obtener la información del paciente',
    );
  });
});
