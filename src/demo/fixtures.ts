import { PATIENTS_MOCK } from '@/src/data/mockPatients';
import { UNITS } from '@/src/config/units';
import { mockAlertSummaries, mockStaffActivity, mockUnitSummaries } from '@/src/mock/admin/dashboard-fixture';
import type { PatientSummary } from '@/src/lib/fhir-client';
import type { HandoverSession } from '@/src/security/auth-types';

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

export const DEMO_PATIENT_SUMMARY: PatientSummary = {
  id: PATIENTS_MOCK[0]?.id ?? 'pat-demo',
  name: PATIENTS_MOCK[0]?.name ?? 'Paciente Demo',
  gender: 'female',
  age: 68,
  bed: 'ICU-A1',
  mrn: 'MRN-DEMO-001',
  allergies: ['Penicilina'],
};

export const DEMO_FHIR_PATIENT = {
  resourceType: 'Patient',
  id: PATIENTS_MOCK[0]?.id ?? 'pat-demo',
  birthDate: '1956-04-11',
  name: [
    {
      given: ['Paciente'],
      family: 'Demo',
      text: 'Paciente Demo',
    },
  ],
  identifier: [
    { system: 'https://demo.hospital/bed', type: { text: 'Cama' }, value: 'A1' },
    { system: 'https://demo.hospital/mrn', type: { text: 'MRN' }, value: 'MRN-DEMO-001' },
  ],
};

export const DEMO_FHIR_ENCOUNTER_BUNDLE = {
  resourceType: 'Bundle',
  type: 'searchset',
  entry: [
    {
      resource: {
        resourceType: 'Encounter',
        id: 'encounter-demo',
        location: [
          {
            location: {
              reference: 'Location/location-demo',
              display: 'Cama A1',
            },
          },
        ],
      },
    },
    {
      resource: {
        resourceType: 'Location',
        id: 'location-demo',
        identifier: [{ system: 'https://demo.hospital/bed', type: { text: 'Cama' }, value: 'A1' }],
      },
    },
  ],
};

export const DEMO_FHIR_ALLERGY_BUNDLE = {
  resourceType: 'Bundle',
  type: 'searchset',
  entry: [
    {
      resource: {
        resourceType: 'AllergyIntolerance',
        id: 'allergy-demo',
        code: {
          text: 'Penicilina',
          coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', display: 'Penicilina' }],
        },
      },
    },
  ],
};

export const DEMO_ADMIN_DASHBOARD = {
  units: mockUnitSummaries,
  staff: mockStaffActivity,
  alerts: mockAlertSummaries,
};

export const DEMO_PATIENTS = PATIENTS_MOCK;

export function ensureDemoSessionTemplate(): HandoverSession {
  return {
    ...DEMO_SESSION_TEMPLATE,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  };
}
// END HANDOVER: DEMO_MODE
