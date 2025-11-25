import { maybeUseDemoResponse } from "@/src/demo/net-interceptor";
import { API_BASE_URL } from "@/src/config/env";
export async function apiGet(path: string, init?: RequestInit) {
  const url = `${API_BASE_URL}${path}`;
  const demoResponse = await maybeUseDemoResponse(url, init);
  if (demoResponse) {
    if (!demoResponse.ok) throw new Error(`${demoResponse.status} ${demoResponse.statusText}`);
    return demoResponse.json();
  }

  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
