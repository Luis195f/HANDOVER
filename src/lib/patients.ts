import { API_BASE_URL } from '@/src/config/env';
import { getToken } from '@/src/security/tokenSupplier';

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
  const token = await getToken('api');
  const headers = new Headers({
    'Content-Type': 'application/json',
  });

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}/api/patients`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      first_name: payload.firstName,
      last_name: payload.lastName,
      identifier: payload.nhc,
      unit: payload.unit,
      service: payload.service,
      room: payload.room,
    }),
  });

  let parsedBody: unknown = null;
  if (typeof (response as Response & { text?: () => Promise<string> }).text === 'function') {
    const responseText = await response.text();
    try {
      parsedBody = responseText ? JSON.parse(responseText) : null;
    } catch {
      parsedBody = responseText;
    }
  } else if (typeof (response as Response & { json?: () => Promise<unknown> }).json === 'function') {
    parsedBody = await response.json();
  }

  if (!response.ok) {
    const details = typeof parsedBody === 'string' ? parsedBody : JSON.stringify(parsedBody);
    throw new CreatePatientError(response.status, details || response.statusText);
  }

  return parsedBody;
}
