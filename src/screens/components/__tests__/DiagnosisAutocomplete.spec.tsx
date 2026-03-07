import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { UseFormReturn } from 'react-hook-form';
import { FormProvider, useForm } from 'react-hook-form';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as nandaCatalogModule from '@/src/catalogs/nandaCodes';
import DiagnosisAutocomplete from '../DiagnosisAutocomplete';
import type { HandoverStructuredDiagnosis } from '@/src/types/handover';

type FormValues = {
  dxMedicalStructured: HandoverStructuredDiagnosis[];
  dxNursingStructured: HandoverStructuredDiagnosis[];
  dxNursing?: string;
};

function renderWithForm(
  props: Partial<React.ComponentProps<typeof DiagnosisAutocomplete>> = {},
) {
  let methods: UseFormReturn<FormValues> | undefined;
  const Wrapper = () => {
    const form = useForm<FormValues>({
      defaultValues: { dxMedicalStructured: [], dxNursingStructured: [], dxNursing: '' },
    });
    methods = form;
    return (
      <FormProvider {...form}>
        <DiagnosisAutocomplete
          name="dxMedicalStructured"
          label="Diagnósticos médicos (estructurados)"
          systemsAllowed={['SNOMED', 'ICD10']}
          {...props}
        />
      </FormProvider>
    );
  };
  const utils = render(<Wrapper />);
  if (!methods) {
    throw new Error('Form methods not initialized');
  }
  return { methods, ...utils };
}

async function flushSearchDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('DiagnosisAutocomplete', () => {
  it('renderiza label e input', () => {
    const { getByText, getByPlaceholderText } = renderWithForm();

    expect(getByText('Diagnósticos médicos (estructurados)')).toBeTruthy();
    expect(getByPlaceholderText('Buscar diagnóstico...')).toBeTruthy();
  });

  it('muestra la advertencia de licencia antes de habilitar el catálogo NANDA completo', () => {
    const { getByTestId, getByText } = renderWithForm({
      name: 'dxNursingStructured',
      label: 'Diagnósticos enfermería (NANDA)',
      systemsAllowed: ['NANDA'],
    });

    expect(getByTestId('nanda-license-warning')).toBeTruthy();
    expect(getByText('Licencia NANDA-I requerida')).toBeTruthy();
    expect(getByTestId('enable-full-nanda-button')).toBeTruthy();
  });

  it('aplica debounce antes de mostrar sugerencias', async () => {
    vi.useFakeTimers();
    const { getByPlaceholderText, queryByText, getByText } = renderWithForm({
      name: 'dxNursingStructured',
      label: 'Diagnósticos enfermería (NANDA)',
      systemsAllowed: ['NANDA'],
    });

    fireEvent.changeText(getByPlaceholderText('Buscar diagnóstico...'), 'oxigenación');
    expect(queryByText('Oxigenación alterada (00001) · NANDA')).toBeNull();

    await flushSearchDebounce();

    expect(getByText('Oxigenación alterada (00001) · NANDA')).toBeTruthy();
  });

  it('muestra sugerencias según la búsqueda y añade diagnósticos', async () => {
    vi.useFakeTimers();
    const { getByPlaceholderText, getByTestId, methods } = renderWithForm();

    fireEvent.changeText(getByPlaceholderText('Buscar diagnóstico...'), 'asma');
    await flushSearchDebounce();

    await act(async () => {
      fireEvent.press(getByTestId('diagnosis-suggestion-SNOMED-195967001'));
    });

    expect(methods.getValues('dxMedicalStructured')).toHaveLength(1);
  });

  it('permite eliminar diagnósticos añadidos', async () => {
    vi.useFakeTimers();
    const { getByPlaceholderText, getByTestId, getByText, methods } = renderWithForm();

    fireEvent.changeText(getByPlaceholderText('Buscar diagnóstico...'), 'asma');
    await flushSearchDebounce();

    await act(async () => {
      fireEvent.press(getByTestId('diagnosis-suggestion-SNOMED-195967001'));
    });

    expect(methods.getValues('dxMedicalStructured')).toHaveLength(1);

    fireEvent.press(getByText('Eliminar'));

    expect(methods.getValues('dxMedicalStructured')).toHaveLength(0);
  });

  it('autocompleta dxNursing legado al seleccionar el primer NANDA', async () => {
    vi.useFakeTimers();
    const { getByPlaceholderText, getByTestId, methods } = renderWithForm({
      name: 'dxNursingStructured',
      label: 'Diagnósticos enfermería (NANDA)',
      systemsAllowed: ['NANDA'],
    });

    fireEvent.changeText(getByPlaceholderText('Buscar diagnóstico...'), 'oxigenación');
    await flushSearchDebounce();
    fireEvent.press(getByTestId('diagnosis-suggestion-NANDA-00001'));

    await waitFor(() => {
      expect(methods.getValues('dxNursingStructured')).toHaveLength(1);
      expect(methods.getValues('dxNursing')).toBe('Oxigenación alterada');
    });
  });

  it('mantiene el catálogo local si el backend no ofrece un catálogo licenciado', async () => {
    vi.spyOn(nandaCatalogModule, 'loadNandaCatalog').mockResolvedValue({
      ...nandaCatalogModule.getNandaPlaceholderCatalog(),
      source: 'backend-placeholder',
      licensed: false,
    });

    const { getByTestId, getByText } = renderWithForm({
      name: 'dxNursingStructured',
      label: 'Diagnósticos enfermería (NANDA)',
      systemsAllowed: ['NANDA'],
    });

    await act(async () => {
      fireEvent.press(getByTestId('enable-full-nanda-button'));
    });

    await waitFor(() => {
      expect(getByText('No hay un catálogo NANDA licenciado configurado; se mantiene el catálogo local.')).toBeTruthy();
    });
  });
});
