export interface ProfileRegressionScenario {
  fixtureFile: string;
  now: string;
  activation: {
    unitProfiles: readonly string[];
    specialtyOverlays?: readonly string[];
  };
  unitId: string;
  specialtyId: string;
  unitsConfig?: unknown;
  values: Record<string, unknown>;
}

const baseChecklist = {
  patientIdentityConfirmed: true,
  allergiesReviewed: true,
  linesAndDevicesChecked: true,
  medicationPlanReviewed: true,
  safetyMeasuresApplied: true,
  questionsAnswered: true,
};

const baseAuthor = { id: 'nurse-fixture', display: 'Fixture Nurse' };

export const PROFILE_REGRESSION_SCENARIOS: readonly ProfileRegressionScenario[] = [
  {
    fixtureFile: 'uci-adulto-contextual-bundle.json',
    now: '2026-03-08T15:05:00Z',
    activation: {
      unitProfiles: ['critical-care'],
    },
    unitId: 'icu-a',
    specialtyId: 'icu',
    values: {
      patientId: 'fixture-icu-1',
      encounterId: 'enc-fixture-icu-1',
      author: baseAuthor,
      bedsideChecklist: baseChecklist,
      administrativeData: {
        unit: 'UCI Adulto · Ala A',
        census: 12,
        staffIn: ['Ana'],
        staffOut: ['Luis'],
        shiftStart: '2026-03-08T07:00:00Z',
        shiftEnd: '2026-03-08T15:00:00Z',
        shiftType: 'Mañana',
      },
      vitals: {
        rr: 27,
        spo2: 91,
        tempC: 38.2,
        sbp: 89,
        hr: 124,
        o2: true,
        avpu: 'V',
      },
      treatments: [
        {
          id: 'icu-vasoactive-check',
          type: 'other',
          description: 'Titular vasoactivo y verificar acceso central',
          scheduledAt: '2026-03-08T15:10:00Z',
        },
      ],
      pendingTasks: [
        {
          id: 'icu-task-vaso',
          category: 'critical-task',
          title: 'Titular noradrenalina y revaluar perfusión',
          status: 'pending',
          priority: 'critical',
          dueBy: '2026-03-08T15:10:00Z',
        },
      ],
      closingSummary: 'Paciente crítico con soporte vasoactivo y vigilancia respiratoria estrecha.',
    },
  },
  {
    fixtureFile: 'hospitalizacion-general-medicina-interna-contextual-bundle.json',
    now: '2026-03-09T15:05:00Z',
    activation: {
      unitProfiles: ['general-inpatient'],
    },
    unitId: 'ward-mi',
    specialtyId: 'med',
    unitsConfig: {
      units: [
        {
          id: 'ward-mi',
          name: 'Medicina Interna A',
          specialty: 'med',
          profileId: 'general-inpatient',
        },
      ],
    },
    values: {
      patientId: 'fixture-ward-1',
      encounterId: 'enc-fixture-ward-1',
      author: baseAuthor,
      bedsideChecklist: baseChecklist,
      administrativeData: {
        unit: 'Medicina Interna A',
        census: 26,
        staffIn: ['Marta'],
        staffOut: ['Elena'],
        shiftStart: '2026-03-09T07:00:00Z',
        shiftEnd: '2026-03-09T15:00:00Z',
        shiftType: 'Mañana',
      },
      vitals: {
        rr: 20,
        spo2: 95,
        tempC: 37.6,
        sbp: 112,
        hr: 98,
      },
      treatments: [
        {
          id: 'ward-med-rec',
          type: 'other',
          description: 'Conciliar medicación basal y plan de alta compleja',
          scheduledAt: '2026-03-09T15:20:00Z',
        },
      ],
      outcomes: [
        {
          nocCode: '0907',
          nocDisplay: 'Conocimiento: medicación',
          baseline: 2,
          target: 4,
          current: 3,
        },
      ],
      pendingTasks: [
        {
          id: 'ward-task-recon',
          category: 'critical-task',
          title: 'Revisar conciliación y plan de alta compleja',
          status: 'pending',
          priority: 'critical',
          dueBy: '2026-03-09T15:20:00Z',
        },
      ],
      closingSummary: 'Paciente de medicina interna con riesgo de omisión terapéutica y continuidad de alta.',
    },
  },
  {
    fixtureFile: 'urgencias-contextual-bundle.json',
    now: '2026-03-10T15:05:00Z',
    activation: {
      unitProfiles: ['emergency'],
    },
    unitId: 'ed-main',
    specialtyId: 'ed',
    values: {
      patientId: 'fixture-ed-1',
      encounterId: 'enc-fixture-ed-1',
      author: baseAuthor,
      bedsideChecklist: baseChecklist,
      administrativeData: {
        unit: 'Urgencias Central',
        census: 18,
        staffIn: ['Rocío'],
        staffOut: ['Pablo'],
        shiftStart: '2026-03-10T07:00:00Z',
        shiftEnd: '2026-03-10T15:00:00Z',
        shiftType: 'Mañana',
      },
      vitals: {
        rr: 24,
        spo2: 93,
        tempC: 38,
        sbp: 101,
        hr: 118,
      },
      treatments: [
        {
          id: 'ed-transfer',
          type: 'other',
          description: 'Confirmar triage, reevaluación y destino probable',
          scheduledAt: '2026-03-10T15:15:00Z',
        },
      ],
      pendingTasks: [
        {
          id: 'ed-task-reeval',
          category: 'critical-task',
          title: 'Reevaluar box y documentar destino probable',
          status: 'pending',
          priority: 'critical',
          dueBy: '2026-03-10T15:15:00Z',
        },
      ],
      closingSummary: 'Paciente en urgencias con reevaluación obligatoria y coordinación inmediata de destino.',
    },
  },
  {
    fixtureFile: 'oncologia-eoprop-ia-contextual-bundle.json',
    now: '2026-03-11T15:05:00Z',
    activation: {
      unitProfiles: ['ambulatory'],
      specialtyOverlays: ['onc'],
    },
    unitId: 'onc-ward',
    specialtyId: 'onc',
    values: {
      patientId: 'fixture-onc-1',
      encounterId: 'enc-fixture-onc-1',
      author: baseAuthor,
      bedsideChecklist: baseChecklist,
      administrativeData: {
        unit: 'Hospital de Día Oncología',
        census: 14,
        staffIn: ['Sara'],
        staffOut: ['Noa'],
        shiftStart: '2026-03-11T07:00:00Z',
        shiftEnd: '2026-03-11T15:00:00Z',
        shiftType: 'Mañana',
      },
      vitals: {
        rr: 23,
        spo2: 95,
        tempC: 38.4,
        sbp: 104,
        hr: 118,
      },
      treatments: [
        {
          id: 'onc-extravasation-watch',
          type: 'other',
          description: 'Vigilar CVC, fiebre y toxicidad sistémica',
          scheduledAt: '2026-03-11T15:10:00Z',
        },
      ],
      outcomes: [
        {
          nocCode: '1609',
          nocDisplay: 'Control de síntomas',
          baseline: 2,
          target: 4,
          current: 2,
        },
      ],
      pendingTasks: [
        {
          id: 'onc-task-neutropenia',
          category: 'critical-task',
          title: 'Tomar cultivos y avisar fiebre en neutropenia',
          status: 'pending',
          priority: 'critical',
          dueBy: '2026-03-11T15:10:00Z',
        },
      ],
      closingSummary: 'Paciente oncohematológico con riesgo de neutropenia febril y continuidad segura de terapia.',
    },
  },
] as const;
