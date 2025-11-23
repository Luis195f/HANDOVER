import React from 'react';
import { render } from '@testing-library/react-native';
import { describe, expect, it } from 'vitest';

import { PatientBanner } from '@/src/screens/components/PatientBanner';

describe('PatientBanner', () => {
  it('muestra estado de carga', () => {
    const { getByText } = render(<PatientBanner summary={null} loading error={null} />);
    expect(getByText('Cargando datos del paciente…')).toBeTruthy();
  });

  it('renderiza nombre, sexo, edad, cama, MRN y alergias', () => {
    const { getByText } = render(
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

    expect(getByText('Paciente Demo')).toBeTruthy();
    expect(getByText('Femenino, 65 años')).toBeTruthy();
    expect(getByText('Cama A-12')).toBeTruthy();
    expect(getByText('MRN MRN123')).toBeTruthy();
    expect(getByText('Penicilina')).toBeTruthy();
    expect(getByText('Látex')).toBeTruthy();
  });

  it('muestra mensaje de error', () => {
    const { getByText } = render(
      <PatientBanner
        summary={{ id: '1', name: 'Paciente Demo' }}
        loading={false}
        error="falló"
      />,
    );

    expect(getByText('No se pudo obtener la información del paciente')).toBeTruthy();
  });
});
