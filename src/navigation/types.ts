import type { AdministrativeData } from "@/src/types/administrative";
import type { PrefillOutput } from "@/src/lib/prefill";
import type { PatientSummary } from "@/src/lib/fhir-client";

/**
 * Nota de compatibilidad:
 * - Mantiene los params legacy (patientId/unitId) por compatibilidad histórica.
 * - Mantiene HandoverMain y HandoverForm apuntando a los mismos params.
 */

export type LegacyHandoverParams = {
  patientId?: string;
  unitId?: string;
};

export type PrefillMeta = {
  server?: string;
  unit?: string;
  bed?: string;
  visitId?: string;
};

export type AudioNotePayload = {
  uri: string;
  transcription?: string;
  uploadToFhir?: boolean;
};

export type HandoverFormParams = {
  patientIdParam?: string;
  unitIdParam?: string;
  specialtyId?: string;
  administrativeData?: AdministrativeData;
  prefilledValues?: PrefillOutput | null;
  patientSummary?: PatientSummary | null;
  prefillMeta?: PrefillMeta;
  audioNote?: AudioNotePayload;
} & LegacyHandoverParams;

type HandoverRouteName = "HandoverForm" | "HandoverMain";
type MainReturnRoute = HandoverRouteName | "PatientList";

export type ShiftDetailsParams = {
  /**
   * Ampliado de forma retrocompatible:
   * antes: "HandoverForm" | "PatientList"
   * ahora: incluye también "HandoverMain" (si tu flujo navega hacia esa ruta)
   */
  returnTo?: MainReturnRoute;
  administrativeData?: AdministrativeData;
};

export type QRScanParams = {
  /**
   * Ampliado de forma retrocompatible para incluir "HandoverMain".
   * No rompe a nadie: solo permite un valor adicional.
   */
  returnTo?: MainReturnRoute | "AudioNote";
  unitIdParam?: string;
  specialtyId?: string;
  patientIdParam?: string;
  prefillMeta?: PrefillMeta;
};

export type RootStackParamList = {
  PatientList: undefined;

  AudioNote: { onDoneRoute?: MainReturnRoute } | undefined;

  // Mantener ambas rutas (HandoverMain y HandoverForm) es válido y tipado.
  HandoverMain: HandoverFormParams;
  HandoverForm: HandoverFormParams;

  ShiftDetails: ShiftDetailsParams | undefined;
  QRScan: QRScanParams | undefined;

  SyncCenter: undefined;
  AuditLog: undefined;

  SupervisorDashboard: undefined;
  AdminDashboard: undefined;

  PatientDashboard: { patientId: string };

  Login: undefined;
  Unauthorized: undefined;

  Onboarding: undefined;

  // ✅ Nuevo: pantalla específica para el consentimiento (coherente con RootNavigator)
  PrivacyConsent: undefined;

  PrivacyPolicy: undefined;
};
