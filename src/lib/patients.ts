import { apiPost } from '@/src/lib/api';

export type CreatePatientPayload = {
  firstName: string;
  lastName: string;
  nhc: string;
  unit: string;
  service: string;
  room: string;
};

export async function createPatient(payload: CreatePatientPayload) {
  return apiPost('/api/patients', {
    body: JSON.stringify(payload),
  });
}

