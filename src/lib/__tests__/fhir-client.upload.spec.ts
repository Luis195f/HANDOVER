import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GeneratedPdf } from "../export/export-pdf";
import type { HandoverSession } from "../../security/auth-types";
import { setAuthHooks, uploadSignedHandoverPdf } from "../fhir-client";
import { signPdf } from "../eidas-signature";

const fileSystemMock = vi.hoisted(() => ({
  readAsStringAsync: vi.fn(),
}));

vi.mock("expo-file-system", () => ({
  __esModule: true,
  EncodingType: { Base64: "base64" },
  readAsStringAsync: fileSystemMock.readAsStringAsync,
}));

vi.mock("../eidas-signature", () => ({
  signPdf: vi.fn(),
}));

describe("uploadSignedHandoverPdf", () => {
  const pdf: GeneratedPdf = {
    uri: "file://documents/handover.pdf",
    name: "handover.pdf",
    mimeType: "application/pdf",
    createdAt: "2024-01-01T00:00:00Z",
    author: "Nurse A",
  };

  const session: HandoverSession = {
    userId: "user-1",
    displayName: "Dr. Demo",
    roles: ["nurse"],
    units: ["icu"],
    accessToken: "token",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    fileSystemMock.readAsStringAsync.mockResolvedValue("cGRm");
    setAuthHooks({
      baseUrl: "http://fhir.test",
      getSession: async () => session,
      getToken: async () => "token",
    });
  });

  it("sube el DocumentReference con metadatos de firma", async () => {
    (signPdf as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      uri: "file://documents/handover_signed.pdf",
      signature: "sig-base64",
      certificateInfo: { issuer: "EIDAS-CA", subject: "Dr. Demo", validTo: "2026-01-01T00:00:00Z" },
      signedAt: "2024-01-02T10:00:00Z",
    });

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: 201,
      headers: new Headers({ "content-type": "application/fhir+json" }),
      json: async () => ({}),
    })) as any;
    globalThis.fetch = fetchMock;

    await uploadSignedHandoverPdf(pdf, { patientId: "patient-1", handoverId: "handover-1" });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body ?? "{}"));
    expect(body.resourceType).toBe("DocumentReference");
    expect(body.extension?.[0]?.extension?.[1]?.valueString).toBe("sig-base64");
  });

  it("lanza error si el upload falla", async () => {
    (signPdf as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      uri: "file://documents/handover_signed.pdf",
      signature: "sig-base64",
      certificateInfo: { issuer: "EIDAS-CA", subject: "Dr. Demo", validTo: "2026-01-01T00:00:00Z" },
      signedAt: "2024-01-02T10:00:00Z",
    });

    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      headers: new Headers({ "content-type": "application/fhir+json" }),
      json: async () => ({ issue: [{ severity: "error", diagnostics: "fail" }] }),
    })) as any;
    globalThis.fetch = fetchMock;

    await expect(
      uploadSignedHandoverPdf(pdf, { patientId: "patient-1", handoverId: "handover-1" }),
    ).rejects.toThrow("HTTP 500");
  });

  it("sube PDF sin firma cuando no hay configuración eIDAS", async () => {
    (signPdf as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("EIDAS_API_URL_MISSING"));

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: 201,
      headers: new Headers({ "content-type": "application/fhir+json" }),
      json: async () => ({}),
    })) as any;
    globalThis.fetch = fetchMock;

    await uploadSignedHandoverPdf(pdf, { patientId: "patient-1", handoverId: "handover-1" });

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body ?? "{}"));
    expect(body.type?.text).toBe("Handover PDF");
    expect(body.extension).toEqual([]);
  });
});
