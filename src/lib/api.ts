import { maybeUseDemoResponse } from "@/src/demo/net-interceptor";
import { API_BASE_URL } from "@/src/config/env";
import { ensureFreshAccessToken } from "@/src/security/auth";

export async function apiGet(path: string, init?: RequestInit) {
  const url = `${API_BASE_URL}${path}`;
  const freshToken = await ensureFreshAccessToken();
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
