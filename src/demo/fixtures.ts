import { UNITS } from '@/src/config/units';
import { buildDemoAdminDashboardSummary } from '@/src/mock/admin/dashboard-fixture';
import type { PatientSummary } from '@/src/lib/fhir-client';
import type { HandoverSession } from '@/src/security/auth-types';
import type { PatientListItem } from '@/src/types/patientList';

// BEGIN HANDOVER: DEMO_MODE
export const DEMO_USER_ID = 'demo@nurseos.app';

export const DEMO_SESSION_TEMPLATE: HandoverSession = {
  userId: DEMO_USER_ID,
  displayName: 'Enfermera Demo',
  roles: ['nurse'],
  units: UNITS.map((unit) => unit.id),
  accessToken: 'demo-token',
  refreshToken: undefined,
  expiresAt: undefined,
  mode: 'demo',
};

type DemoPatientFixture = {
  patient: PatientListItem;
  summary: PatientSummary;
  birthDate: string;
  gender: 'female' | 'male';
  encounterId: string;
  locationId: string;
};

const DEMO_PATIENT_FIXTURES: readonly DemoPatientFixture[] = [
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
        },
        {
          id: 'task-demo-psych-adult-med',
          title: 'Cerrar adherencia terapeutica y medicacion no omitible del siguiente turno',
          urgent: true,
          priority: 'urgent',
          category: 'critical-task',
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
        },
        {
          id: 'task-demo-psych-child-followup',
          title: 'Cerrar rechazo terapeutico parcial, retorno seguro y coordinacion con tutor del siguiente turno',
          critical: true,
          priority: 'critical',
          category: 'critical-task',
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
  },
  {
    patient: {
      id: 'demo-psych-udcc-001',
      name: 'Caso sintetico psicogeriatria',
      unitId: 'udcc-psychogeriatrics',
      bedLabel: 'PG-03',
      vitals: { rr: 17, spo2: 96, tempC: 36.5, sbp: 124, hr: 79, o2: false, avpu: 'A' },
      devices: [{ id: 'dev-demo-udcc-walker', label: 'Andador supervisado', category: 'support' }],
      risks: { fall: true },
      pendingTasks: [
        {
          id: 'task-demo-psych-udcc-gait',
          title: 'Reevaluar deambulacion supervisada, riesgo de caidas y continuidad del turno siguiente',
          critical: true,
          priority: 'critical',
          category: 'reevaluation',
        },
        {
          id: 'task-demo-psych-udcc-hydration',
          title: 'Cerrar hidratacion, adherencia terapeutica y resguardo de audifono removible',
          urgent: true,
          priority: 'urgent',
          category: 'critical-task',
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
  },
] as const;

const DEMO_PATIENT_FIXTURES_BY_ID = Object.fromEntries(
  DEMO_PATIENT_FIXTURES.map((fixture) => [fixture.patient.id, fixture]),
) as Record<string, DemoPatientFixture>;

const getDefaultDemoPatientFixture = (): DemoPatientFixture => DEMO_PATIENT_FIXTURES[0];

export const DEMO_PATIENT_SUMMARY: PatientSummary = getDefaultDemoPatientFixture().summary;

export const DEMO_PATIENTS: PatientListItem[] = DEMO_PATIENT_FIXTURES.map((fixture) => fixture.patient);

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

export function ensureDemoSessionTemplate(): HandoverSession {
  return {
    ...DEMO_SESSION_TEMPLATE,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  };
}
// END HANDOVER: DEMO_MODE
