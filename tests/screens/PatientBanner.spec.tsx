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

  it('no renderiza salida ICEA paciente a paciente en la UI operativa', () => {
    const { queryByTestId } = render(
      <PatientBanner summary={{ id: '1', name: 'Paciente Demo' }} loading={false} error={null} />,
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
