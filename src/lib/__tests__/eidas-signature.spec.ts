import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GeneratedPdf } from "../export/export-pdf";
import type { HandoverSession } from "../../security/auth-types";
import { EIDAS_CLIENT_FLOW_DISABLED_ERROR, signPdf } from "../eidas-signature";

const fileSystemMock = vi.hoisted(() => ({
  copyAsync: vi.fn(),
}));

vi.mock("expo-file-system", () => ({
  __esModule: true,
  documentDirectory: "file://documents/",
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
    fileSystemMock.copyAsync.mockResolvedValue(undefined);
  });

  it("desactiva el flujo eIDAS consumido por cliente", async () => {
    await expect(signPdf(pdf, session)).rejects.toThrow(EIDAS_CLIENT_FLOW_DISABLED_ERROR);
  });
});
