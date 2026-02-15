import { maybeUseDemoResponse } from "@/src/demo/net-interceptor";
import { API_BASE_URL } from "@/src/config/env";
import { getToken } from "@/src/security/tokenSupplier";

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
    if (!demoResponse.ok) throw new Error(`${demoResponse.status} ${demoResponse.statusText}`);
    return demoResponse.json();
  }

  const res = await fetch(url, { ...init, headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
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
