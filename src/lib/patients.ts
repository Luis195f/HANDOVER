import { ApiClientError, apiPost } from '@/src/lib/api';

export type CreatePatientPayload = {
  firstName: string;
  lastName: string;
  nhc: string;
  unit: string;
  service: string;
  room: string;
};

export class CreatePatientError extends Error {
  status: number;
  details: string;

  constructor(status: number, details: string) {
    super(`Create patient failed (${status})`);
    this.status = status;
    this.details = details;
  }
}

export async function createPatient(payload: CreatePatientPayload) {
  try {
    return await apiPost('/api/patients', {
      body: JSON.stringify({
        first_name: payload.firstName,
        last_name: payload.lastName,
        identifier: payload.nhc,
        unit: payload.unit,
        service: payload.service,
        room: payload.room,
      }),
    });
  } catch (error) {
    if (error instanceof ApiClientError) {
      throw new CreatePatientError(error.status, error.details || error.message);
    }

    throw new CreatePatientError(0, 'Unknown error');
  }
}
