import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { FormProvider, useForm, type UseFormReturn } from 'react-hook-form';

import { ContingencyPlanSection } from '../components/BedsideChecklistSection';
import ClinicalScalesSection from '../components/ClinicalScalesSection';
import EliminationSection from '../components/EliminationSection';
import ExamsProceduresSection from '../components/ExamsProceduresSection';
import FluidBalanceSection from '../components/FluidBalanceSection';
import MobilitySkinSection from '../components/MobilitySkinSection';
import NutritionSection from '../components/NutritionSection';
import PendingTasksSection from '../components/PendingTasksSection';
import PsychosocialSection from '../components/PsychosocialSection';
import type { HandoverValues as HandoverFormValues } from '@/src/validation/schemas';
import { SNOMED_SYSTEM } from '@/src/data/snomed-dict';

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
  dxMedical: { system: SNOMED_SYSTEM, code: '195967001', display: 'Neumonía' },
  dxNursing: 'Fiebre',
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
  pendingTasks: [],
  exams: [],
  procedures: [],
  contingencyPlan: {
    watchItems: [],
    immediateActions: [],
    escalationCriteria: [],
    escalationContact: '',
    fallbackPlan: '',
  },
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
    const { getByText, getByPlaceholderText, getByLabelText, getByTestId, methods } = renderWithForm(
      <>
        <NutritionSection parseNumber={parseNumber} />
        <EliminationSection parseNumber={parseNumber} />
      </>,
    );

    // Dieta (estable por testID)
    fireEvent.press(getByTestId('nutrition.dietType.trigger'));
    fireEvent.press(getByTestId('nutrition.dietType.option.oral'));

    fireEvent.changeText(getByPlaceholderText('Observaciones de tolerancia'), 'Buena tolerancia');
    fireEvent.changeText(getByPlaceholderText('500'), '650');

    // Urina
    fireEvent.changeText(getByPlaceholderText('800'), '900');

    // Patrón deposicional (si se vuelve ambiguo, se migra a testID igual que dieta)
    fireEvent.press(getByTestId('elimination.stoolPattern.trigger'));
    fireEvent.press(getByTestId('elimination.stoolPattern.option.diarrhea'));
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
    const { getByPlaceholderText, getByTestId, getByLabelText, methods } = renderWithForm(
      <>
        <FluidBalanceSection parseNumber={parseNumber} />
        <MobilitySkinSection />
        <PsychosocialSection />
      </>,
    );

    fireEvent.changeText(getByPlaceholderText('1000'), '1500');
    fireEvent.changeText(getByPlaceholderText('900'), '1200');

    // Movilidad (estable por testID)
    fireEvent.press(getByTestId('mobility.mobilityLevel.trigger'));
    fireEvent.press(getByTestId('mobility.mobilityLevel.option.assisted'));

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
      // Si tu FluidBalanceSection tiene el input read-only con testID:
      // <TextInput testID="fluidBalance.netBalanceDisplay" ... />
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

  it('registra pendientes criticos con escalado operativo', async () => {
    const { getByLabelText, getByText, methods } = renderWithForm(<PendingTasksSection />);

    fireEvent.press(getByLabelText('Tipo pendiente Escalado'));
    fireEvent.press(getByLabelText('Prioridad pendiente Crítico'));
    fireEvent.changeText(getByLabelText('Detalle de pendiente'), 'Avisar si cae la PAM');
    fireEvent.changeText(getByLabelText('Hora objetivo del pendiente'), '2026-03-19T10:30:00Z');
    fireEvent.changeText(getByLabelText('Responsable del pendiente'), 'Médico de guardia');
    fireEvent.changeText(
      getByLabelText('Criterio de escalado del pendiente'),
      'Avisar si PAM < 65 mmHg sostenida',
    );
    fireEvent.changeText(getByLabelText('Notas del pendiente'), 'Revisar perfusión y vasoactivos');
    fireEvent.press(getByText('Añadir pendiente'));

    await waitFor(() => {
      expect(methods.getValues('pendingTasks')).toEqual([
        expect.objectContaining({
          category: 'escalation',
          priority: 'critical',
          title: 'Avisar si cae la PAM',
          dueBy: '2026-03-19T10:30:00Z',
          owner: 'Médico de guardia',
          escalationCriteria: 'Avisar si PAM < 65 mmHg sostenida',
          notes: 'Revisar perfusión y vasoactivos',
        }),
      ]);
    });
  });

  it('captura contingencias, examenes y procedimientos sin duplicar el cierre', async () => {
    const { getByLabelText, getByText, methods } = renderWithForm(
      <>
        <ContingencyPlanSection />
        <ExamsProceduresSection />
      </>,
    );

    fireEvent.changeText(getByLabelText('Qué vigilar'), 'SatO2\nDiuresis');
    fireEvent.changeText(getByLabelText('Qué hacer primero'), 'Reevaluar VM\nConfirmar balance');
    fireEvent.changeText(
      getByLabelText('Criterios de escalado'),
      'SatO2 < 92%\nDiuresis < 0.5 ml/kg/h',
    );
    fireEvent.changeText(getByLabelText('Contacto de escalado'), 'Médico intensivista');
    fireEvent.changeText(
      getByLabelText('Plan de contingencia'),
      'Si no responde, preparar gases y avisar a supervisor',
    );

    fireEvent.press(getByLabelText('Seleccionar estado Pendiente'));
    fireEvent.press(getByLabelText('Prioridad examen Crítico'));
    fireEvent.changeText(getByLabelText('Descripción de examen'), 'Gasometría arterial');
    fireEvent.changeText(getByLabelText('Hora objetivo de examen'), '2026-03-19T11:00:00Z');
    fireEvent.changeText(getByLabelText('Responsable de examen'), 'Laboratorio');
    fireEvent.press(getByText('Añadir examen'));

    fireEvent.changeText(getByLabelText('Descripción de procedimiento'), 'Cambio de curación');
    fireEvent.press(getByLabelText('Prioridad procedimiento Urgente'));
    fireEvent.changeText(getByLabelText('Hora de procedimiento'), '2026-03-19T12:00:00Z');
    fireEvent.changeText(getByLabelText('Responsable de procedimiento'), 'Enfermería');
    fireEvent.changeText(
      getByLabelText('Criterio de escalado de procedimiento'),
      'Avisar si sangrado activo',
    );
    fireEvent.press(getByText('Añadir procedimiento'));

    await waitFor(() => {
      expect(methods.getValues('contingencyPlan')).toEqual({
        watchItems: ['SatO2', 'Diuresis'],
        immediateActions: ['Reevaluar VM', 'Confirmar balance'],
        escalationCriteria: ['SatO2 < 92%', 'Diuresis < 0.5 ml/kg/h'],
        escalationContact: 'Médico intensivista',
        fallbackPlan: 'Si no responde, preparar gases y avisar a supervisor',
      });

      expect(methods.getValues('exams')).toEqual([
        expect.objectContaining({
          state: 'pending',
          priority: 'critical',
          description: 'Gasometría arterial',
          dueBy: '2026-03-19T11:00:00Z',
          responsible: 'Laboratorio',
        }),
      ]);

      expect(methods.getValues('procedures')).toEqual([
        expect.objectContaining({
          description: 'Cambio de curación',
          priority: 'urgent',
          scheduledFor: '2026-03-19T12:00:00Z',
          responsible: 'Enfermería',
          escalationCriteria: 'Avisar si sangrado activo',
        }),
      ]);
    });
  });
});
