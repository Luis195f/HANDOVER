import { beforeEach, describe, expect, it, vi } from "vitest";

const printMock = vi.hoisted(() => ({
  printToFileAsync: vi.fn(),
}));

const fsMock = vi.hoisted(() => ({
  moveAsync: vi.fn(),
}));

const platformMock = vi.hoisted(() => ({ OS: "ios" }));

vi.mock("expo-print", () => ({
  printToFileAsync: printMock.printToFileAsync,
}));

vi.mock("expo-file-system", () => ({
  documentDirectory: "file://documents/",
  moveAsync: fsMock.moveAsync,
}));

vi.mock("react-native", () => ({
  Platform: platformMock,
}));

import { generateHandoverPdf } from "../export/export-pdf";

describe("generateHandoverPdf", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    platformMock.OS = "ios";
    printMock.printToFileAsync.mockResolvedValue({ uri: "file://tmp/generated.pdf" });
    fsMock.moveAsync.mockResolvedValue(undefined);
  });

  it("falla en web porque Expo Print no devuelve archivo", async () => {
    platformMock.OS = "web";

    await expect(
      generateHandoverPdf(
        { patientId: "patient-1" } as any,
        { userId: "user-1", roles: [], units: [] } as any,
      ),
    ).rejects.toThrow("PDF_EXPORT_UNSUPPORTED_ON_WEB");
  });

  it("falla si printToFileAsync no retorna uri", async () => {
    printMock.printToFileAsync.mockResolvedValue({ uri: "" });

    await expect(
      generateHandoverPdf(
        { patientId: "patient-1" } as any,
        { userId: "user-1", roles: [], units: [] } as any,
      ),
    ).rejects.toThrow("PDF_EXPORT_FILE_URI_MISSING");
  });
});
