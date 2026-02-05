import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GeneratedPdf } from "../export/export-pdf";
import type { HandoverSession } from "../../security/auth-types";
import { signPdf } from "../eidas-signature";

const fileSystemMock = vi.hoisted(() => ({
  readAsStringAsync: vi.fn(),
  writeAsStringAsync: vi.fn(),
  copyAsync: vi.fn(),
}));

vi.mock("expo-file-system", () => ({
  __esModule: true,
  documentDirectory: "file://documents/",
  EncodingType: { Base64: "base64" },
  readAsStringAsync: fileSystemMock.readAsStringAsync,
  writeAsStringAsync: fileSystemMock.writeAsStringAsync,
  copyAsync: fileSystemMock.copyAsync,
}));

describe("eidas-signature", () => {
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
    fileSystemMock.writeAsStringAsync.mockResolvedValue(undefined);
    fileSystemMock.copyAsync.mockResolvedValue(undefined);
    process.env.EXPO_PUBLIC_EIDAS_API_URL = "https://eidas.test";
  });

  it("firma un PDF y persiste el resultado", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        signedPdfBase64: "c2lnbmVk",
        signature: "sig-base64",
        certificateInfo: {
          issuer: "EIDAS-CA",
          subject: "Dr. Demo",
          validTo: "2026-01-01T00:00:00Z",
        },
        signedAt: "2024-01-02T10:00:00Z",
      }),
    })) as any;
    globalThis.fetch = fetchMock;

    const signed = await signPdf(pdf, session);

    expect(signed.signature).toBe("sig-base64");
    expect(signed.uri).toContain("_signed.pdf");
    expect(fileSystemMock.writeAsStringAsync).toHaveBeenCalled();
  });

  it("lanza un error si el proveedor eIDAS responde con fallo", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
    })) as any;
    globalThis.fetch = fetchMock;

    await expect(signPdf(pdf, session)).rejects.toThrow("EIDAS_SIGN_FAILED_403");
  });
});
