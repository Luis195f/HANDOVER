import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { FormProvider, useForm, type UseFormReturn } from 'react-hook-form';

import ClinicalScalesSection from '../components/ClinicalScalesSection';
import EliminationSection from '../components/EliminationSection';
import FluidBalanceSection from '../components/FluidBalanceSection';
import MobilitySkinSection from '../components/MobilitySkinSection';
import NutritionSection from '../components/NutritionSection';
import PsychosocialSection from '../components/PsychosocialSection';
import type { HandoverValues as HandoverFormValues } from '@/src/validation/schemas';

const defaultValues: HandoverFormValues = {
  administrativeData: {
    unit: '',
    census: 0,
    staffIn: [],
    staffOut: [],
    shiftStart: '',
    shiftEnd: '',
    shiftType: 'Mañana',
    incidents: [],
  },
  attachments: [],
  patientId: 'pat-001',
  status: 'draft',
  bedsideChecklist: {
    patientIdentityConfirmed: true,
    allergiesReviewed: true,
    linesAndDevicesChecked: false,
    medicationPlanReviewed: false,
    safetyMeasuresApplied: false,
    questionsAnswered: false,
  },
  medications: [],
  treatments: [],
  exams: [],
  procedures: [],
  meds: '',
  devices: [],
  risksStructured: [],
};

const parseNumber = (value: string) => {
  if (value === '') return undefined;
  const normalized = value.replace(',', '.');
  const parsed = Number(normalized);
  return Number.isNaN(parsed) ? undefined : parsed;
};

function renderWithForm(children: React.ReactNode) {
  let methodsReturn: UseFormReturn<HandoverFormValues> | undefined;

  function Wrapper() {
    const methods = useForm<HandoverFormValues>({ defaultValues });
    methodsReturn = methods;
    return <FormProvider {...methods}>{children}</FormProvider>;
  }

  const result = render(<Wrapper />);
  return { ...result, methods: methodsReturn! };
}

describe('Nursing sections', () => {
  it('registra nutrición y eliminación', async () => {
    const { getAllByText, getByText, getByPlaceholderText, getByLabelText, methods } = renderWithForm(
      <>
        <NutritionSection parseNumber={parseNumber} />
        <EliminationSection parseNumber={parseNumber} />
      </>,
    );

    // Hay 2 pickers con placeholder "Seleccionar": dieta y patrón deposiciones.
    // Capturamos ambos antes de cambiar el texto del primero.
    const selectButtons = getAllByText('Seleccionar');
    const dietSelect = selectButtons[0];
    const stoolSelect = selectButtons[1];

    fireEvent.press(dietSelect);
    fireEvent.press(getByText('Oral'));
    fireEvent.changeText(getByPlaceholderText('Observaciones de tolerancia'), 'Buena tolerancia');
    fireEvent.changeText(getByPlaceholderText('500'), '650');

    fireEvent.changeText(getByPlaceholderText('800'), '900');
    fireEvent.press(stoolSelect);
    fireEvent.press(getByText('Diarrea'));
    fireEvent(getByLabelText('Sonda rectal'), 'valueChange', true);

    await waitFor(() => {
      expect(methods.getValues('nutrition')).toEqual({
        dietType: 'oral',
        tolerance: 'Buena tolerancia',
        intakeMl: 650,
      });
      expect(methods.getValues('elimination')).toEqual({
        urineMl: 900,
        stoolPattern: 'diarrhea',
        hasRectalTube: true,
      });
    });
  });

  it('calcula balance hídrico y registra movilidad, piel y psicosocial', async () => {
    const { getAllByText, getByText, getByPlaceholderText, getByTestId, getByLabelText, methods } =
      renderWithForm(
        <>
          <FluidBalanceSection parseNumber={parseNumber} />
          <MobilitySkinSection />
          <PsychosocialSection />
        </>,
      );

    fireEvent.changeText(getByPlaceholderText('1000'), '1500');
    fireEvent.changeText(getByPlaceholderText('900'), '1200');

    // Puede haber más de un "Seleccionar" en pantalla; aquí tomamos el primero visible
    // (movilidad suele ser el primero en esta composición).
    const selects = getAllByText('Seleccionar');
    fireEvent.press(selects[0]);
    fireEvent.press(getByText('Con ayuda'));

    fireEvent.changeText(getByPlaceholderText('Ej: cada 2 horas'), 'Cada 2h');
    fireEvent.changeText(getByPlaceholderText('Ej: Íntegra'), 'Lesión sacra');
    fireEvent(getByLabelText('Úlcera por presión'), 'valueChange', true);

    fireEvent.changeText(getByPlaceholderText('Ej: tranquilo, ansioso'), 'Ansioso');
    fireEvent.changeText(
      getByPlaceholderText('Ej: Familia presente en turno de tarde'),
      'Hermano en visita',
    );
    fireEvent(getByLabelText('Visitas familiares'), 'valueChange', true);

    await waitFor(() => {
      expect(getByTestId('fluidBalance.netBalanceDisplay').props.value).toBe('+300 mL');

      expect(methods.getValues('fluidBalance')).toMatchObject({
        intakeMl: 1500,
        outputMl: 1200,
        netBalanceMl: 300,
      });
      expect(methods.getValues('mobility')).toEqual({
        mobilityLevel: 'assisted',
        repositioningPlan: 'Cada 2h',
      });
      expect(methods.getValues('skin')).toEqual({
        skinStatus: 'Lesión sacra',
        hasPressureInjury: true,
      });
      expect(methods.getValues('psychosocial')).toEqual({
        emotionalStatus: 'Ansioso',
        familyNotes: 'Hermano en visita',
        familyVisits: true,
      });
    });
  });

  it('actualiza el puntaje total de Glasgow al seleccionar componentes', async () => {
    const { getByText } = renderWithForm(<ClinicalScalesSection />);

    fireEvent.press(getByText('4: Espontánea'));
    fireEvent.press(getByText('4: Confuso'));
    fireEvent.press(getByText('4: Retirada'));

    await waitFor(() => {
      expect(getByText('12')).toBeTruthy();
      expect(getByText('Moderado')).toBeTruthy();
    });
  });
});
