import { maybeUseDemoResponse } from "@/src/demo/net-interceptor";
import { API_BASE_URL } from "@/src/config/env";
import { getToken } from "@/src/security/tokenSupplier";

const ERROR_SNIPPET_MAX_LENGTH = 200;

export class ApiClientError extends Error {
  status: number;
  details: string;

  constructor(status: number, details?: string) {
    const safeDetails = details?.trim();
    const isDev = typeof __DEV__ !== "undefined" ? __DEV__ : process.env.NODE_ENV !== "production";
    super(isDev && safeDetails ? `API request failed (${status}): ${safeDetails}` : `API request failed (${status})`);
    this.status = status;
    this.details = safeDetails ?? "";
  }
}

async function parseErrorDetails(response: Response) {
  const responseText = await response.text();
  if (!responseText) {
    return response.statusText;
  }

  let parsed: unknown = responseText;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    // keep plain text response when it's not JSON
  }

  const normalized = typeof parsed === "string" ? parsed : JSON.stringify(parsed);
  return normalized.slice(0, ERROR_SNIPPET_MAX_LENGTH);
}

async function throwApiError(response: Response) {
  const details = await parseErrorDetails(response);
  throw new ApiClientError(response.status, details || response.statusText);
}

async function apiFetch(path: string, init?: RequestInit & { method?: string }) {
  const url = `${API_BASE_URL}${path}`;

  // Service name solo para trazabilidad/compat (no rompe nada si se ignora)
  const freshToken = await getToken("api");

  const headers = new Headers(init?.headers ?? {});
  if (freshToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${freshToken}`);
  }

  const demoResponse = await maybeUseDemoResponse(url, { ...init, headers });
  if (demoResponse) {
    if (!demoResponse.ok) await throwApiError(demoResponse);
    return demoResponse.json();
  }

  const res = await fetch(url, { ...init, headers });
  if (!res.ok) await throwApiError(res);
  return res.json();
}

export async function apiGet(path: string, init?: RequestInit) {
  return apiFetch(path, init);
}

export async function apiPost(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return apiFetch(path, { ...init, method: "POST", headers });
}
