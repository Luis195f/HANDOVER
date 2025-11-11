import { fetchWithRetry } from "./net-experimental";
export async function postBundle(baseUrl: string, bundle: any) {
  return fetchWithRetry(`${baseUrl}/Bundle`, {
    method: "POST",
    headers: { "Content-Type": "application/fhir+json" },
    body: JSON.stringify(bundle),
  }, { retries: 2, timeoutMs: 15000 });
}
