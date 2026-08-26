import { UNITS } from '@/src/config/units';
import { SNOMED_SYSTEM } from '@/src/data/snomed-dict';
import { buildDemoAdminDashboardSummary } from '@/src/mock/admin/dashboard-fixture';
import type { PatientSummary } from '@/src/lib/fhir-client';
import type { HandoverSession } from '@/src/security/auth-types';
import type { PatientListItem } from '@/src/types/patientList';
import type { HandoverValues } from '@/src/validation/schemas';

// BEGIN HANDOVER: DEMO_MODE
export const DEMO_USER_ID = 'demo@nurseos.app';
export const DEMO_RECEIVER_USER_ID = 'demo.receiver@nurseos.app';
export const DEMO_NOW = '2026-08-27T07:30:00.000Z';

const demoTime = (offsetMinutes: number) =>
  new Date(new Date(DEMO_NOW).getTime() + offsetMinutes * 60_000).toISOString();
const DEMO_SHIFT_START = demoTime(-90);
const DEMO_SHIFT_END = demoTime(390);

export const DEMO_ACTOR_IDS = [DEMO_USER_ID, DEMO_RECEIVER_USER_ID] as const;
export type DemoActorId = (typeof DEMO_ACTOR_IDS)[number];

export type DemoActorIdentity = {
  userId: DemoActorId;
  displayName: string;
  email: string;
  kind: 'outgoing' | 'incoming';
  synthetic: true;
  roles: string[];
  units: string[];
};

const DEMO_UNIT_IDS = UNITS.map((unit) => unit.id);

export const DEMO_ACTORS: readonly DemoActorIdentity[] = [
  {
    userId: DEMO_USER_ID,
    displayName: 'Profesional saliente demo (sintetica)',
    email: 'outgoing-demo@example.invalid',
    kind: 'outgoing',
    synthetic: true,
    roles: ['nurse'],
    units: [...DEMO_UNIT_IDS],
  },
  {
    userId: DEMO_RECEIVER_USER_ID,
    displayName: 'Profesional receptora demo (sintetica)',
    email: 'incoming-demo@example.invalid',
    kind: 'incoming',
    synthetic: true,
    roles: ['nurse'],
    units: [...DEMO_UNIT_IDS],
  },
];

export function isDemoActorId(userId: string): userId is DemoActorId {
  return DEMO_ACTOR_IDS.some((candidate) => candidate === userId);
}

export function getDemoActorIdentity(userId: string): DemoActorIdentity | null {
  return DEMO_ACTORS.find((actor) => actor.userId === userId) ?? null;
}

function buildDemoSession(actor: DemoActorIdentity, expiresAt?: string): HandoverSession {
  return {
    userId: actor.userId,
    displayName: actor.displayName,
    email: actor.email,
    roles: [...actor.roles],
    units: [...actor.units],
    accessToken: 'demo-token',
    refreshToken: undefined,
    expiresAt,
    mode: 'demo',
  };
}

export const DEMO_SESSION_TEMPLATE: HandoverSession = buildDemoSession(DEMO_ACTORS[0]);

type DemoPatientFixture = {
  patient: PatientListItem;
  summary: PatientSummary;
  birthDate: string;
  gender: 'female' | 'male';
  encounterId: string;
  locationId: string;
  clinical: {
    diagnosis: NonNullable<HandoverValues['dxMedical']>;
    medications: HandoverValues['medications'];
  };
};

export type DemoExceptionStatus = 'unchanged' | 'changed' | 'critical';

export type DemoExceptionHandoverPatient = {
  patientId: string;
  name: string;
  bedLabel: string;
  unitName: string;
  status: DemoExceptionStatus;
  change: string;
  currentRisk: string;
  nextAction: string;
  owner: string;
  dueAt: string;
  contingency: {
    trigger: string;
    response: string;
  };
  lastSummaryAt: string;
  lastSummarySource: string;
  criticalItems: readonly string[];
};

const BASE_DEMO_PATIENT_FIXTURES: readonly DemoPatientFixture[] = [
  {
    patient: {
      id: 'demo-psych-adult-001',
      name: 'Caso sintetico adulto',
      unitId: 'sjd-a',
      bedLabel: 'SMA-A-01',
      vitals: { rr: 18, spo2: 97, tempC: 36.8, sbp: 118, hr: 84, o2: false, avpu: 'A' },
      risks: { fall: true },
      pendingTasks: [
        {
          id: 'task-demo-psych-adult-obs',
          title: 'Reevaluar observacion especial, entorno seguro y riesgo de fuga/no retorno',
          critical: true,
          priority: 'critical',
          category: 'reevaluation',
          dueBy: demoTime(90),
        },
        {
          id: 'task-demo-psych-adult-med',
          title: 'Cerrar adherencia terapeutica y medicacion no omitible del siguiente turno',
          urgent: true,
          priority: 'urgent',
          category: 'critical-task',
          dueBy: demoTime(150),
        },
      ],
    },
    summary: {
      id: 'demo-psych-adult-001',
      name: 'Caso sintetico adulto',
      gender: 'female',
      age: 42,
      bed: 'SMA-A-01',
      mrn: 'MRN-DEMO-PSY-001',
      allergies: ['Alergia sintetica documentada'],
    },
    birthDate: '1984-03-18',
    gender: 'female',
    encounterId: 'enc-demo-psych-adult-001',
    locationId: 'loc-demo-psych-adult-001',
    clinical: {
      diagnosis: { system: SNOMED_SYSTEM, code: '31535000', display: 'Crisis de ansiedad' },
      medications: [
        {
          id: 'med-demo-psych-adult-001-sertralina',
          name: 'Sertralina',
          code: {
            system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
            code: '36437',
            display: 'Sertralina',
          },
          dose: '50 mg',
          route: 'oral',
          frequency: '08:00',
          isContinuous: false,
          isContinuousInfusion: false,
          isHighAlert: false,
        },
      ],
    },
  },
  {
    patient: {
      id: 'demo-psych-child-001',
      name: 'Caso sintetico infanto',
      unitId: 'sjd-infanto',
      bedLabel: 'SMI-02',
      vitals: { rr: 19, spo2: 98, tempC: 36.7, sbp: 109, hr: 88, o2: false, avpu: 'A' },
      pendingTasks: [
        {
          id: 'task-demo-psych-child-safe',
          title: 'Verificar acompanamiento, entorno seguro y elementos retirables antes del cambio de actividad',
          urgent: true,
          priority: 'urgent',
          category: 'reevaluation',
          dueBy: demoTime(120),
        },
        {
          id: 'task-demo-psych-child-followup',
          title: 'Cerrar rechazo terapeutico parcial, retorno seguro y coordinacion con tutor del siguiente turno',
          critical: true,
          priority: 'critical',
          category: 'critical-task',
          dueBy: demoTime(180),
        },
      ],
    },
    summary: {
      id: 'demo-psych-child-001',
      name: 'Caso sintetico infanto',
      gender: 'male',
      age: 15,
      bed: 'SMI-02',
      mrn: 'MRN-DEMO-PSY-002',
      allergies: ['Sin alergias sinteticas activas'],
    },
    birthDate: '2010-11-02',
    gender: 'male',
    encounterId: 'enc-demo-psych-child-001',
    locationId: 'loc-demo-psych-child-001',
    clinical: {
      diagnosis: { system: SNOMED_SYSTEM, code: '57177007', display: 'Agitación psicomotriz' },
      medications: [],
    },
  },
  {
    patient: {
      id: 'demo-psych-udcc-001',
      name: 'Caso sintetico psicogeriatria',
      unitId: 'udcc-psychogeriatrics',
      bedLabel: 'PG-03',
      vitals: { rr: 17, spo2: 96, tempC: 36.5, sbp: 124, hr: 79, o2: false, avpu: 'A' },
      devices: [
        { id: 'dev-demo-udcc-walker', label: 'Andador supervisado', category: 'support' },
        { id: 'dev-demo-udcc-urinary', label: 'Sonda vesical sintetica', category: 'invasive' },
      ],
      risks: { fall: true },
      pendingTasks: [
        {
          id: 'task-demo-psych-udcc-gait',
          title: 'Reevaluar deambulacion supervisada, riesgo de caidas y continuidad del turno siguiente',
          critical: true,
          priority: 'critical',
          category: 'reevaluation',
          dueBy: demoTime(105),
        },
        {
          id: 'task-demo-psych-udcc-hydration',
          title: 'Vigilar diuresis por sonda y estreñimiento; ultima deposicion sintetica hace 2 dias',
          urgent: true,
          priority: 'urgent',
          category: 'critical-task',
          dueBy: demoTime(165),
        },
      ],
    },
    summary: {
      id: 'demo-psych-udcc-001',
      name: 'Caso sintetico psicogeriatria',
      gender: 'female',
      age: 82,
      bed: 'PG-03',
      mrn: 'MRN-DEMO-PSY-003',
      allergies: ['Alergia sintetica a antiinflamatorio'],
    },
    birthDate: '1943-07-09',
    gender: 'female',
    encounterId: 'enc-demo-psych-udcc-001',
    locationId: 'loc-demo-psych-udcc-001',
    clinical: {
      diagnosis: { system: SNOMED_SYSTEM, code: '90128006', display: 'Delirium' },
      medications: [],
    },
  },
  {
    patient: {
      id: 'demo-psych-adult-002',
      name: 'Caso sintetico adulto seguimiento',
      unitId: 'sjd-a',
      bedLabel: 'SMA-A-02',
      vitals: { rr: 16, spo2: 98, tempC: 36.7, sbp: 116, hr: 76, o2: false, avpu: 'A' },
      pendingTasks: [
        {
          id: 'task-demo-psych-adult-002-sleep',
          title: 'Revisar descanso nocturno y respuesta a medidas no farmacológicas.',
          priority: 'routine',
          category: 'reevaluation',
          dueBy: demoTime(210),
        },
      ],
    },
    summary: {
      id: 'demo-psych-adult-002',
      name: 'Caso sintetico adulto seguimiento',
      gender: 'female',
      age: 35,
      bed: 'SMA-A-02',
      mrn: 'MRN-DEMO-PSY-004',
      allergies: ['Sin alergias sinteticas activas'],
    },
    birthDate: '1991-04-22',
    gender: 'female',
    encounterId: 'enc-demo-psych-adult-002',
    locationId: 'loc-demo-psych-adult-002',
    clinical: {
      diagnosis: { system: SNOMED_SYSTEM, code: '20617004', display: 'Insomnio' },
      medications: [],
    },
  },
] as const;

const GENERATED_DEMO_PATIENT_FIXTURES: DemoPatientFixture[] = Array.from(
  { length: 36 },
  (_, offset) => {
    const position = offset + 5;
    const suffix = String(position).padStart(3, '0');
    const id = `demo-psych-unit-${suffix}`;
    const bedLabel = `SMA-A-${String(position).padStart(2, '0')}`;

    return {
      patient: {
        id,
        name: `Caso sintético de unidad ${String(position).padStart(2, '0')}`,
        unitId: 'sjd-a',
        bedLabel,
        vitals: { rr: 17, spo2: 98, tempC: 36.6, sbp: 117, hr: 78, o2: false, avpu: 'A' },
        pendingTasks: [],
      },
      summary: {
        id,
        name: `Caso sintético de unidad ${String(position).padStart(2, '0')}`,
        gender: position % 2 === 0 ? 'female' : 'male',
        age: 30 + (position % 35),
        bed: bedLabel,
        mrn: `MRN-DEMO-UNIT-${suffix}`,
        allergies: ['Sin alergias sintéticas activas registradas'],
      },
      birthDate: `${1970 + (position % 30)}-01-15`,
      gender: position % 2 === 0 ? 'female' : 'male',
      encounterId: `enc-${id}`,
      locationId: `loc-${id}`,
      clinical: {
        diagnosis: {
          system: SNOMED_SYSTEM,
          code: '31535000',
          display: 'Contexto sintético de salud mental',
        },
        medications: [],
      },
    };
  },
);

const DEMO_PATIENT_FIXTURES: readonly DemoPatientFixture[] = [
  ...BASE_DEMO_PATIENT_FIXTURES,
  ...GENERATED_DEMO_PATIENT_FIXTURES,
];

const DEMO_UNIT_NAME = 'Unidad sintética de salud mental';

export const DEMO_EXCEPTION_HANDOVER_PATIENTS: readonly DemoExceptionHandoverPatient[] =
  DEMO_PATIENT_FIXTURES.map((fixture, index) => {
    const position = index + 1;
    const status: DemoExceptionStatus =
      position === 1 || position === 3
        ? 'critical'
        : position === 2 || (position >= 5 && position <= 9)
          ? 'changed'
          : 'unchanged';
    const isCritical = status === 'critical';
    const isChanged = status === 'changed';

    return {
      patientId: fixture.patient.id,
      name: fixture.patient.name,
      bedLabel: fixture.patient.bedLabel ?? `SMA-A-${String(position).padStart(2, '0')}`,
      unitName: DEMO_UNIT_NAME,
      status,
      change: isCritical
        ? 'Cambio conductual agudo registrado durante el turno sintético.'
        : isChanged
          ? 'Cambio en descanso, adherencia o participación respecto al resumen sintético previo.'
          : 'Sin novedades registradas para este relevo.',
      currentRisk: isCritical
        ? 'Prioridad alta por riesgo de seguridad y necesidad de observación reforzada registrada.'
        : isChanged
          ? 'Requiere seguimiento dirigido; no se registra inestabilidad en el resumen sintético.'
          : 'La clasificación procede de un estado sintético explícito y no valida valores clínicos actuales.',
      nextAction: isCritical
        ? 'Reevaluar observación y acordar el plan inmediato con el referente clínico.'
        : isChanged
          ? 'Revisar la novedad y cerrar el pendiente principal con el equipo entrante.'
          : 'Abrir el detalle solo si el equipo necesita contexto adicional.',
      owner: isCritical ? 'Profesional entrante y referente clínico demo' : 'Profesional entrante demo',
      dueAt: demoTime(isCritical ? 30 + position * 5 : 90 + position * 5),
      contingency: {
        trigger: isCritical ? 'aumenta el riesgo de seguridad o la agitación' : 'la novedad progresa o no puede cerrarse',
        response: isCritical
          ? 'mantener el entorno seguro y avisar al referente clínico según el protocolo local'
          : 'reevaluar y avisar al referente clínico demo',
      },
      lastSummaryAt: demoTime(-20 - position),
      lastSummarySource: 'Resumen sintético del turno previo',
      criticalItems: isCritical
        ? [
            'Nivel de observación y medidas de entorno seguro.',
            'Acción pendiente, responsable y momento objetivo.',
            'Criterio de aviso al referente clínico.',
          ]
        : [],
    };
  });

const DEMO_EXCEPTION_HANDOVER_BY_ID = Object.fromEntries(
  DEMO_EXCEPTION_HANDOVER_PATIENTS.map((patient) => [patient.patientId, patient]),
) as Record<string, DemoExceptionHandoverPatient>;

export function getDemoExceptionHandoverPatient(
  patientId?: string | null,
): DemoExceptionHandoverPatient | null {
  return patientId ? DEMO_EXCEPTION_HANDOVER_BY_ID[patientId] ?? null : null;
}

export function getDemoExceptionHandoverPatients(
  patientIds?: readonly string[],
): DemoExceptionHandoverPatient[] {
  if (!patientIds) return [...DEMO_EXCEPTION_HANDOVER_PATIENTS];
  const visibleIds = new Set(patientIds);
  return DEMO_EXCEPTION_HANDOVER_PATIENTS.filter((patient) => visibleIds.has(patient.patientId));
}

const DEMO_PATIENT_FIXTURES_BY_ID = Object.fromEntries(
  DEMO_PATIENT_FIXTURES.map((fixture) => [fixture.patient.id, fixture]),
) as Record<string, DemoPatientFixture>;

const getDefaultDemoPatientFixture = (): DemoPatientFixture => DEMO_PATIENT_FIXTURES[0];

export const DEMO_PATIENT_SUMMARY: PatientSummary = getDefaultDemoPatientFixture().summary;

export const DEMO_PATIENTS: PatientListItem[] = DEMO_PATIENT_FIXTURES.map((fixture) => fixture.patient);

export type DemoHandoverPrefill = Pick<
  HandoverValues,
  | 'dxMedical'
  | 'vitals'
  | 'medications'
  | 'devices'
  | 'nutrition'
  | 'elimination'
  | 'exams'
  | 'evolution'
  | 'pendingTasks'
  | 'contingencyPlan'
> & {
  administrativeData: HandoverValues['administrativeData'];
  risks: NonNullable<HandoverValues['risks']>;
  risksStructured: NonNullable<HandoverValues['risksStructured']>;
} & Partial<
  Pick<
    HandoverValues,
    'sbarSituation' | 'sbarBackground' | 'sbarAssessment' | 'sbarRecommendation'
  >
>;

/** Synthetic read/confirm data for the controlled demo only. */
export function getDemoHandoverPrefill(patientId?: string | null): DemoHandoverPrefill {
  const fixture = getDemoPatientFixture(patientId);
  const exceptionHandover = getDemoExceptionHandoverPatient(fixture.patient.id);
  const activeFallRisk = fixture.patient.risks?.fall === true;
  const census = DEMO_PATIENT_FIXTURES.filter((candidate) => candidate.patient.unitId === fixture.patient.unitId).length;

  return {
    administrativeData: {
      unit: fixture.patient.unitId,
      census,
      staffOut: [DEMO_ACTORS[0].displayName],
      staffIn: [DEMO_ACTORS[1].displayName],
      shiftStart: DEMO_SHIFT_START,
      shiftEnd: DEMO_SHIFT_END,
      shiftType: 'Mañana',
      incidents: [],
    },
    dxMedical: fixture.clinical.diagnosis,
    vitals: {
      rr: fixture.patient.vitals?.rr,
      spo2: fixture.patient.vitals?.spo2,
      tempC: fixture.patient.vitals?.tempC,
      sbp: fixture.patient.vitals?.sbp,
      hr: fixture.patient.vitals?.hr,
      avpu: fixture.patient.vitals?.avpu,
      recordedAt: DEMO_NOW,
      issuedAt: demoTime(5),
    },
    medications: fixture.clinical.medications,
    devices: (fixture.patient.devices ?? []).map((device) => ({ name: device.label, active: true })),
    nutrition: {
      dietType: 'oral',
      tolerance: 'Sin incidencias sintéticas registradas en el turno previo.',
    },
    elimination:
      fixture.patient.id === 'demo-psych-udcc-001'
        ? { urineMl: 450, stoolPattern: 'constipation', hasRectalTube: false }
        : undefined,
    exams: [
      {
        type: 'other',
        state: 'pending',
        description: 'Revisión interdisciplinar sintética programada para el turno.',
        priority: 'routine',
        dueBy: demoTime(150),
      },
    ],
    evolution:
      exceptionHandover?.status === 'unchanged'
        ? 'Sin novedades registradas explícitamente para este relevo sintético; no equivale a una validación clínica actual.'
        : exceptionHandover?.change ?? 'Contexto sintético disponible para revisión profesional.',
    pendingTasks: (fixture.patient.pendingTasks ?? []).map((task) => ({
      id: task.id,
      category: task.category ?? 'other',
      title: task.title,
      status: task.status ?? 'pending',
      priority: task.priority ?? (task.critical ? 'critical' : task.urgent ? 'urgent' : 'routine'),
      dueBy: task.dueBy,
      escalationCriteria: task.escalationCriteria,
      owner: exceptionHandover?.owner,
    })),
    contingencyPlan: {
      watchItems: ['Cambio en la observación, seguridad del entorno o adherencia terapéutica.'],
      immediateActions: ['Confirmar el pendiente crítico y el plan de medicación del turno.'],
      escalationCriteria: ['Avisar al referente clínico ante cambio conductual agudo o riesgo de seguridad.'],
      escalationContact: 'Referente clínico de guardia',
      fallbackPlan: 'Mantener observación y aplicar el protocolo local de seguridad.',
    },
    risks: activeFallRisk ? { fall: true } : {},
    risksStructured: activeFallRisk
      ? [{ type: 'fall', present: true, actions: ['Mantener entorno seguro y supervisión indicada.'] }]
      : [],
  };
}

export function getDemoPatientFixture(patientId?: string | null): DemoPatientFixture {
  if (patientId && DEMO_PATIENT_FIXTURES_BY_ID[patientId]) {
    return DEMO_PATIENT_FIXTURES_BY_ID[patientId];
  }
  return getDefaultDemoPatientFixture();
}

export function getDemoFhirPatient(patientId?: string | null) {
  const fixture = getDemoPatientFixture(patientId);
  const nameWords = fixture.summary.name.split(' ').filter(Boolean);
  return {
    resourceType: 'Patient',
    id: fixture.summary.id,
    gender: fixture.gender,
    birthDate: fixture.birthDate,
    name: [
      {
        given: nameWords.slice(0, -1),
        family: nameWords.at(-1) ?? fixture.summary.name,
        text: fixture.summary.name,
      },
    ],
    identifier: [
      { system: 'https://demo.hospital/bed', type: { text: 'Cama' }, value: fixture.summary.bed },
      { system: 'https://demo.hospital/mrn', type: { text: 'MRN' }, value: fixture.summary.mrn },
    ],
  };
}

export function getDemoEncounterBundle(patientId?: string | null) {
  const fixture = getDemoPatientFixture(patientId);
  return {
    resourceType: 'Bundle',
    type: 'searchset',
    entry: [
      {
        resource: {
          resourceType: 'Encounter',
          id: fixture.encounterId,
          subject: {
            reference: `Patient/${fixture.summary.id}`,
          },
          location: [
            {
              location: {
                reference: `Location/${fixture.locationId}`,
                display: fixture.summary.bed,
              },
            },
          ],
        },
      },
      {
        resource: {
          resourceType: 'Location',
          id: fixture.locationId,
          identifier: [{ system: 'https://demo.hospital/bed', type: { text: 'Cama' }, value: fixture.summary.bed }],
        },
      },
    ],
  };
}

export function getDemoAllergyBundle(patientId?: string | null) {
  const fixture = getDemoPatientFixture(patientId);
  return {
    resourceType: 'Bundle',
    type: 'searchset',
    entry: (fixture.summary.allergies ?? []).map((allergy, index) => ({
      resource: {
        resourceType: 'AllergyIntolerance',
        id: `allergy-demo-${fixture.summary.id}-${index + 1}`,
        code: {
          text: allergy,
          coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', display: allergy }],
        },
      },
    })),
  };
}

export const DEMO_FHIR_PATIENT = getDemoFhirPatient();

export const DEMO_FHIR_ENCOUNTER_BUNDLE = getDemoEncounterBundle();

export const DEMO_FHIR_ALLERGY_BUNDLE = getDemoAllergyBundle();

export const DEMO_ADMIN_DASHBOARD = buildDemoAdminDashboardSummary();

export function ensureDemoSessionTemplate(userId: DemoActorId = DEMO_USER_ID): HandoverSession {
  const actor = getDemoActorIdentity(userId) ?? DEMO_ACTORS[0];
  return buildDemoSession(actor, new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString());
}
// END HANDOVER: DEMO_MODE
