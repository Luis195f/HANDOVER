import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { FormProvider, useForm } from 'react-hook-form';

import DiagnosisAutocomplete from '../DiagnosisAutocomplete';

type FormValues = {
  dxMedicalStructured: any[];
  dxNursingStructured: any[];
};

function renderWithForm(
  props: Partial<React.ComponentProps<typeof DiagnosisAutocomplete>> = {},
) {
  const methods = useForm<FormValues>({
    defaultValues: { dxMedicalStructured: [], dxNursingStructured: [] },
  });
  const utils = render(
    <FormProvider {...methods}>
      <DiagnosisAutocomplete
        name="dxMedicalStructured"
        label="Diagnósticos médicos (estructurados)"
        systemsAllowed={['SNOMED', 'ICD10']}
        {...props}
      />
    </FormProvider>,
  );
  return { methods, ...utils };
}

describe('DiagnosisAutocomplete', () => {
  it('renderiza label e input', () => {
    const { getByText, getByPlaceholderText } = renderWithForm();

    expect(getByText('Diagnósticos médicos (estructurados)')).toBeTruthy();
    expect(getByPlaceholderText('Buscar diagnóstico...')).toBeTruthy();
  });

  it('muestra sugerencias según la búsqueda y añade diagnósticos', async () => {
    const { getByPlaceholderText, getByText, methods } = renderWithForm();

    fireEvent.changeText(getByPlaceholderText('Buscar diagnóstico...'), 'asma');

    await waitFor(() => {
      expect(getByText('Asma (195967001) · SNOMED')).toBeTruthy();
    });

    fireEvent.press(getByText('Asma (195967001) · SNOMED'));

    await waitFor(() => {
      expect(methods.getValues('dxMedicalStructured')).toHaveLength(1);
    });
  });

  it('permite eliminar diagnósticos añadidos', async () => {
    const { getByPlaceholderText, getByText, methods } = renderWithForm();

    fireEvent.changeText(getByPlaceholderText('Buscar diagnóstico...'), 'asma');
    await waitFor(() => getByText('Asma (195967001) · SNOMED'));
    fireEvent.press(getByText('Asma (195967001) · SNOMED'));

    await waitFor(() => {
      expect(methods.getValues('dxMedicalStructured')).toHaveLength(1);
    });

    fireEvent.press(getByText('Eliminar'));

    await waitFor(() => {
      expect(methods.getValues('dxMedicalStructured')).toHaveLength(0);
    });
  });
});
