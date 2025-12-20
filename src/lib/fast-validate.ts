import Constants from 'expo-constants';
import { ENV, FHIR_BASE_URL } from '@/src/config/env';
import { createFHIRClient } from './fhir-client';
import { formatIssuesForUser, hasFatalOutcome, isOperationOutcome, type OperationIssue } from './fhir-outcome';
import type { NetInfoState } from './netinfo';

type FastValidateResult = { ok: true } | { ok: false; message: string; issues?: OperationIssue[] };

const truthy = (value: unknown): boolean => {
  if (value === true) return true;
  const normalized = String(value ?? '').toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
};

export function isFastValidateEnabled(): boolean {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const raw =
    extra.EXPO_PUBLIC_FAST_VALIDATE_BEFORE_QUEUE ??
    extra.FAST_VALIDATE_BEFORE_QUEUE ??
    process.env.EXPO_PUBLIC_FAST_VALIDATE_BEFORE_QUEUE;
  return truthy(raw);
}

export function hasNetwork(state: NetInfoState): boolean {
  return !!(state.isConnected && (state.isInternetReachable ?? true));
}

export async function fastValidateBundleRemotely(
  bundle: unknown,
  opts: { token?: string | null; fhirBaseUrl?: string } = {},
): Promise<FastValidateResult> {
  const fhirBaseUrl = opts.fhirBaseUrl ?? ENV.FHIR_BASE_URL ?? FHIR_BASE_URL;
  const scopedClient = createFHIRClient({
    baseUrl: () => fhirBaseUrl,
    getToken: async () => opts.token ?? null,
  });

  try {
    const result = await scopedClient.fetchFHIR<OperationIssue[]>({
      path: '/Bundle/$validate',
      method: 'POST',
      body: bundle,
      token: opts.token ?? undefined,
    });

    const issues = result.outcome ?? (isOperationOutcome(result.data) ? result.data.issue : undefined);
    const fatal = hasFatalOutcome(issues);
    if (fatal) {
      const formatted = formatIssuesForUser(issues);
      return { ok: false, message: formatted.message, issues };
    }
  } catch {
    // No bloqueamos la cola si la validación rápida falla por razones ajenas al payload.
  }
  return { ok: true };
}
