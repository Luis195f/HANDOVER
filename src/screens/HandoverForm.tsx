import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  type TextStyle,
  NativeScrollEvent,
  NativeSyntheticEvent,
  useWindowDimensions,
  View,
  type AlertButton,
  type LayoutChangeEvent,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Controller, FormProvider, type Path } from 'react-hook-form';
import type { FieldErrors } from 'react-hook-form';
import * as Speech from 'expo-speech';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';

import { isOn } from '@/src/config/flags';
import { UNITS_BY_ID } from '@/src/config/units';
import { getPatientIdentificationHint, isQrPatientScanEnabled } from '@/src/config/patientIdentification';
import { isPilotFeatureEnabled, usePilotControlContext } from '@/src/config/pilotControl';
import { getHandoverVisibleSections } from '@/src/screens/handover/visibility';
import { HANDOVER_SECTIONS_INFO, resolveHandoverProfileRuntime } from '@/src/lib/profile-runtime';
import AudioAttach from '@/src/components/AudioAttach';
import FileAttach from '@/src/components/FileAttach';
import { hashHex } from '@/src/lib/crypto';
import { confirmAction } from '@/src/lib/platform-confirm';
import { buildHandoverBundleAsync, type HandoverInput as FhirHandoverInput, type HandoverValues as FhirHandoverValues } from '@/src/lib/fhir-map';
import { computeAlerts } from '@/src/lib/alerts';
import { computeNEWS2 } from '@/src/lib/news2';
import {
  generateSbarViaBackendResult,
  refineSBARWithAIResult,
  type AISbarErrorCode,
} from '@/src/lib/ai-sbar';
import { getBestAvailableSummary } from '@/src/lib/ai-degrade';
import { fetchInterventionsSuggestions, type ClinicalContext, type SuggestionsResult } from '@/src/lib/ai-suggestions';
import { logClinicalDecision } from '@/src/lib/clinical-decision-log';
import { confirmHighRiskSubmission, deriveRiskEvaluationFromValues } from '@/src/lib/scores/handoverRisk';
import useDraftAutosave from '@/src/lib/useDraftAutosave';
import {
  createSttService,
  type SttConfig,
  type SttErrorCode,
  type SttService,
  type SttStatus,
} from '@/src/lib/stt';
import {
  createAsyncStorageAuditStorage,
  makeAuditEvent,
  queueAndFlushAuditEvent,
  type AuditStorage,
} from '@/src/lib/audit';
import { formatSbar, generateSBARSummary } from '@/src/lib/summary';
import { enqueueBundle } from '@/src/lib/queue';
import NetInfo from '@/src/lib/netinfo';
import { fastValidateBundleRemotely, hasNetwork, isFastValidateEnabled } from '@/src/lib/fast-validate';
import { validateBundle } from '@/src/lib/fhir-validation';
import { getUserFacingNetworkMessage, normalizeNetError } from '@/src/lib/net-errors';
import { getValidationErrorDetails } from '@/src/lib/sync-errors';
import { AI_BACKEND_ENABLED, AI_SBAR_ENABLED } from '@/src/config/env';
import type { RootStackParamList } from '@/src/navigation/types';
import { ensureUnitAccess } from '@/src/security/acl';
import { ensureFreshAccessToken, getSession, useAuth, type Session } from '@/src/security/auth';
import { ALL_UNITS_OPTION, useSelectedUnitId } from '@/src/state/filterStore';
import type { AdministrativeData } from '@/src/types/administrative';
import type { HandoverSignature, HandoverStructuredDiagnosis } from '@/src/types/handover';
import type { SBARSummary } from '@/src/types/sbar';
import {
  normalizeLegacySnomedCoding,
  resolveSnomedCoding,
  SNOMED_SYSTEM,
  type SnomedCoding,
} from '@/src/data/snomed-dict';
import { usePatientSummary } from '@/src/hooks/usePatientSummary';
import type { PatientSummary } from '@/src/lib/fhir-client';
import { useZodForm } from '@/src/validation/form-hooks';
import { zHandover, type HandoverValues } from '@/src/validation/schemas';
import { normalizeLegacyHandoverPayload } from '@/src/validation/normalization';
import { DEFAULT_BEDSIDE_CHECKLIST_ITEMS } from '@/src/config/bedsideChecklist';
import type { SignaturePadValue } from '@/src/components/SignaturePad';
import BotonPrimario from '../components/BotonPrimario';
import { useThemeTokens } from '../theme';
import { t } from '@/src/i18n';

type HandoverFormValues = HandoverValues;

// BEGIN HANDOVER D4 – Form imports
import { flushHandoverTimingBestEffort } from '@/src/lib/handover-timing-submit';
// END HANDOVER D4 – Form imports
import DiagnosisAutocomplete from './components/DiagnosisAutocomplete';
// BEGIN HANDOVER D2 – VitalTrends imports
import { useVitalTrends } from '@/src/lib/hooks/useVitalTrends';
import { BedsideChecklistModal } from './components/BedsideChecklistModal';
import { ContingencyPlanSection } from './components/BedsideChecklistSection';
import PendingTasksSection from './components/PendingTasksSection';
import EliminationSection from './components/EliminationSection';
import FluidBalanceSection from './components/FluidBalanceSection';
import MobilitySkinSection from './components/MobilitySkinSection';
import NutritionSection from './components/NutritionSection';
import PsychosocialSection from './components/PsychosocialSection';
import ClinicalScalesSection from './components/ClinicalScalesSection';
import MedicationSection from './components/MedicationSection';
import ExamsProceduresSection from './components/ExamsProceduresSection';
import TreatmentsSection from './components/TreatmentsSection';
import OutcomesSection from './components/OutcomesSection';
import SafetySection from './components/SafetySection';
// END HANDOVER D2 – VitalTrends imports
import { CollapsibleSection } from './components/CollapsibleSection';
import { SidebarIndex } from './components/SidebarIndex';
import ClinicalSuggestions from '@/src/components/ClinicalSuggestions';
import { VitalsSection } from '@/src/components/handover/VitalsSection';
import OxygenGroupSection from './components/OxygenGroupSection';
import DevicesSection from './components/DevicesSection';
import { isBedsideChecklistComplete } from '@/src/lib/bedsideChecklist';
import { SbarSection } from './handover/SbarSection';
import * as SecureStore from 'expo-secure-store';
import { uploadAudioToFhir } from '@/src/lib/audio-upload';
import { useHandoverTiming } from '@/src/hooks/useHandoverTiming';
import { HandoverClosureSections } from './handover/HandoverClosureSections';
import { HandoverContextSections } from './handover/HandoverContextSections';
import {
  baseChecklistDefaults,
  buildChecklistDefaults,
  compactNumberMap,
  compactObject,
  deriveInitialRisksStructured,
  deriveShiftCode,
  deriveShiftType,
  findActiveSection,
  getSessionUser,
  mergeDictationText,
  normalizeChecklistItems,
  normalizeSignatureUser,
  resolveCanonicalPilotContextUnitId,
  resolveEffectiveHandoverUnitId,
  safeJsonParse,
  truncateNote,
} from './handover/formUtils';
import { HandoverOverview, type DemoClinicalSummary } from './handover/HandoverOverview';
import {
  buildHandoverInputPayload,
  buildProfileTraceInput,
  buildSubmissionAdministrativeData,
  buildSubmissionOxygenTherapy,
  normalizeOxygenTherapyInput,
  normalizeUnitSelection,
} from './handover/submission';
import { useHandoverSyncStatus } from './handover/useHandoverSyncStatus';
import { getDemoActorIdentity, getDemoHandoverPrefill, type DemoHandoverPrefill } from '@/src/demo/fixtures';
import {
  createDeterministicSbar,
  createInitialDeterministicSbar,
  getSbarFingerprint,
  hasSbarContent,
  type DeterministicSbar,
} from './handover/deterministicSbar';

const IS_TEST = process.env.NODE_ENV === 'test';
const normalizeLegacyFormSnapshot = <T extends object>(value: T): T =>
  normalizeLegacyHandoverPayload(value) as T;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  container: { flexGrow: 1, padding: 16 },
  containerWithSidebar: { paddingRight: 140 },
  section: { marginBottom: 32 },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12 },
  field: { marginBottom: 16 },
  label: { fontSize: 16, fontWeight: '500', marginBottom: 4 },
  input: {
    borderColor: '#CBD5F5',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  textArea: { height: 120, textAlignVertical: 'top' },
  error: { color: '#DC2626', marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  spacer: { width: 12 },
  buttonRow: { marginTop: 16 },
  inlineActions: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  secondaryButton: { marginLeft: 12 },
  ttsButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#E0F2FE',
  },
  ttsButtonText: { fontWeight: '600', color: '#0C4A6E' },
  vitalsGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  vitalsCell: { width: '50%', paddingHorizontal: 6, marginBottom: 12 },
  // BEGIN HANDOVER D2 – VitalTrends styles
  vitalTrendsBlock: { marginTop: 8, gap: 6 },
  vitalTrendsError: { color: '#6B7280', fontSize: 13 },
  // END HANDOVER D2 – VitalTrends styles
  dictationRow: { flexDirection: 'row', alignItems: 'flex-start' },
  micButton: {
    marginLeft: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#E0E7FF',
  },
  micButtonActive: { backgroundColor: '#2563EB' },
  micButtonDisabled: { opacity: 0.5 },
  micButtonText: { fontWeight: '600', color: '#1E1B4B' },
  micButtonTextActive: { color: '#fff' },
  dictationStatus: { marginTop: 6, color: '#4338CA', fontSize: 14 },
  dictationError: { marginTop: 6, color: '#B45309', fontSize: 14 },
  sbarPreview: {
    borderColor: '#CBD5F5',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginTop: 12,
    backgroundColor: '#F8FAFF',
  },
  sbarTitle: { fontWeight: '700', marginBottom: 8, fontSize: 16 },
  sbarText: { fontFamily: 'monospace' },
  helperText: { marginTop: 6, color: '#4B5563' },
  syncNotice: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  syncNoticeTitle: { fontWeight: '700', marginBottom: 4 },
  syncNoticeMessage: { fontSize: 13 },
  syncNoticeActions: { flexDirection: 'row', gap: 12, marginTop: 8 },
  syncNoticeCta: { fontWeight: '600' },
  e2eControls: {
    marginBottom: 16,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5F5',
    backgroundColor: '#F8FAFF',
  },
  e2eTitle: { fontWeight: '700', marginBottom: 8, color: '#1F2937' },
  e2eActions: { flexDirection: 'row', gap: 12 },
  profileCard: {
    marginBottom: 16,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5F5',
    backgroundColor: '#F8FAFF',
    gap: 6,
  },
  profileCardTitle: { fontWeight: '700', color: '#1F2937' },
  profileCardMeta: { color: '#4B5563', fontSize: 13 },
  signaturePadSection: { marginBottom: 16 },
  signaturePadHint: { marginTop: 6, color: '#4B5563', fontSize: 12 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  optionButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#CBD5F5',
    backgroundColor: '#fff',
  },
  optionButtonSelected: { backgroundColor: '#2563EB', borderColor: '#2563EB' },
  optionText: { color: '#1F2937', fontWeight: '500' },
  optionTextSelected: { color: '#fff', fontWeight: '600' },
  alertList: { gap: 8 },
  alertCard: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  alertTitle: { fontWeight: '700', marginBottom: 4 },
  alertCritical: { backgroundColor: '#ffebee', borderColor: '#fca5a5' },
  alertWarning: { backgroundColor: '#fff8e1', borderColor: '#fcd34d' },
  alertInfo: { backgroundColor: '#e3f2fd', borderColor: '#bfdbfe' },
  riskBanner: { padding: 12, borderRadius: 10, marginTop: 12 },
  riskHigh: { backgroundColor: '#fef2f2', borderColor: '#fca5a5', borderWidth: 1 },
  riskModerate: { backgroundColor: '#fffbeb', borderColor: '#fcd34d', borderWidth: 1 },
  riskLow: { backgroundColor: '#ecfdf3', borderColor: '#a7f3d0', borderWidth: 1 },
  riskTitle: { fontWeight: '700', marginBottom: 4 },
  riskReason: { color: '#374151', marginTop: 2 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  switchLabel: { flex: 1, color: '#1F2937' },
});

type HandoverRouteName = "HandoverForm" | "HandoverMain";
type Props = NativeStackScreenProps<RootStackParamList, HandoverRouteName>;
type HandoverFormErrors = FieldErrors<HandoverFormValues>;

export type DictationField =
  | 'dxMedical'
  | 'dxNursing'
  | 'meds'
  | 'evolution'
  | 'closingSummary'
  | 'incidents';

const ALL_SECTIONS_INFO = HANDOVER_SECTIONS_INFO;

type SectionKey = (typeof HANDOVER_SECTIONS_INFO)[number]['key'];
const DEMO_OPEN_SECTION_KEYS = new Set<SectionKey>(['sbar', 'examenes', 'evolucion', 'resumen', 'bedsideChecklist', 'firmas']);
type PendingSbarSuggestion = {
  patientId: string;
  unitId: string;
  source: 'ai_generate_sbar' | 'ai_refine_sbar';
  mode: 'ai' | 'local_fallback';
  summary: SBARSummary;
  fullText: string;
  hash: string;
  replaceExisting: boolean;
};

const TIMED_SECTIONS_BY_KEY: Partial<Record<SectionKey, 'sbar' | 'vitals' | 'diagnostics' | 'treatments'>> = {
  sbar: 'sbar',
  signos: 'vitals',
  diagnosticos: 'diagnostics',
  medicacion: 'treatments',
};


function DictationMicButton({
  active,
  disabled,
  label,
  onPress,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy: active }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.micButton,
        active && styles.micButtonActive,
        disabled && styles.micButtonDisabled,
        pressed && !disabled ? { opacity: 0.85 } : null,
      ]}
    >
      <Text style={[styles.micButtonText, active && styles.micButtonTextActive]}>
        {active ? 'Detener' : label}
      </Text>
    </Pressable>
  );
}

async function buildAudioAttachment(uri: string | undefined) {
  if (!uri) return undefined;
  if (/^https?:\/\//i.test(uri)) {
    return { url: uri, contentType: 'audio/m4a', title: 'Audio de entrega' };
  }
  try {
    const FileSystem = await import('expo-file-system');
    const dataBase64 = await FileSystem.readAsStringAsync(uri, {
      encoding: 'base64',
    });
    const info = await FileSystem.getInfoAsync(uri);
    const reportedSize =
      info.exists && !info.isDirectory && typeof info.size === 'number' ? info.size : undefined;
    const size = reportedSize ?? Math.floor((dataBase64.length * 3) / 4);
    return {
      dataBase64,
      size,
      hash: hashHex(dataBase64),
      contentType: 'audio/m4a',
      title: 'Audio de entrega',
    } as const;
  } catch {
    return undefined;
  }
}    

export default function HandoverForm({ navigation, route }: Props) {
  const {
    patientId: legacyPatientIdParam,
    patientIdParam: canonicalPatientIdParam,
    unitId: legacyUnitIdParam,
    unitIdParam: canonicalUnitIdParam,
    specialtyId,
    administrativeData: administrativeDataParam,
    prefilledValues: prefilledValuesParam,
    patientSummary: patientSummaryParam,
    prefillMeta,
    demoPrefill: demoPrefillParam,
    audioNote: audioNoteParam,
  } = route.params ?? {};
  const patientIdParam = canonicalPatientIdParam ?? legacyPatientIdParam;
  const unitIdParam = canonicalUnitIdParam ?? legacyUnitIdParam;
  const [session, setSession] = useState<Session | null>(null);
  const { session: authSession, capabilities, logout } = useAuth();
  const isDemoSession = authSession?.mode === 'demo' || session?.mode === 'demo';
  const demoPrefill = useMemo<DemoHandoverPrefill | undefined>(
    () => (isDemoSession ? demoPrefillParam ?? getDemoHandoverPrefill(patientIdParam ?? patientSummaryParam?.id) : undefined),
    [demoPrefillParam, isDemoSession, patientIdParam, patientSummaryParam?.id],
  );
  const pilotRoles = authSession?.roles ?? session?.roles ?? [];
  const selectedUnitId = useSelectedUnitId();
  const auditStorageRef = useRef<AuditStorage>(createAsyncStorageAuditStorage());
  const auditedPatientsRef = useRef<Set<string>>(new Set());
  const auditedAttestationsRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<ScrollView>(null);
  const { colors, fontSizes, spacing, radius } = useThemeTokens();
  const { width } = useWindowDimensions();
  const isTablet = width >= 900;
  const sectionRefs = useMemo(
  () =>
    ALL_SECTIONS_INFO.reduce(
      (acc, { key }) => {
        acc[key] = React.createRef<View>();
        return acc;
      },
      {} as Record<SectionKey, React.RefObject<View | null>>
    ),
  [],
);
  const [sectionPositions, setSectionPositions] = useState<Partial<Record<SectionKey, number>>>({});
  const [collapsedSections, setCollapsedSections] = useState<Record<SectionKey, boolean>>(() =>
    ALL_SECTIONS_INFO.reduce(
      (acc, { key }) => ({ ...acc, [key]: isDemoSession ? !DEMO_OPEN_SECTION_KEYS.has(key) : false }),
      {} as Record<SectionKey, boolean>,
    ),
  );
  const [activeSection, setActiveSection] = useState<SectionKey | null>(ALL_SECTIONS_INFO[0]?.key ?? null);
  const [bedsideModalVisible, setBedsideModalVisible] = useState(false);
  const [bedsideChecklistHighlightMissing, setBedsideChecklistHighlightMissing] = useState(false);
  const timingInitializedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const sess = await getSession();
        if (!alive) return;
        setSession(sess);
      } catch {
        if (!alive) return;
        setSession(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const prefilledVitals = useMemo<HandoverFormValues['vitals'] | undefined>(() => {
    const vitals = prefilledValuesParam?.vitals;
    if (!vitals) return undefined;
    const mapped: HandoverFormValues['vitals'] = {};
    if (typeof vitals.rr === 'number') mapped.rr = vitals.rr;
    if (typeof vitals.spo2 === 'number') mapped.spo2 = vitals.spo2;
    if (typeof vitals.temp === 'number') mapped.tempC = vitals.temp;
    if (typeof vitals.sbp === 'number') mapped.sbp = vitals.sbp;
    if (typeof vitals.dbp === 'number') mapped.dbp = vitals.dbp;
    if (typeof vitals.hr === 'number') mapped.hr = vitals.hr;
    if (vitals.acvpu) mapped.avpu = vitals.acvpu;
    return Object.keys(mapped).length ? mapped : undefined;
  }, [prefilledValuesParam?.vitals]);

  const emptySnomedCoding: SnomedCoding = {
  system: SNOMED_SYSTEM,
  code: "",
  display: "",
};

  const defaultValues = useMemo<HandoverFormValues>(() => {
    const initialAdministrativeUnitId = resolveEffectiveHandoverUnitId(
      demoPrefill?.administrativeData.unit,
      administrativeDataParam?.unit,
      unitIdParam,
      selectedUnitId,
      prefillMeta?.unit,
      prefilledValuesParam?.location,
    );
    const initialPilotUnitId = resolveCanonicalPilotContextUnitId(unitIdParam, selectedUnitId);
    const initialProfileRuntime = resolveHandoverProfileRuntime({
      unitId: initialPilotUnitId,
      specialtyId,
      roles: pilotRoles,
    });

  const checklistItems = normalizeChecklistItems(initialProfileRuntime.checklistItems);

  const bedsideChecklistDefaults = buildChecklistDefaults(checklistItems, baseChecklistDefaults)

  const shiftStartDefault = demoPrefill?.administrativeData.shiftStart ?? administrativeDataParam?.shiftStart ?? new Date().toISOString();
  const shiftEndDefault =
    demoPrefill?.administrativeData.shiftEnd ?? administrativeDataParam?.shiftEnd ?? new Date(Date.now() + 4 * 3600 * 1000).toISOString();

    const administrativeDefaults: AdministrativeData = {
      unit:
        initialAdministrativeUnitId ?? '',
      census: demoPrefill?.administrativeData.census ?? administrativeDataParam?.census ?? 0,
      staffIn: demoPrefill?.administrativeData.staffIn ?? administrativeDataParam?.staffIn ?? [],
      staffOut: demoPrefill?.administrativeData.staffOut ?? administrativeDataParam?.staffOut ?? [],
      shiftStart: shiftStartDefault,
      shiftEnd: shiftEndDefault,
      shiftType:
        demoPrefill?.administrativeData.shiftType ?? administrativeDataParam?.shiftType ??
        deriveShiftType(shiftStartDefault),
      generalNotes: demoPrefill?.administrativeData.generalNotes ?? administrativeDataParam?.generalNotes ?? undefined,
      incidents: demoPrefill?.administrativeData.incidents ?? administrativeDataParam?.incidents ?? [],
    };

    const dxMedicalPrefill = prefilledValuesParam?.dxText;
    const dxMedicalValue: SnomedCoding =
      demoPrefill?.dxMedical ?? normalizeLegacySnomedCoding(dxMedicalPrefill) ?? { ...emptySnomedCoding };
    const base: HandoverFormValues = {
      administrativeData: administrativeDefaults,
      patientId: patientIdParam ?? patientSummaryParam?.id ?? '',
      status: 'draft',
      dxMedical: dxMedicalValue,
      dxNursing: '',
      dxMedicalStructured: [],
      dxNursingStructured: [],
      evolution: demoPrefill?.evolution ?? '',
      closingSummary: '',
      meds: '',
      medications: demoPrefill?.medications ?? [],
      treatments: [],
      outcomes: [],
      turnContext: {
        shiftPhase: undefined,
        workload: undefined,
        operationalSummary: '',
        serviceIncidents: [],
      },
      pendingTasks: demoPrefill?.pendingTasks ?? [],
      exams: demoPrefill?.exams ?? [],
      procedures: [],
      contingencyPlan: demoPrefill?.contingencyPlan ?? {
        watchItems: [],
        immediateActions: [],
        escalationCriteria: [],
        escalationContact: '',
        fallbackPlan: '',
      },
      sbarSituation: demoPrefill?.sbarSituation ?? '',
      sbarBackground: demoPrefill?.sbarBackground ?? '',
      sbarAssessment: demoPrefill?.sbarAssessment ?? '',
      sbarRecommendation: demoPrefill?.sbarRecommendation ?? '',
      sbarFullText: '',
      vitals: demoPrefill?.vitals ?? prefilledVitals ?? {},
      oxygenTherapy: {},
      devices: demoPrefill?.devices ?? [],
      nutrition: demoPrefill?.nutrition,
      elimination: demoPrefill?.elimination,
      fluidBalance: undefined,
      painAssessment: {
        hasPain: false,
        evaScore: null,          
        location: undefined,     
        actionsTaken: undefined, 
      },
      // BEGIN HANDOVER D1 – BedsideChecklist
      bedsideChecklist: bedsideChecklistDefaults,
      // END HANDOVER D1 – BedsideChecklist
      risks: demoPrefill?.risks ?? {},
      risksStructured: demoPrefill?.risksStructured ?? [],
      signatures: {
        outgoing: undefined,
        incoming: undefined,
      },
      attachments: [],
      audioTranscription: '',
    };
    return normalizeLegacyFormSnapshot({ ...base, risksStructured: deriveInitialRisksStructured(base) });
}, [
  patientIdParam,
  patientSummaryParam,
  unitIdParam,
  administrativeDataParam,
  selectedUnitId,
  specialtyId,
  prefilledValuesParam,
  prefilledVitals,
  prefillMeta,
  demoPrefill,
  pilotRoles,
]);

  const form = useZodForm(zHandover, defaultValues);
  const { watch, reset, getValues } = form;
  const { control, formState } = form;
  const patientIdValue = form.watch('patientId');
  const administrativeUnitValue = form.watch('administrativeData.unit');
  const draftKey = useMemo(
    () => `handoverDraft:${patientIdValue ?? 'unknown'}:${administrativeUnitValue ?? 'unknown'}`,
    [patientIdValue, administrativeUnitValue],
  );

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const errors: HandoverFormErrors = formState.errors ?? {};
  const hasValidationErrors = Object.keys(errors).length > 0;
  const medsError = errors.meds?.message as string | undefined;
  const dxMedicalError = errors.dxMedical?.message as string | undefined;
  const dxNursingError = errors.dxNursing?.message as string | undefined;
  const evolutionError = errors.evolution?.message as string | undefined;
  const signatureUser = useMemo(() => normalizeSignatureUser(authSession ?? session), [authSession, session]);
  const activeUnitId = administrativeUnitValue || signatureUser?.activeUnitId || signatureUser?.units?.[0];
  const demoActorKind = isDemoSession ? getDemoActorIdentity(signatureUser?.userId ?? '')?.kind : undefined;
  const canSignOutgoing = Boolean(
    signatureUser &&
      (signatureUser.roles ?? (signatureUser.role ? [signatureUser.role] : [])).includes('nurse') &&
      activeUnitId &&
      demoActorKind !== 'incoming',
  );
  
  // BEGIN HANDOVER D4 – Get active unit
  // Pilot-control and runtime must use a stable route/store unit id, not the free-text administrative field.
  const effectivePilotUnitId = resolveCanonicalPilotContextUnitId(unitIdParam, selectedUnitId);
  const authorizedUnitScope = useMemo(() => {
    if (capabilities?.permissions.isAdmin) return null;
    const capabilityUnitIds = Array.isArray(capabilities?.unitIds)
      ? capabilities.unitIds.filter((unitId) => typeof unitId === 'string' && unitId.trim().length > 0)
      : [];
    if (capabilityUnitIds.length > 0) {
      return new Set(capabilityUnitIds);
    }
    const sessionUnitIds = Array.isArray(authSession?.units)
      ? authSession.units.filter((unitId) => typeof unitId === 'string' && unitId.trim().length > 0)
      : [];
    if (sessionUnitIds.length > 0) {
      return new Set(sessionUnitIds);
    }
    return null;
  }, [authSession?.units, capabilities]);
  const unitAccessDeniedOnRender = Boolean(
    authorizedUnitScope &&
      effectivePilotUnitId &&
      !authorizedUnitScope.has(effectivePilotUnitId),
  );
  const writeAccessDeniedOnRender = capabilities?.permissions.canWriteHandover === false;
  const pilotControlSnapshot = usePilotControlContext({
    unitId: effectivePilotUnitId,
    roles: pilotRoles,
  });
  const profileRuntime = useMemo(
    () =>
      resolveHandoverProfileRuntime({
        unitId: effectivePilotUnitId,
        specialtyId,
        roles: pilotRoles,
      }),
    [effectivePilotUnitId, pilotControlSnapshot, pilotRoles, specialtyId],
  );
  const { features } = profileRuntime;
  const handoverTiming = useHandoverTiming({ enabled: Boolean(features.showHandoverTimingMetrics) });
  const checklistItems = useMemo(
    () => profileRuntime.checklistItems ?? DEFAULT_BEDSIDE_CHECKLIST_ITEMS,
    [profileRuntime.checklistItems],
  );
  const visibleSections = useMemo(
    () => getHandoverVisibleSections(ALL_SECTIONS_INFO, profileRuntime.sectionVisibility),
    [profileRuntime.sectionVisibility],
  );
  const visibleSectionKeys = useMemo(
    () => new Set(visibleSections.map((section) => section.key)),
    [visibleSections],
  );
  const isSectionVisible = useCallback(
    (sectionKey: SectionKey) => visibleSectionKeys.has(sectionKey),
    [visibleSectionKeys],
  );
  const showLegacySbarNarrative = profileRuntime.fieldVisibility['legacy-sbar-narrative'];
  const showLegacyMedicationText = profileRuntime.fieldVisibility['legacy-medication-text'];
  const showLegacyNursingDiagnosisText = profileRuntime.fieldVisibility['legacy-nursing-diagnosis-text'];
  const showNicCodingHint = profileRuntime.fieldVisibility['nic-coding-hint'];
  const showHandoverTimingHint = profileRuntime.fieldVisibility['handover-timing-hint'];
  const qrPatientScanEnabled = useMemo(
    () =>
      isQrPatientScanEnabled({
        unitId: effectivePilotUnitId,
        specialtyId,
      }),
    [effectivePilotUnitId, specialtyId],
  );
  const patientIdentificationHint = useMemo(
    () =>
      getPatientIdentificationHint({
        unitId: effectivePilotUnitId,
        specialtyId,
      }),
    [effectivePilotUnitId, specialtyId],
  );

  useEffect(() => {
    if (!features.showHandoverTimingMetrics || timingInitializedRef.current) return;
    timingInitializedRef.current = true;
    (Object.keys(TIMED_SECTIONS_BY_KEY) as SectionKey[]).forEach((key) => {
      const section = TIMED_SECTIONS_BY_KEY[key];
      if (!section) return;
      if (!collapsedSections[key] && isSectionVisible(key)) {
        handoverTiming.start(section);
      }
    });
  }, [collapsedSections, features.showHandoverTimingMetrics, handoverTiming, isSectionVisible]);

  // END HANDOVER D4 – Get active unit
  const [watchedVitals, watchedBraden, watchedOxygen] = form.watch([
    'vitals',
    'braden',
    'oxygenTherapy',
  ]);
  const watchedValues = form.watch();

  useEffect(() => {
    if (showLegacySbarNarrative) {
      const summary = form.getValues('closingSummary')?.trim() ?? '';
      const sbarLegacy = form.getValues('sbarFullText')?.trim() ?? '';
      if (summary && !sbarLegacy) {
        form.setValue('sbarFullText', summary, { shouldDirty: false, shouldValidate: false });
      }
    }

    if (showLegacyMedicationText) {
      const medsLegacy = form.getValues('meds')?.trim() ?? '';
      const medications = form.getValues('medications') ?? [];
      if (!medsLegacy && medications.length > 0) {
        const derived = medications
          .map((item) => item?.name?.trim() ?? '')
          .filter(Boolean)
          .join(', ');
        if (derived) {
          form.setValue('meds', derived, { shouldDirty: false, shouldValidate: false });
        }
      }
    }
  }, [showLegacyMedicationText, showLegacySbarNarrative, watchedValues.closingSummary, watchedValues.sbarFullText, watchedValues.medications, watchedValues.meds, form]);

  const buildOutgoingSignature = (payload: SignaturePadValue): HandoverSignature | null => {
    if (!signatureUser || !activeUnitId) return null;
    const fullName =
      signatureUser.fullName ??
      signatureUser.name ??
      signatureUser.displayName ??
      signatureUser.userId ??
      t('signatures.unknownUser');
    const role = (signatureUser.roles?.[0] as HandoverSignature['role']) ??
      (signatureUser.role as HandoverSignature['role']) ??
      'nurse';
    const userId = signatureUser.id ?? signatureUser.userId ?? signatureUser.displayName ?? 'unknown-user';
    const contentToSign = JSON.stringify(form.getValues());
    const signatureHash = hashHex(`${contentToSign}${payload.signedAt}${payload.imageBase64}`);
    return {
      userId,
      fullName,
      role,
      unitId: activeUnitId,
      signedAt: payload.signedAt,
      imageBase64: payload.imageBase64,
      signatureHash,
      deviceInfo: undefined,
      method: 'session',
    };
  };

  const recordClosureAttestation = useCallback(
    async (kind: 'outgoing' | 'incoming', signature: HandoverSignature) => {
      const patientId = form.getValues('patientId');
      if (!patientId) return;

      const auditKey = `${patientId}|${kind}|${signature.userId}|${signature.signedAt}`;
      if (auditedAttestationsRef.current.has(auditKey)) {
        return;
      }

      const shiftCode = deriveShiftCode(form.getValues('administrativeData')?.shiftStart);
      const auditEvent = makeAuditEvent(
        {
          type: 'handover_signed',
          patientId,
          userId: signature.userId,
          unitId: signature.unitId,
          shiftCode,
          meta: {
            attestationRole: kind,
            actorRole: signature.role ?? 'nurse',
            method: signature.method ?? 'session',
            capture: 'closure',
          },
        },
        () => new Date(signature.signedAt),
      );
      const delivered = await queueAndFlushAuditEvent(auditStorageRef.current, auditEvent);
      if (delivered) {
        auditedAttestationsRef.current.add(auditKey);
      }
    },
    [form],
  );

  const dxText = (value: unknown): string => {
    if (typeof value === 'string') return value.trim();
    if (value && typeof value === 'object') {
      const r = value as Record<string, unknown>;
      const display = typeof r.display === 'string' ? r.display.trim() : '';
      const code = typeof r.code === 'string' ? r.code.trim() : '';
      return display || code || '';
    }
    return '';
  };    

  const { loadNow: loadDraftNow, scheduleSave } = useDraftAutosave<HandoverFormValues>({
    patientId: patientIdValue,
    enabled: true,
    delay: 800,
    getSnapshot: () => form.getValues(),
    onLoad: (data) => {
      if (!data) return;
      const normalizedDxMedical =
        data.dxMedical === undefined ? undefined : normalizeLegacySnomedCoding(data.dxMedical);

      // dxNursing es texto legacy -> normaliza a string (o undefined) sin SNOMED
      const normalizedDxNursing =
        data.dxNursing === undefined ? undefined : (dxText(data.dxNursing) || undefined);

      const normalizedData: Partial<HandoverFormValues> = normalizeLegacyFormSnapshot({
        ...data,
        ...(data.dxMedical !== undefined ? { dxMedical: normalizedDxMedical } : {}),
        ...(data.dxNursing !== undefined ? { dxNursing: normalizedDxNursing } : {}),
      });

      form.reset({ ...form.getValues(), ...normalizedData });
    },
  });
  const lastAudioNoteUriRef = useRef<string | null>(null);

  useEffect(() => {
    if (!audioNoteParam) return;
    const { uri, transcription, uploadToFhir } = audioNoteParam;
    if (uri && uri === lastAudioNoteUriRef.current) {
      return;
    }
    if (uri) {
      form.setValue('audioUri', uri, { shouldDirty: true, shouldValidate: true });
      lastAudioNoteUriRef.current = uri;
    }
    if (typeof transcription === 'string' && transcription.trim()) {
      const current = form.getValues('audioTranscription') ?? '';
      const merged = mergeDictationText(current, transcription);
      form.setValue('audioTranscription', merged, { shouldDirty: true, shouldValidate: true });
    }
    if (typeof uploadToFhir === 'boolean') {
      setAudioUploadToFhir(uploadToFhir);
    }
    navigation.setParams({ audioNote: undefined } as never);
  }, [audioNoteParam, form, navigation]);

  useEffect(() => {
    if (IS_TEST) return;

    let cancelled = false;

    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(draftKey);
        if (cancelled) return;

        const draft = safeJsonParse<Partial<HandoverFormValues>>(raw);
        if (!draft) return;

        // Importante: NO pisar si ya hay datos
        const current = getValues();
        const isEmpty = !current || Object.keys(current).length === 0;
        if (isEmpty) {
          const normalizedDxMedical =
            draft?.dxMedical === undefined ? undefined : normalizeLegacySnomedCoding(draft.dxMedical);

          const normalizedDxNursing =
            draft?.dxNursing === undefined ? undefined : (dxText(draft.dxNursing) || undefined);

          const normalizedDraft: Partial<HandoverFormValues> = normalizeLegacyFormSnapshot({
            ...draft,
            ...(draft?.dxMedical !== undefined ? { dxMedical: normalizedDxMedical } : {}),
            ...(draft?.dxNursing !== undefined ? { dxNursing: normalizedDxNursing } : {}),
          });
          reset(normalizedDraft);
        }
      } catch {
        // no-op
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [draftKey, reset, getValues]);

  type BedsideChecklistSnapshot = HandoverFormValues['bedsideChecklist'] &
    Record<string, boolean | string | undefined>;
  const prevChecklistRef = useRef<BedsideChecklistSnapshot | undefined>(undefined);

  useEffect(() => {
    const sub = form.watch((values, meta) => {
      if (!meta?.name?.startsWith('bedsideChecklist')) return;

      const current = (values?.bedsideChecklist ?? {}) as BedsideChecklistSnapshot;
      const prev = prevChecklistRef.current ?? ({} as BedsideChecklistSnapshot);

      for (const [key, value] of Object.entries(current)) {
        if (key.endsWith('_timestamp')) continue;

        const prevVal = prev[key];
        if (prevVal !== true && value === true) {
          const tsKey = `bedsideChecklist.${key}_timestamp` as Path<HandoverFormValues>;
          const existing = form.getValues(tsKey);

          if (!existing) {
            form.setValue(tsKey, new Date().toISOString(), {
              shouldDirty: true,
              shouldTouch: false,
              shouldValidate: false,
            });
          }
        }
      }

      prevChecklistRef.current = current;
    });

    return () => {
      sub?.unsubscribe?.();
    };
  }, [form]);

  useEffect(() => {
    if (IS_TEST) return;

    const subscription = watch((values) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

      saveTimerRef.current = setTimeout(() => {
        void SecureStore.setItemAsync(draftKey, JSON.stringify(values)).catch(() => {});
      }, 300);
    });

    return () => {
      subscription?.unsubscribe?.();
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [watch, draftKey]);

  const computedAlerts = useMemo(() => computeAlerts(watchedValues), [watchedValues]);
  const riskEvaluation = useMemo(
    () => deriveRiskEvaluationFromValues(watchedVitals, watchedBraden, watchedOxygen),
    [watchedBraden, watchedOxygen, watchedVitals],
  );
  const news2Breakdown = useMemo(() => {
    const vitals = watchedVitals ?? {};
    const oxygen = watchedOxygen ?? {};
    const input = {
      rr: vitals.rr,
      spo2: vitals.spo2,
      temp: vitals.tempC,
      sbp: vitals.sbp,
      hr: vitals.hr,
      o2: Boolean(oxygen.device || oxygen.flowLMin != null || oxygen.fio2 != null),
      avpu: vitals.avpu,
    };
    return computeNEWS2(input);
  }, [watchedOxygen, watchedVitals]);
  const bradenScore = useMemo(() => {
    if (!watchedBraden) return undefined;
    const values = [
      watchedBraden.sensoryPerception,
      watchedBraden.moisture,
      watchedBraden.activity,
      watchedBraden.mobility,
      watchedBraden.nutrition,
      watchedBraden.frictionShear,
    ];
    if (values.some((value) => typeof value !== 'number')) {
      return undefined;
    }
    return values.reduce((total, value) => total + (value ?? 0), 0);
  }, [watchedBraden]);
  const [suggestionsState, setSuggestionsState] = useState<{ vitals: SuggestionsResult | null; diagnosis: SuggestionsResult | null }>(
    { vitals: null, diagnosis: null },
  );
  const [suggestionsLoading, setSuggestionsLoading] = useState<'vitals' | 'diagnosis' | null>(null);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const suggestionsCacheRef = useRef<
    Record<string, { timestamp: number; contextHash: string; result: SuggestionsResult | null }>
  >({});
  const hasEffectivePilotUnitContext = Boolean((effectivePilotUnitId ?? '').trim());
  const aiSuggestionsEnabled =
    hasEffectivePilotUnitContext &&
    isOn('AI_SUGGESTIONS_ENABLED') &&
    isPilotFeatureEnabled('ai_suggestions', {
      unitId: effectivePilotUnitId,
      roles: pilotRoles,
    });
  const governedNnnEnabled = isPilotFeatureEnabled('governed_nnn', {
    unitId: effectivePilotUnitId,
    roles: pilotRoles,
  });
  const buildDraftSnomedCoding = (text: string): SnomedCoding => {
    const display = (text ?? '').trim();

    if (!display) {
      return { system: SNOMED_SYSTEM, code: '', display: '' };
    }

    const resolved = resolveSnomedCoding(display);
    return resolved ?? { system: SNOMED_SYSTEM, code: '', display };
  };
  const dictationAdapters = useMemo(
    () => ({
      dxMedical: {
        get: () => form.getValues('dxMedical')?.display ?? '',
        set: (text: string) =>
          form.setValue('dxMedical', buildDraftSnomedCoding(text), {
            shouldDirty: true,
            shouldValidate: true,
          }),
      },
      dxNursing: {
        get: () => form.getValues('dxNursing') ?? '',
        set: (text: string) =>
          form.setValue('dxNursing', text, { shouldDirty: true, shouldValidate: true }),
      },
      meds: {
        get: () => form.getValues('meds') ?? '',
        set: (text: string) => form.setValue('meds', text, { shouldDirty: true, shouldValidate: true }),
      },
      evolution: {
        get: () => form.getValues('evolution') ?? '',
        set: (text: string) => form.setValue('evolution', text, { shouldDirty: true, shouldValidate: true }),
      },
      closingSummary: {
        get: () => form.getValues('closingSummary') ?? '',
        set: (text: string) => form.setValue('closingSummary', text, { shouldDirty: true, shouldValidate: true }),
      },
      incidents: {
        get: () => {
          const current = form.getValues('administrativeData.incidents');
          return Array.isArray(current) ? current.join('\n') : '';
        },
        set: (text: string) => {
          const items = text
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
          form.setValue('administrativeData.incidents', items, {
            shouldDirty: true,
            shouldValidate: true,
          });
        },
      },
    }),
    [form],
  );
  const sttServiceRef = useRef<SttService | null>(null);
  if (!sttServiceRef.current) {
    sttServiceRef.current = createSttService();
  }
  const [sttStatus, setSttStatus] = useState<SttStatus>(sttServiceRef.current.getStatus());
  const [sttError, setSttError] = useState<SttErrorCode | null>(sttServiceRef.current.getLastError());
  const [activeDictationField, setActiveDictationField] = useState<DictationField | null>(null);
  const [lastDictationField, setLastDictationField] = useState<DictationField | null>(null);
  const [dictatedPartial, setDictatedPartial] = useState('');
  const activeFieldRef = useRef<DictationField | null>(null);
  const [isRefiningSbarWithAI, setIsRefiningSbarWithAI] = useState(false);
  const [isGeneratingSbarWithAI, setIsGeneratingSbarWithAI] = useState(false);
  const [sbarAiError, setSbarAiError] = useState<string | null>(null);
  const [sbarHelperMessage, setSbarHelperMessage] = useState<string | null>(null);
  const [pendingSbarSuggestion, setPendingSbarSuggestion] = useState<PendingSbarSuggestion | null>(null);
  const automaticSbarAttemptsRef = useRef<Set<string>>(new Set());
  const lastAutomaticSbarFingerprintRef = useRef<string | null>(null);
  const dictationUnavailableNotifiedRef = useRef(false);
  const [audioUploadToFhir, setAudioUploadToFhir] = useState(false);
  const [audioUploadStatus, setAudioUploadStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [audioUploadError, setAudioUploadError] = useState<string | null>(null);
  const {
    syncSnapshot,
    handoverSyncStatus,
    handoverSyncError,
    retrySync,
    setHandoverSyncStatus,
    setHandoverSyncError,
    setTrackedQueueId,
  } = useHandoverSyncStatus();
  const aiSbarAvailable = AI_SBAR_ENABLED;
  const aiSbarGenerationAvailable = AI_BACKEND_ENABLED;
  const resolveTraceableSbarAiContext = (values?: Pick<HandoverFormValues, 'patientId'>) => {
    const patientId =
      typeof values?.patientId === 'string'
        ? values.patientId.trim()
        : typeof patientIdValue === 'string'
          ? patientIdValue.trim()
          : '';
    const unitId = (effectivePilotUnitId ?? '').trim();
    return {
      patientId,
      unitId,
      ready: Boolean(patientId && unitId),
    };
  };
  const canUseAiSbarAssist = resolveTraceableSbarAiContext().ready;

  const requireTraceableSbarAiContext = (values?: Pick<HandoverFormValues, 'patientId'>) => {
    const context = resolveTraceableSbarAiContext(values);
    if (context.ready) return context;
    setSbarAiError(null);
    setSbarHelperMessage(t('handover.sbarAiTraceabilityRequired'));
    return null;
  };

  useEffect(() => {
    if (!audioUploadToFhir) {
      setAudioUploadStatus('idle');
      setAudioUploadError(null);
    }
  }, [audioUploadToFhir]);

  useEffect(() => {
    activeFieldRef.current = activeDictationField;
  }, [activeDictationField]);

  useEffect(() => {
    const service = sttServiceRef.current ?? createSttService();
    sttServiceRef.current = service;
    setSttStatus(service.getStatus());
    setSttError(service.getLastError());
    const unsubscribe = service.addListener((result) => {
      setSttStatus(service.getStatus());
      setSttError(service.getLastError());
      const target = activeFieldRef.current;
      const adapter = target ? dictationAdapters[target] : undefined;
      if (!target || !adapter) {
        return;
      }
      if (!result.isFinal) {
        setDictatedPartial(result.text);
        return;
      }
      const trimmed = result.text.trim();
      if (trimmed) {
        const merged = mergeDictationText(adapter.get(), trimmed);
        adapter.set(merged);
      }
      setDictatedPartial('');
      setActiveDictationField(null);
      setLastDictationField(target);
    });
    return () => {
      unsubscribe();
      void service.cancel();
    };
  }, [dictationAdapters]);

  const dictationUnavailable = sttError === 'UNSUPPORTED' || sttServiceRef.current?.getLastError() === 'UNSUPPORTED';

  const handleSpeak = (text?: string) => {
    Speech.stop();
    const safeText = (text ?? '').trim();
    if (!safeText) return;
    Speech.speak(safeText, { language: 'es-ES', pitch: 1.0, rate: 1.0 });
  };

  const handleSpeakNotes = () => {
    const evolutionNotes = form.getValues('evolution') ?? '';
    const closingNotes = form.getValues('closingSummary') ?? '';
    const combinedNotes = [evolutionNotes, closingNotes].map((note) => note.trim()).filter(Boolean);
    handleSpeak(combinedNotes.join('\n\n'));
  };

  const handleDictationPress = async (field: DictationField, config: SttConfig) => {
    Speech.stop();
    const adapter = dictationAdapters[field];
    if (!adapter) return;
    const service = sttServiceRef.current ?? createSttService();
    sttServiceRef.current = service;
    if (service.getLastError() === 'UNSUPPORTED') {
      setSttError('UNSUPPORTED');
      setActiveDictationField(null);
      setLastDictationField(field);
      if (!dictationUnavailableNotifiedRef.current) {
        dictationUnavailableNotifiedRef.current = true;
        Alert.alert(t('audioNote.dictationUnavailable'));
      }
      return;
    }
    const togglingSameField = sttStatus === 'listening' && activeDictationField === field;
    if (togglingSameField) {
      try {
        setSttStatus('processing');
        await service.stop();
      } catch {
        setSttError(service.getLastError() ?? 'UNKNOWN');
      } finally {
        setSttStatus(service.getStatus());
      }
      return;
    }

    setActiveDictationField(field);
    setLastDictationField(field);
    setDictatedPartial('');
    setSttError(null);
    try {
      const permission = await getRecordingPermissionsAsync();
      if (!permission.granted) {
        const res = await requestRecordingPermissionsAsync();
        if (!res.granted) {
          setSttError('PERMISSION_DENIED');
          setActiveDictationField(null);
          Alert.alert(t('permissions.microphoneDeniedTitle'), t('permissions.microphoneRequiredDictation'));
          return;
        }
      }
      await service.start(config);
    } catch {
      setSttError(service.getLastError() ?? 'UNKNOWN');
      setActiveDictationField(null);
    } finally {
      setSttStatus(service.getStatus());
      if (service.getStatus() !== 'listening') {
        setActiveDictationField(null);
      }
      setSttError(service.getLastError());
    }
  };

  const renderDictationStatus = (field: DictationField) => {
    if (dictationUnavailable) {
      return null;
    }
    if (activeDictationField === field && sttStatus === 'listening') {
      return (
        <Text style={styles.dictationStatus}>
          {t('audioNote.dictationListening')} {dictatedPartial ? `“${dictatedPartial}”` : ''}
        </Text>
      );
    }
    if (activeDictationField === field && sttStatus === 'processing') {
      return <Text style={styles.dictationStatus}>{t('handover.dictationProcessing')}</Text>;
    }
    if (lastDictationField === field && sttError && !dictationUnavailable) {
      const message =
        sttError === 'PERMISSION_DENIED'
          ? t('audioNote.dictationPermissionError')
          : t('audioNote.dictationGenericError');
      return <Text style={[styles.dictationError, { color: colors.danger }]}>{message}</Text>;
    }
    return null;
  };
  const sbarSituationError = errors.sbarSituation?.message as string | undefined;
  const sbarBackgroundError = errors.sbarBackground?.message as string | undefined;
  const sbarAssessmentError = errors.sbarAssessment?.message as string | undefined;
  const sbarRecommendationError = errors.sbarRecommendation?.message as string | undefined;
  const sbarFullTextError = errors.sbarFullText?.message as string | undefined;

  useEffect(() => {
    if (patientIdParam) {
      const fieldState = form.getFieldState?.('patientId');
      const current = form.getValues('patientId');
      if (!fieldState?.isDirty && current !== patientIdParam) {
        form.setValue('patientId', patientIdParam, {
          shouldDirty: false,
          shouldValidate: true,
        });
      }
    }
  }, [patientIdParam, form]);

  useEffect(() => {
    if (unitIdParam) {
      const fieldState = form.getFieldState?.('administrativeData.unit');
      const current = form.getValues('administrativeData.unit');
      if (!fieldState?.isDirty && current !== unitIdParam) {
        form.setValue('administrativeData.unit', unitIdParam, {
          shouldDirty: false,
          shouldValidate: true,
        });
      }
    }
  }, [unitIdParam, form]);

  useEffect(() => {
    if (administrativeDataParam) {
      const current = form.getValues('administrativeData');
      const next: AdministrativeData = {
        ...current,
        ...administrativeDataParam,
        staffIn: administrativeDataParam.staffIn ?? current?.staffIn ?? [],
        staffOut: administrativeDataParam.staffOut ?? current?.staffOut ?? [],
        incidents: administrativeDataParam.incidents ?? current?.incidents ?? [],
        shiftType:
          administrativeDataParam.shiftType ??
          current?.shiftType ??
          deriveShiftType(administrativeDataParam.shiftStart),
        generalNotes: administrativeDataParam.generalNotes ?? current?.generalNotes,
      };

      form.setValue('administrativeData', next, { shouldDirty: true, shouldValidate: true });
    }
  }, [administrativeDataParam, form]);

  const parseNumericInput = (value: string) => {
    if (value === '') return undefined;
    const normalized = value.replace(',', '.');
    const parsed = Number(normalized);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  const buildDraftSbar = (values: HandoverFormValues): SBARSummary => {
    const manualDraft: SBARSummary = {
      situation: values.sbarSituation?.trim() ?? '',
      background: values.sbarBackground?.trim() ?? '',
      assessment: values.sbarAssessment?.trim() ?? '',
      recommendation: values.sbarRecommendation?.trim() ?? '',
    };

    const hasManualContent = Object.values(manualDraft).some((value) => value.length > 0);
    if (hasManualContent) {
      return manualDraft;
    }

    try {
      return generateSBARSummary(values, { maxCharsPerSection: 320 });
    } catch {
      return manualDraft;
    }
  };

  const buildSbarContext = (values: HandoverFormValues) => ({
    patientId: values.patientId,
    administrativeData: values.administrativeData,
    dxMedical: values.dxMedical ?? '',
    dxNursing: values.dxNursing ?? '',
    vitals: values.vitals,
    medications: values.medications,
    medsFreeText: values.meds,
    treatments: values.treatments,
    exams: values.exams,
    procedures: values.procedures,
    evolution: values.evolution,
    audioTranscription: values.audioTranscription,
    risks: values.risks,
    risksStructured: values.risksStructured,
    oxygenTherapy: normalizeOxygenTherapyInput(values.oxygenTherapy),
    devices: values.devices,
    nutrition: values.nutrition,
    elimination: values.elimination,
    mobility: values.mobility,
    skin: values.skin,
    psychosocial: values.psychosocial,
    fluidBalance: values.fluidBalance,
    painAssessment: values.painAssessment,
    braden: values.braden,
    glasgow: values.glasgow,
    bedsideChecklist: values.bedsideChecklist,
    turnContext: values.turnContext,
    pendingTasks: values.pendingTasks,
    contingencyPlan: values.contingencyPlan,
  });

  const buildSbarFreeText = (values: HandoverFormValues) => {
    const sections = [
      values.evolution,
      values.closingSummary,
      values.audioTranscription,
      values.meds,
    ]
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);

    return sections.join('\n\n');
  };

  const buildSbarFullText = (summary: SBARSummary, source: 'local' | 'ai' = 'local') => {
    const base = formatSbar(summary, 'es');
    const provenance =
      source === 'local'
        ? t(isDemoSession ? 'handover.sbarSyntheticProvenance' : 'handover.sbarLocalProvenance')
        : undefined;
    const notice = t('handover.sbarLegalNotice');
    const notices = [provenance, notice].filter((value): value is string => Boolean(value));
    return base.trim() ? `${base}\n\n${notices.join('\n')}` : notices.join('\n');
  };

  const buildSbarDecisionHash = (summary: Pick<SBARSummary, 'situation' | 'background' | 'assessment' | 'recommendation'>) =>
    hashHex([summary.situation, summary.background, summary.assessment, summary.recommendation].join('\n'));

  const clearPendingSbarSuggestion = (
    decision?: 'accepted' | 'rejected',
    reasonCode?: 'direct_apply' | 'replace_existing' | 'not_relevant',
  ) => {
    const pending = pendingSbarSuggestion;
    if (!pending) return;

    if (pending.mode === 'ai' && decision) {
      void logClinicalDecision({
        patientId: pending.patientId,
        unitId: pending.unitId,
        suggestionSource: pending.source,
        decision,
        ...(reasonCode ? { reasonCode } : {}),
        metadata: {
          section: 'sbar',
          suggestionCount: 1,
          suggestionHashes: [pending.hash],
          replaceExisting: pending.replaceExisting,
        },
      });
    }

    setPendingSbarSuggestion(null);
  };

  const getSbarFallbackHelperMessage = (code: AISbarErrorCode) => {
    switch (code) {
      case 'UNAUTHORIZED':
        return t('handover.sbarAiUnauthorizedFallbackHelper');
      case 'UNCONFIGURED':
        return t('handover.sbarAiDisabledFallbackHelper');
      default:
        return t('handover.sbarAiFallbackHelper');
    }
  };

  const showPendingSbarSuggestion = (
    values: HandoverFormValues,
    input: {
      source: PendingSbarSuggestion['source'];
      mode: PendingSbarSuggestion['mode'];
      summary: SBARSummary;
      fullText?: string;
      helperMessage: string;
    },
  ) => {
    const traceableContext = resolveTraceableSbarAiContext(values);
    if (input.mode === 'ai' && !traceableContext.ready) {
      setSbarAiError(null);
      setSbarHelperMessage(t('handover.sbarAiTraceabilityRequired'));
      return;
    }

    clearPendingSbarSuggestion('rejected', 'replace_existing');

    const summary = input.summary;
    const fullText = input.fullText ?? buildSbarFullText(summary, input.mode === 'ai' ? 'ai' : 'local');
    const nextPending: PendingSbarSuggestion = {
      patientId: traceableContext.patientId,
      unitId: traceableContext.unitId,
      source: input.source,
      mode: input.mode,
      summary,
      fullText,
      hash: buildSbarDecisionHash(summary),
      replaceExisting: Boolean((values.closingSummary ?? '').trim()),
    };

    setPendingSbarSuggestion(nextPending);
    setSbarAiError(null);
    setSbarHelperMessage(input.helperMessage);

    if (input.mode === 'ai') {
      void logClinicalDecision({
        patientId: nextPending.patientId,
        unitId: nextPending.unitId,
        suggestionSource: nextPending.source,
        decision: 'shown',
        metadata: {
          section: 'sbar',
          suggestionCount: 1,
          suggestionHashes: [nextPending.hash],
          replaceExisting: nextPending.replaceExisting,
        },
      });
    }
  };

  const applyPendingSbarSuggestion = () => {
    if (!pendingSbarSuggestion) return;

    const { summary, fullText, mode } = pendingSbarSuggestion;
    form.setValue('sbarSituation', summary.situation, { shouldDirty: true, shouldValidate: true });
    form.setValue('sbarBackground', summary.background, { shouldDirty: true, shouldValidate: true });
    form.setValue('sbarAssessment', summary.assessment, { shouldDirty: true, shouldValidate: true });
    form.setValue('sbarRecommendation', summary.recommendation, { shouldDirty: true, shouldValidate: true });
    form.setValue('closingSummary', fullText, { shouldDirty: true, shouldValidate: true });

    clearPendingSbarSuggestion('accepted', 'direct_apply');
    setSbarAiError(null);
    setSbarHelperMessage(
      mode === 'ai' ? t('handover.sbarSuggestionAcceptedHelper') : t('handover.sbarFallbackAcceptedHelper'),
    );
  };

  const rejectPendingSbarSuggestion = () => {
    if (!pendingSbarSuggestion) return;

    const mode = pendingSbarSuggestion.mode;
    clearPendingSbarSuggestion('rejected', 'not_relevant');
    setSbarAiError(null);
    setSbarHelperMessage(
      mode === 'ai' ? t('handover.sbarSuggestionRejectedHelper') : t('handover.sbarFallbackRejectedHelper'),
    );
  };

  const handleRefineSbarWithAi = async () => {
    const values = form.getValues();
    const draft = buildDraftSbar(values);
    if (!requireTraceableSbarAiContext(values)) {
      return;
    }

    setIsRefiningSbarWithAI(true);
    setSbarAiError(null);
    setSbarHelperMessage(null);

    try {
      const result = await refineSBARWithAIResult(values, draft);
      if (result.ok) {
        showPendingSbarSuggestion(values, {
          source: 'ai_refine_sbar',
          mode: 'ai',
          summary: result.summary,
          helperMessage: t('handover.sbarSuggestionReadyHelper'),
        });
        return;
      }

      const fallbackSummary = await getBestAvailableSummary(values, { useLocalRules: true });
      showPendingSbarSuggestion(values, {
        source: 'ai_refine_sbar',
        mode: 'local_fallback',
        summary: fallbackSummary,
        helperMessage: getSbarFallbackHelperMessage(result.error.code),
      });
    } finally {
      setIsRefiningSbarWithAI(false);
    }
  };

  const handleGenerateSbarWithAi = async () => {
    const values = form.getValues();
    if (!requireTraceableSbarAiContext(values)) {
      return;
    }

    setIsGeneratingSbarWithAI(true);
    setSbarAiError(null);
    setSbarHelperMessage(null);

    try {
      const freeText = buildSbarFreeText(values);
      const result = await generateSbarViaBackendResult(freeText, buildSbarContext(values), 'es');

      if (result.ok) {
        showPendingSbarSuggestion(values, {
          source: 'ai_generate_sbar',
          mode: 'ai',
          summary: {
            situation: result.result.situation,
            background: result.result.background,
            assessment: result.result.assessment,
            recommendation: result.result.recommendation,
          },
          fullText: result.result.fullText,
          helperMessage: t('handover.sbarSuggestionReadyHelper'),
        });
        return;
      }

      const fallbackSummary = await getBestAvailableSummary(values, { useLocalRules: true });
      showPendingSbarSuggestion(values, {
        source: 'ai_generate_sbar',
        mode: 'local_fallback',
        summary: fallbackSummary,
        helperMessage: getSbarFallbackHelperMessage(result.error.code),
      });
    } finally {
      setIsGeneratingSbarWithAI(false);
    }
  };

  const applyDeterministicSbar = (generated: DeterministicSbar, shouldDirty: boolean) => {
    const flags = { shouldDirty, shouldValidate: shouldDirty };
    form.setValue('sbarSituation', generated.summary.situation, flags);
    form.setValue('sbarBackground', generated.summary.background, flags);
    form.setValue('sbarAssessment', generated.summary.assessment, flags);
    form.setValue('sbarRecommendation', generated.summary.recommendation, flags);
    form.setValue('closingSummary', generated.fullText, flags);
    lastAutomaticSbarFingerprintRef.current = generated.fingerprint;
    setSbarHelperMessage(t('handover.sbarAutoGeneratedHelper'));
    setSbarAiError(null);
  };

  const createCurrentDeterministicSbar = (values: HandoverFormValues) => {
    const provenance = t(
      isDemoSession ? 'handover.sbarSyntheticProvenance' : 'handover.sbarLocalProvenance',
    );
    return createDeterministicSbar(values, `${provenance}\n${t('handover.sbarLegalNotice')}`);
  };

  const handleGenerateSbarSuggestion = () => {
    try {
      clearPendingSbarSuggestion('rejected', 'replace_existing');
      const values = form.getValues();
      const generated = createCurrentDeterministicSbar(values);
      const replace = () => applyDeterministicSbar(generated, true);
      const currentWasModified =
        hasSbarContent(values) &&
        lastAutomaticSbarFingerprintRef.current !== getSbarFingerprint(values);

      if (currentWasModified) {
        Alert.alert(
          t('handover.sbarRegenerateTitle'),
          t('handover.sbarRegenerateMessage'),
          [
            { text: t('common.cancel'), style: 'cancel' },
            { text: t('handover.replaceLabel'), style: 'destructive', onPress: replace },
          ],
          { cancelable: true },
        );
        return;
      }

      replace();
    } catch {
      Alert.alert(
        t('handover.sbarAutoGenerateAlertTitle'),
        t('handover.sbarAutoGenerateAlertMessage'),
      );
    }
  };

  useEffect(() => {
    const patientId = typeof patientIdValue === 'string' ? patientIdValue.trim() : '';
    if (!patientId) return;
    if (patientId.startsWith('demo-') && !demoPrefill) return;

    const attemptKey = `${patientId}|${effectivePilotUnitId ?? ''}`;
    if (automaticSbarAttemptsRef.current.has(attemptKey)) return;
    automaticSbarAttemptsRef.current.add(attemptKey);

    const values = form.getValues();

    try {
      const provenance = t(
        isDemoSession ? 'handover.sbarSyntheticProvenance' : 'handover.sbarLocalProvenance',
      );
      const generated = createInitialDeterministicSbar(
        values,
        `${provenance}\n${t('handover.sbarLegalNotice')}`,
      );
      if (!generated) return;
      const flags = { shouldDirty: false, shouldValidate: false };
      form.setValue('sbarSituation', generated.summary.situation, flags);
      form.setValue('sbarBackground', generated.summary.background, flags);
      form.setValue('sbarAssessment', generated.summary.assessment, flags);
      form.setValue('sbarRecommendation', generated.summary.recommendation, flags);
      form.setValue('closingSummary', generated.fullText, flags);
      lastAutomaticSbarFingerprintRef.current = generated.fingerprint;
      setSbarHelperMessage(t('handover.sbarAutoGeneratedHelper'));
    } catch {
      // The form remains fully usable when local summary generation cannot complete.
    }
  }, [demoPrefill, effectivePilotUnitId, form, isDemoSession, patientIdValue]);

  const trimmedPatientId =
    typeof patientIdValue === 'string' ? patientIdValue.trim() || undefined : undefined;
  // BEGIN HANDOVER D6 – HandoverForm PatientBanner
  const { loading: loadingPatient, error: patientSummaryError, summary: patientSummary } =
    usePatientSummary(trimmedPatientId);
  const bannerSummary: PatientSummary | null = useMemo(
    () => patientSummary ?? patientSummaryParam ?? null,
    [patientSummary, patientSummaryParam],
  );
  const bannerLoading = loadingPatient && !patientSummaryParam;
  const demoClinicalSummary = useMemo<DemoClinicalSummary | null>(() => {
    if (!isDemoSession || !demoPrefill) return null;
    const unitId = watchedValues.administrativeData?.unit;
    const vitals = watchedValues.vitals ?? {};
    const vitalParts = [
      typeof vitals.hr === 'number' ? `FC ${vitals.hr}` : null,
      typeof vitals.rr === 'number' ? `FR ${vitals.rr}` : null,
      typeof vitals.spo2 === 'number' ? `SpO₂ ${vitals.spo2}%` : null,
      typeof vitals.sbp === 'number' ? `TA ${vitals.sbp}` : null,
      typeof vitals.tempC === 'number' ? `T ${vitals.tempC}°C` : null,
    ].filter((value): value is string => Boolean(value));
    const activeRisks = (watchedValues.risksStructured ?? [])
      .filter((risk) => risk.present)
      .map((risk) => risk.type)
      .join(', ');
    const pending = (watchedValues.pendingTasks ?? [])
      .find((task) => task.priority === 'critical' || task.status === 'pending')?.title;

    return {
      unit: UNITS_BY_ID[unitId]?.name ?? unitId ?? 'Sin unidad',
      bed: bannerSummary?.bed,
      diagnosis: watchedValues.dxMedical?.display ?? 'Sin datos suficientes',
      medications: (watchedValues.medications ?? []).map((medication) => medication.name).join(', ') || 'Sin datos disponibles',
      vitals: vitalParts.join(' · ') || 'Sin datos suficientes',
      risks: activeRisks || 'Sin datos suficientes',
      pending: pending ?? 'Sin datos suficientes',
      lastUpdated: vitals.recordedAt ?? 'Sin datos suficientes',
    };
  }, [bannerSummary?.bed, demoPrefill, isDemoSession, watchedValues]);
  // END HANDOVER D6 – HandoverForm PatientBanner

  // BEGIN HANDOVER D2 – VitalTrends hook usage
  const shouldLoadVitalTrends = isOn('SHOW_VITALS') && !collapsedSections.signos;
  const {
    loading: loadingVitalTrends,
    error: vitalTrendsError,
    data: vitalTrends,
  } = useVitalTrends(shouldLoadVitalTrends ? trimmedPatientId : undefined);
  // END HANDOVER D2 – VitalTrends hook usage

  useEffect(() => {
    const targetPatientId = typeof patientIdValue === 'string' ? patientIdValue.trim() : '';
    if (!targetPatientId || auditedPatientsRef.current.has(targetPatientId)) return;

    (async () => {
      const activeSession = session ?? (await getSession());
      const sessionUser = getSessionUser(activeSession);
      const userId = sessionUser?.userId ?? sessionUser?.id ?? activeSession?.userId;
      if (!userId) return;
      const unitId =
        sessionUser?.activeUnitId ??
        sessionUser?.units?.[0] ??
        activeSession?.units?.[0];
      const shiftCode = deriveShiftCode(form.getValues('administrativeData.shiftStart'));
      const event = makeAuditEvent({
        type: 'patient_open',
        patientId: targetPatientId,
        userId,
        unitId: unitId ?? undefined,
        shiftCode,
      });
      const delivered = await queueAndFlushAuditEvent(auditStorageRef.current, event);
      if (delivered) {
        auditedPatientsRef.current.add(targetPatientId);
      }
    })();
  }, [form, patientIdValue, session]);

  const onScanPress = () => {
    if (!qrPatientScanEnabled) {
      Alert.alert(t('handover.scannerUnavailableTitle'), patientIdentificationHint);
      return;
    }

    const routeNames = navigation.getState?.().routeNames ?? [];
    if (routeNames.includes('QRScan')) {
      const trimmedPatientId =
        typeof patientIdValue === 'string' && patientIdValue.trim()
          ? patientIdValue.trim()
          : undefined;
      navigation.navigate('QRScan', {
        returnTo: 'HandoverForm',
        patientIdParam: trimmedPatientId,
        unitIdParam: effectivePilotUnitId ?? undefined,
        specialtyId,
      });
    } else {
      Alert.alert(t('handover.scannerUnavailableTitle'), t('handover.scannerUnavailableMessage'));
    }
  };

  const getFinalizationAttestationAlert = () => {
    const signatures = form.getValues('signatures');
    const outgoing = signatures?.outgoing;
    const incoming = signatures?.incoming;

    if (!outgoing || !outgoing.imageBase64) {
      return {
        title: t('handover.signatureMissingTitle'),
        message: t('handover.signatureMissingMessage'),
      };
    }

    if (!incoming) {
      return {
        title: t('handover.signatureMissingTitle'),
        message: t('handover.incomingAttestationMissingMessage'),
      };
    }

    if (incoming.userId === outgoing.userId) {
      return {
        title: t('handover.signatureMissingTitle'),
        message: t('handover.distinctAttestationRequiredMessage'),
      };
    }

    return null;
  };

  const handleInvalidSubmit = (formErrors: HandoverFormErrors) => {
    const currentStatus = form.getValues('status');
    const attestationAlert = currentStatus === 'final' ? getFinalizationAttestationAlert() : null;
    if (attestationAlert) {
      Alert.alert(attestationAlert.title, attestationAlert.message);
      return;
    }
    const message =
      typeof formErrors?.root?.message === 'string' ? formErrors.root.message : t('handover.saveErrorMessageFallback');
    Alert.alert(t('common.error'), message);
  };

  const buildClinicalContext = (section: 'vitals' | 'diagnosis'): ClinicalContext => {
    const vitals = watchedVitals ?? {};
    const oxygen = watchedOxygen ?? {};
      
    const vitalSigns = compactObject({
      respiratoryRate: vitals.rr,
      heartRate: vitals.hr,
      systolicBP: vitals.sbp,
      spo2: vitals.spo2,
      temperature: vitals.tempC,
      consciousness: vitals.avpu,
      onOxygen: Boolean(oxygen.device || oxygen.flowLMin != null || oxygen.fio2 != null),
    });

   const scores = compactNumberMap({
      news2: news2Breakdown?.total,
      braden: bradenScore,
    });

    const diagnoses: string[] = [];
      
    (watchedValues.dxMedicalStructured ?? []).forEach((dx: HandoverStructuredDiagnosis) => {
      if (dx?.display) diagnoses.push(dx.display);
    });
      
    (watchedValues.dxNursingStructured ?? []).forEach((dx: HandoverStructuredDiagnosis) => {
      if (dx?.display) diagnoses.push(dx.display);
    });
      
    const dxMedicalDisplay = watchedValues.dxMedical?.display?.trim() ?? '';
    if (dxMedicalDisplay) diagnoses.push(dxMedicalDisplay);

    const dxNursingText = typeof watchedValues.dxNursing === 'string' ? watchedValues.dxNursing.trim() : '';
    if (dxNursingText) diagnoses.push(dxNursingText);

    const notes =
      truncateNote(watchedValues.evolution) ??
      truncateNote(watchedValues.audioTranscription) ??
      truncateNote(watchedValues.closingSummary);
      
    const devices = oxygen.device ? [oxygen.device] : undefined;

    return {
      language: 'es',
      section,
      unitId: effectivePilotUnitId ?? undefined,
      vitalSigns: Object.keys(vitalSigns).length ? vitalSigns : undefined,
      scores: Object.keys(scores).length ? (scores as ClinicalContext['scores']) : undefined,
      diagnoses: diagnoses.length ? diagnoses : undefined,
      devices,
      notes,
    };
  };

  const requestSuggestions = async (section: 'vitals' | 'diagnosis') => {
    if (!aiSuggestionsEnabled) return;
    setSuggestionsError(null);
    const context = buildClinicalContext(section);
    const contextHash = JSON.stringify(context);
    const now = Date.now();
    const cacheEntry = suggestionsCacheRef.current[section];
    if (cacheEntry && cacheEntry.contextHash === contextHash && now - cacheEntry.timestamp < 15000) {
      setSuggestionsState((prev) => ({ ...prev, [section]: cacheEntry.result }));
      return;
    }
    setSuggestionsLoading(section);
    try {
      const result = await fetchInterventionsSuggestions(context);
      setSuggestionsState((prev) => ({ ...prev, [section]: result }));
      suggestionsCacheRef.current[section] = { timestamp: now, contextHash, result };
    } catch (error: unknown) {
      const netError = normalizeNetError(error);
      const ui = getUserFacingNetworkMessage(netError, { screen: 'HandoverForm', op: 'suggestions' });
      setSuggestionsError(ui.message);
    } finally {
      setSuggestionsLoading(null);
    }
  };

  const profileTraceInput = useMemo(() => buildProfileTraceInput(profileRuntime), [profileRuntime]);
  const buildHandoverInput = useMemo(
    () => (values: HandoverFormValues, overrides: Partial<FhirHandoverValues>): FhirHandoverInput =>
      buildHandoverInputPayload(values, overrides, profileTraceInput),
    [profileTraceInput],
  );
  const buildBundle = useCallback(
    async (handoverInput: FhirHandoverInput, nowIso: string) =>
      buildHandoverBundleAsync(handoverInput, { now: () => nowIso }),
    [],
  );

  const submitHandover = async (values: HandoverFormValues, attempt = 0): Promise<void> => {
    try {
      const status = values.status ?? 'draft';
      const unitFromForm = normalizeUnitSelection(values.administrativeData?.unit, ALL_UNITS_OPTION);
      const unitFromNav = normalizeUnitSelection(unitIdParam ?? route.params?.unitId, ALL_UNITS_OPTION);
      const unitFromStore = normalizeUnitSelection(selectedUnitId, ALL_UNITS_OPTION);
      const unitEffective = unitFromForm ?? unitFromNav ?? unitFromStore ?? undefined;
      const riskBeforeSubmit = deriveRiskEvaluationFromValues(
        values.vitals,
        values.braden,
        values.oxygenTherapy,
      );

      const confirmed = await confirmHighRiskSubmission(status, riskBeforeSubmit, Alert.alert);
      if (!confirmed) {
        return;
      }

      const activeSession = session ?? (await getSession());
      try {
        ensureUnitAccess(activeSession, unitEffective ?? '');
      } catch {
        Alert.alert(t('handover.unitAccessDeniedTitle'));
        return;
      }

      const medications = values.medications ?? [];
      const treatments = values.treatments ?? [];
      const medsText = values.meds;
      const { hasOxygenValues, oxygenTherapy } = buildSubmissionOxygenTherapy(values.oxygenTherapy);
      if (audioUploadToFhir && values.audioUri) {
        setAudioUploadStatus('uploading');
        setAudioUploadError(null);
        const uploadResult = await uploadAudioToFhir({
          uri: values.audioUri,
          patientId: values.patientId,
          unitId: unitEffective ?? '',
          label: t('handover.audioUploadLabel'),
        });
        if (!uploadResult.ok) {
          const errorMessage =
            uploadResult.code === 'UNSUPPORTED_MIME'
              ? t('handover.audioUploadUnsupported')
              : uploadResult.code === 'UNAVAILABLE'
                ? t('handover.audioUploadUnavailable')
                : t('handover.audioUploadFailed');
          setAudioUploadStatus('error');
          setAudioUploadError(errorMessage);
        } else {
          setAudioUploadStatus('done');
        }
      }

      const audioAttachment = await buildAudioAttachment(values.audioUri);

      const administrativeData: AdministrativeData = buildSubmissionAdministrativeData(values, unitEffective);

      const nowIso = new Date().toISOString();
      const handoverInput = buildHandoverInput(values, {
        status,
        author: signatureUser?.userId
          ? { id: signatureUser.userId, display: signatureUser.fullName ?? signatureUser.displayName }
          : session?.user?.id
            ? { id: session.user.id, display: session.user.name }
            : undefined,
        vitals: values.vitals,
        medications,
        treatments,
        oxygenTherapy,
        audioAttachment: audioAttachment ?? undefined,
        composition: { title: 'Clinical handover summary', status: status === 'final' ? 'final' : 'amended' },
        administrativeData,
        closingSummary: values.closingSummary,
        meds: medsText,
        sbar: {
          situation: values.sbarSituation,
          background: values.sbarBackground,
          assessment: values.sbarAssessment,
          recommendation: values.sbarRecommendation,
        },
        painAssessment: values.painAssessment,
        signatures: values.signatures,
        attachments: values.attachments ?? [],
      });

      const bundle = await buildBundle(handoverInput, nowIso);
      const localValidation = validateBundle(bundle);
      if (!localValidation.isValid) {
        Alert.alert(
          t('handover.fhirValidationTitle'),
          t('handover.fhirValidationMessage'),
        );
        return;
      }

      let netState: Awaited<ReturnType<typeof NetInfo.fetch>> | null = null;
      try {
        netState = await NetInfo.fetch();
      } catch {
        netState = null;
      }
      const hasNetworkAtSubmit = netState ? hasNetwork(netState) : null;

      if (isFastValidateEnabled()) {
        if (hasNetworkAtSubmit) {
          const freshToken = await ensureFreshAccessToken();
          const validation = await fastValidateBundleRemotely(bundle, {
            token: freshToken ?? activeSession?.accessToken ?? null,
          });
          if (!validation.ok) {
            const issueDetails = getValidationErrorDetails(validation.issues);
            const buttons: AlertButton[] = [];
            if (issueDetails) {
              buttons.push({
                text: t('sync.viewDetails'),
                onPress: () => Alert.alert(t('sync.errorDetailsTitle'), issueDetails),
              });
            }
            buttons.push({ text: t('common.close'), style: 'cancel' });
            Alert.alert(
              t('handover.fhirValidationTitle'),
              validation.message ?? t('handover.fhirValidationServerRejectedMessage'),
              buttons,
            );
            return;
          }
        }
      }

      const activeSessionUser = getSessionUser(activeSession);
      const signerId = activeSessionUser?.userId ?? activeSessionUser?.id ?? activeSession?.userId;

      const queuedTx = await enqueueBundle(bundle, {
        patientId: values.patientId,
        unitId: administrativeData.unit,
        specialtyId,
        unitProfileId: profileRuntime.context.unitProfileId ?? undefined,
        specialtyOverlayIds: profileRuntime.context.specialtyOverlayIds,
        activeProfileIds: profileRuntime.context.activeProfileIds,
        hasHumanSpecialtyOverride: profileRuntime.context.hasHumanSpecialtyOverride,
        signerId,
      });
      const timingRequestId = typeof queuedTx?.id === 'string' ? queuedTx.id : '';
      await flushHandoverTimingBestEffort({
        enabled: Boolean(features.showHandoverTimingMetrics) && Boolean(timingRequestId),
        flush: handoverTiming.flush,
        unitId: administrativeData.unit,
        requestId: timingRequestId,
      });

      setHandoverSyncStatus('queued');
      setHandoverSyncError(null);
      setTrackedQueueId(typeof queuedTx?.id === 'string' ? queuedTx.id : null);

      const auditUserId = activeSessionUser?.userId ?? activeSessionUser?.id ?? activeSession?.userId;
      const auditUnitId =
        activeSessionUser?.activeUnitId ??
        activeSessionUser?.units?.[0] ??
        activeSession?.units?.[0] ??
        administrativeData.unit;
      if (auditUserId && values.patientId) {
        const shiftCode = deriveShiftCode(values.administrativeData?.shiftStart);
        const auditEvent = makeAuditEvent({
          type: 'patient_edit',
          patientId: values.patientId,
          userId: auditUserId,
          unitId: auditUnitId ?? undefined,
          shiftCode,
        });
        await queueAndFlushAuditEvent(auditStorageRef.current, auditEvent);
      }

      let successMessage =
        hasNetworkAtSubmit === false
          ? t('handover.submitQueuedOfflineMessage')
          : t('handover.submitQueuedMessage');
      if (isOn('ENABLE_ALERTS')) {
        const alerts: string[] = [];
        const vitals = values.vitals ?? {};
        const newsInput = {
          rr: vitals.rr,
          spo2: vitals.spo2,
          temp: vitals.tempC,
          sbp: vitals.sbp,
          hr: vitals.hr,
          o2: hasOxygenValues,
          avpu: vitals.avpu,
        };
        const breakdown = computeNEWS2(newsInput);
        if (breakdown.total >= 5 || breakdown.anyThree) {
          alerts.push(t('handover.news2AlertLine', { total: breakdown.total, band: breakdown.band }));
        }
        if (typeof vitals.spo2 === 'number' && vitals.spo2 < 90) {
          alerts.push(t('handover.spo2LowAlertLine'));
        }
        if (alerts.length > 0) {
          successMessage = `${successMessage}\n\n${t('handover.alertsSectionTitle')}:\n- ${alerts.join('\n- ')}`;
        }
      }

      Alert.alert(t('common.ok'), successMessage, [
        { text: t('common.close'), style: 'cancel' },
        {
          text: t('common.viewQueue'),
          onPress: () => navigation.navigate('SyncCenter'),
        },
      ]);
    } catch (error: unknown) {
      const netError = normalizeNetError(error);
      const ui = getUserFacingNetworkMessage(netError, { screen: 'HandoverForm', op: 'submit' });
      const buttons: AlertButton[] = [];

      const handleRetry = () => {
        if (attempt >= 1) return;
        submitHandover(values, attempt + 1);
      };

      switch (ui.cta?.action) {
        case 'RETRY':
          buttons.push({ text: t('common.cancel'), style: 'cancel' });
          buttons.push({ text: ui.cta.label, onPress: handleRetry });
          break;
        case 'LOGIN':
          buttons.push({ text: t('common.cancel'), style: 'cancel' });
          buttons.push({
            text: ui.cta.label,
            onPress: async () => {
              try {
                await logout();
              } catch {
                /* ignore logout errors */
              }
              navigation.navigate('Login');
            },
          });
          break;
        case 'OPEN_SYNC':
          buttons.push({ text: t('common.close'), style: 'cancel' });
          buttons.push({
            text: ui.cta.label,
            onPress: () => navigation.navigate('SyncCenter'),
          });
          break;
        case 'DISMISS':
          buttons.push({ text: ui.cta.label, style: 'cancel' });
          break;
        default:
          buttons.push({ text: ui.cta?.label ?? t('common.understood'), style: 'cancel' });
          break;
      }

      Alert.alert(ui.title, ui.message, buttons);
    }
  };

  const onSubmit = form.handleSubmit(
    (values) => {
      // Tri-estado real: si el usuario NO tocó el switch, no registramos "false"
      const visitsTouched = Boolean(form.formState.dirtyFields?.psychosocial?.familyVisits);

      // Copia mínima para no mutar el objeto del form
      const normalized: HandoverFormValues = {
        ...values,
        psychosocial: values.psychosocial ? { ...values.psychosocial } : undefined,
      };

      // Si no fue tocado, dejamos familyVisits como undefined (no registrado)
      if (!visitsTouched && normalized.psychosocial) {
        delete normalized.psychosocial.familyVisits;
      }

      return submitHandover(normalized);
    },
    handleInvalidSubmit,
  );

  const handleValidateForExport = async () => {
    const isValid = await form.trigger();
    if (!isValid) {
      Alert.alert(t('handover.formReviewTitle'), t('handover.formReviewPdfMessage'));
    }
    return isValid;
  };

  const handleConfirmedClosure = () => {
    onSubmit();
  };

  const confirmClosureAttestation = async () => {
    const confirmed = await confirmAction({
      title: t('handover.legalConfirmTitle'),
      message: t('handover.legalConfirmMessage'),
      confirmText: t('handover.legalConfirmAction'),
      cancelText: t('common.cancel'),
    });
    if (confirmed) handleConfirmedClosure();
  };

  const finalizeSubmission = async () => {
    form.setValue('status', 'final', { shouldDirty: true, shouldValidate: true });
    const attestationAlert = getFinalizationAttestationAlert();
    if (attestationAlert) {
      Alert.alert(attestationAlert.title, attestationAlert.message);
      return;
    }
    await confirmClosureAttestation();
  };

  const handleSaveDraft = () => {
    form.setValue('status', 'draft', { shouldDirty: true, shouldValidate: true });
    onSubmit();
  };

  const handleFinalize = async (skipChecklist = false) => {
    const checklist = form.getValues('bedsideChecklist');
    if (!skipChecklist && !isBedsideChecklistComplete(checklist, checklistItems)) {
      setBedsideChecklistHighlightMissing(true);
      setBedsideModalVisible(true);
      return;
    }
    await finalizeSubmission();
  };

  const handleSectionLayout = (key: SectionKey) => (event: LayoutChangeEvent) => {
    const y = event.nativeEvent.layout.y;
    setSectionPositions((prev) => ({ ...prev, [key]: y }));
  };

  const toggleSection = (key: SectionKey) => {
    setCollapsedSections((prev) => {
      const nextCollapsed = !prev[key];
      const timedSection = TIMED_SECTIONS_BY_KEY[key];
      if (timedSection) {
        handoverTiming.syncSectionState(timedSection, !nextCollapsed);
      }
      return { ...prev, [key]: nextCollapsed };
    });
  };

  const handleIndexSelect = (key: string) => {
    const sectionKey = key as SectionKey;
    setCollapsedSections((prev) => {
      if (!prev[sectionKey]) return prev;
      const timedSection = TIMED_SECTIONS_BY_KEY[sectionKey];
      if (timedSection) {
        handoverTiming.syncSectionState(timedSection, true);
      }
      return { ...prev, [sectionKey]: false };
    });
    const y = sectionPositions[sectionKey];
    if (typeof y !== 'number') return;

    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y, animated: true });
    });
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const yOffset = event.nativeEvent.contentOffset.y;
    const current = findActiveSection(yOffset, sectionPositions, visibleSections);
    setActiveSection(current);
  };

  const contentContainerStyle = useMemo(
    () => [styles.container, { padding: spacing.lg }, isTablet && styles.containerWithSidebar],
    [isTablet, spacing.lg],
  );
  const tokenInputStyle: TextStyle = {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    color: colors.text,
  };
  const tokenErrorTextStyle: TextStyle = {
    color: colors.danger,
    fontSize: fontSizes.sm,
    fontWeight: '600',
  };

  if (writeAccessDeniedOnRender || unitAccessDeniedOnRender) {
    return (
      <View style={styles.screen}>
        <View style={[styles.container, { padding: spacing.lg }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('handover.unitAccessDeniedTitle')}</Text>
        </View>
      </View>
    );
  }

  return (
    <FormProvider {...form}>
      <View style={styles.screen}>
        <SidebarIndex
          sectionsInfo={visibleSections}
          sectionPositions={sectionPositions}
          scrollRef={scrollRef}
          activeSection={activeSection}
          isTablet={isTablet}
          onSelect={handleIndexSelect}
        />
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={contentContainerStyle}
          onScroll={handleScroll}
          scrollEventThrottle={16}
        >
          <HandoverOverview
            styles={styles}
            colors={{
              text: colors.text,
              primary: colors.primary,
              danger: colors.danger,
              success: colors.success,
              warning: colors.warning,
              info: colors.info,
            }}
            handoverSyncStatus={handoverSyncStatus}
            handoverSyncError={handoverSyncError}
            syncSnapshot={syncSnapshot}
            onRetrySync={() => {
              void retrySync();
            }}
            onOpenLogin={() => navigation.navigate('Login')}
            onOpenSyncCenter={() => navigation.navigate('SyncCenter')}
            profileRuntime={profileRuntime}
            bannerSummary={bannerSummary}
            bannerLoading={bannerLoading}
            patientSummaryError={patientSummaryError}
            demoClinicalSummary={demoClinicalSummary}
          />

          <HandoverContextSections
            styles={styles}
            sectionRefs={{
              turno: sectionRefs.turno,
              paciente: sectionRefs.paciente,
            }}
            collapsedSections={{
              turno: collapsedSections.turno,
              paciente: collapsedSections.paciente,
            }}
            onLayout={handleSectionLayout}
            onToggle={toggleSection}
            onScanPress={onScanPress}
            qrPatientScanEnabled={qrPatientScanEnabled}
            patientIdentificationHint={patientIdentificationHint}
            parseNumericInput={parseNumericInput}
            dictationState={{
              activeDictationField,
              sttStatus,
              dictationUnavailable,
              renderDictationStatus,
              handleDictationPress,
            }}
            DictationMicButton={DictationMicButton}
          />

      {isOn('SHOW_SBAR') && isSectionVisible('sbar') && (
        <View
          ref={sectionRefs.sbar}
          onLayout={handleSectionLayout('sbar')}
          style={styles.section}
        >
          <CollapsibleSection
            title="SBAR"
            isCollapsed={collapsedSections.sbar}
            onToggle={() => toggleSection('sbar')}
          >
            <SbarSection
              styles={styles}
              aiSbarAvailable={aiSbarAvailable}
              isRefiningSbarWithAI={isRefiningSbarWithAI}
              aiSbarGenerationAvailable={aiSbarGenerationAvailable}
              isGeneratingSbarWithAI={isGeneratingSbarWithAI}
              canUseAiSbarAssist={canUseAiSbarAssist}
              handleGenerateSbarWithAi={handleGenerateSbarWithAi}
              handleGenerateSbarSuggestion={handleGenerateSbarSuggestion}
              handleRefineSbarWithAi={handleRefineSbarWithAi}
              pendingSbarSuggestionPreview={pendingSbarSuggestion ? formatSbar(pendingSbarSuggestion.summary, 'es') : null}
              onAcceptPendingSbarSuggestion={applyPendingSbarSuggestion}
              onRejectPendingSbarSuggestion={rejectPendingSbarSuggestion}
              sbarHelperMessage={sbarHelperMessage}
              sbarAiError={sbarAiError}
              sbarAiTraceabilityMessage={canUseAiSbarAssist ? null : t('handover.sbarAiTraceabilityRequired')}
              sbarSituationError={sbarSituationError}
              sbarBackgroundError={sbarBackgroundError}
              sbarAssessmentError={sbarAssessmentError}
              sbarRecommendationError={sbarRecommendationError}
              sbarFullTextError={sbarFullTextError}
              hideLegacyFields={!showLegacySbarNarrative}
              isDemo={isDemoSession}
            />
          </CollapsibleSection>
        </View>
      )}

      {isOn('SHOW_VITALS') && isSectionVisible('signos') && (
        <View
          ref={sectionRefs.signos}
          onLayout={handleSectionLayout('signos')}
          style={styles.section}
        >
          <CollapsibleSection
            title="Signos vitales"
            isCollapsed={collapsedSections.signos}
            onToggle={() => toggleSection('signos')}
            lazy
            sectionKey="vitals"
          >
            <VitalsSection
              styles={styles}
              parseNumericInput={parseNumericInput}
              riskEvaluation={riskEvaluation}
              isDemo={isDemoSession}
              loadingVitalTrends={loadingVitalTrends}
              vitalTrendsError={vitalTrendsError}
              vitalTrends={vitalTrends}
              aiSuggestionsEnabled={aiSuggestionsEnabled}
              suggestionsState={suggestionsState}
              suggestionsLoading={suggestionsLoading}
              suggestionsError={suggestionsError}
              requestSuggestions={requestSuggestions}
            />
          </CollapsibleSection>
        </View>
      )}

      {isOn('SHOW_OXY') && isSectionVisible('oxigenoterapia') && (
        <View
          ref={sectionRefs.oxigenoterapia}
          onLayout={handleSectionLayout('oxigenoterapia')}
          style={styles.section}
        >
          <CollapsibleSection
            title="Oxigenoterapia"
            isCollapsed={collapsedSections.oxigenoterapia}
            onToggle={() => toggleSection('oxigenoterapia')}
          >
            <OxygenGroupSection styles={styles} parseNumericInput={parseNumericInput} />
          </CollapsibleSection>
        </View>
      )}

      <View
        ref={sectionRefs.dispositivos}
        onLayout={handleSectionLayout('dispositivos')}
        style={styles.section}
      >
        <CollapsibleSection
          title="Dispositivos Médicos"
          isCollapsed={collapsedSections.dispositivos}
          onToggle={() => toggleSection('dispositivos')}
        >
          <DevicesSection styles={styles} />
        </CollapsibleSection>
      </View>

      <View
        ref={sectionRefs.seguridad}
        onLayout={handleSectionLayout('seguridad')}
        style={styles.section}
      >
        <CollapsibleSection
          title="Seguridad y riesgos"
          isCollapsed={collapsedSections.seguridad}
          onToggle={() => toggleSection('seguridad')}
        >
          <SafetySection control={control} watch={form.watch} /> 
        </CollapsibleSection>
      </View>

      {isSectionVisible('alertas') && computedAlerts.length > 0 && (
        <View
          ref={sectionRefs.alertas}
          onLayout={handleSectionLayout('alertas')}
          style={styles.section}
        >
          <CollapsibleSection
            title="Alertas"
            isCollapsed={collapsedSections.alertas}
            onToggle={() => toggleSection('alertas')}
          >
            <View style={styles.alertList}>
              {computedAlerts.map((alert) => (
                <View
                  key={alert.id}
                  style={[
                    styles.alertCard,
                    alert.severity === 'critical'
                      ? styles.alertCritical
                      : alert.severity === 'warning'
                        ? styles.alertWarning
                        : styles.alertInfo,
                  ]}
                >
                  <Text style={styles.alertTitle}>
                    {alert.severity === 'critical'
                      ? 'ALERTA CRÍTICA'
                      : alert.severity === 'warning'
                        ? 'Alerta'
                        : 'Información'}
                  </Text>
                  <Text>{alert.message}</Text>
                </View>
              ))}
            </View>
          </CollapsibleSection>
        </View>
      )}

      {isSectionVisible('nutrition') ? (
      <View
        ref={sectionRefs.nutrition}
        onLayout={handleSectionLayout('nutrition')}
        style={styles.section}
      >
        <CollapsibleSection
          title="Nutrición"
          isCollapsed={collapsedSections.nutrition}
          onToggle={() => toggleSection('nutrition')}
        >
          <NutritionSection parseNumber={parseNumericInput} />
        </CollapsibleSection>
      </View>
      ) : null}

      {isSectionVisible('elimination') ? (
      <View
        ref={sectionRefs.elimination}
        onLayout={handleSectionLayout('elimination')}
        style={styles.section}
      >
        <CollapsibleSection
          title="Eliminación"
          isCollapsed={collapsedSections.elimination}
          onToggle={() => toggleSection('elimination')}
        >
          <EliminationSection parseNumber={parseNumericInput} />
        </CollapsibleSection>
      </View>
      ) : null}

      {isSectionVisible('fluidBalance') ? (
      <View
        ref={sectionRefs.fluidBalance}
        onLayout={handleSectionLayout('fluidBalance')}
        style={styles.section}
      >
        <CollapsibleSection
          title="Balance hídrico"
          isCollapsed={collapsedSections.fluidBalance}
          onToggle={() => toggleSection('fluidBalance')}
        >
          <FluidBalanceSection parseNumber={parseNumericInput} />
        </CollapsibleSection>
      </View>
      ) : null}

      {isSectionVisible('mobilitySkin') ? (
      <View
        ref={sectionRefs.mobilitySkin}
        onLayout={handleSectionLayout('mobilitySkin')}
        style={styles.section}
      >
        <CollapsibleSection
          title="Movilidad y piel"
          isCollapsed={collapsedSections.mobilitySkin}
          onToggle={() => toggleSection('mobilitySkin')}
        >
          <MobilitySkinSection />
        </CollapsibleSection>
      </View>
      ) : null}

      {isSectionVisible('psychosocial') ? (
      <View
        ref={sectionRefs.psychosocial}
        onLayout={handleSectionLayout('psychosocial')}
        style={styles.section}
      >
        <CollapsibleSection
          title="Psicosocial"
          isCollapsed={collapsedSections.psychosocial}
          onToggle={() => toggleSection('psychosocial')}
        >
          <PsychosocialSection />
        </CollapsibleSection>
      </View>
      ) : null}

      {/* BEGIN HANDOVER D4 – Conditional sections */}
      {isSectionVisible('escalas') ? (
      <View
        ref={sectionRefs.escalas}
        onLayout={handleSectionLayout('escalas')}
        style={styles.section}
      >
        <CollapsibleSection
          title="Escalas clínicas"
          isCollapsed={collapsedSections.escalas}
          onToggle={() => toggleSection('escalas')}
          lazy
          sectionKey="clinicalScales"
        >
          <ClinicalScalesSection
            suggestedScales={profileRuntime.suggestedScales}
            notes={profileRuntime.notes}
          />
        </CollapsibleSection>
      </View>
      ) : null}
      {/* END HANDOVER D4 – Conditional sections */}

      {isSectionVisible('examenes') ? (
      <View
        ref={sectionRefs.examenes}
        onLayout={handleSectionLayout('examenes')}
        style={styles.section}
      >
        <CollapsibleSection
          title="Pendientes, exámenes y plan"
          isCollapsed={collapsedSections.examenes}
          onToggle={() => toggleSection('examenes')}
        >
          <PendingTasksSection />
          <View style={{ marginTop: 24 }}>
            <ContingencyPlanSection />
          </View>
          <View style={{ marginTop: 24 }}>
            <ExamsProceduresSection />
          </View>
        </CollapsibleSection>
      </View>
      ) : null}

      {isOn('SHOW_MEDS') && isSectionVisible('medicacion') && (
        <View
          ref={sectionRefs.medicacion}
          onLayout={handleSectionLayout('medicacion')}
          style={styles.section}
        >
          <CollapsibleSection
            title="Medicación y tratamientos"
            isCollapsed={collapsedSections.medicacion}
            onToggle={() => toggleSection('medicacion')}
          >
            <MedicationSection control={control} quickPicks={profileRuntime.medicationQuickPicks} />
            <View style={{ marginTop: 24 }}>
              <TreatmentsSection
                control={control}
                enableNicCoding={Boolean(features.showNicCoding)}
                quickPicks={profileRuntime.treatmentQuickPicks}
                clinicalDecisionContext={{ patientId: patientIdValue ?? undefined, unitId: effectivePilotUnitId }}
              />
            </View>
            {showLegacyMedicationText ? (
            <View style={[styles.field, { marginTop: 24 }]}>
              <Text style={styles.label}>Notas adicionales de medicación (texto libre, legado)</Text>
              <View style={styles.dictationRow}>
                <View style={styles.flex}>
                  <Controller
                    control={control}
                    name="meds"
                    render={({ field: { onChange, onBlur, value } }) => (
                      <TextInput
                        style={[styles.input, styles.textArea]}
                        multiline
                        placeholder="Texto libre de medicación (opcional)"
                        onBlur={onBlur}
                        value={value ?? ''}
                        onChangeText={onChange}
                      />
                    )}
                  />
                </View>
                <DictationMicButton
                  active={activeDictationField === 'meds' && sttStatus === 'listening'}
                  label="Dictar medicación"
                  onPress={() =>
                    handleDictationPress('meds', {
                      locale: 'es-ES',
                      interimResults: true,
                      maxSeconds: 90,
                    })
                  }
                />
              </View>
              {renderDictationStatus('meds')}
              {medsError ? <Text style={styles.error}>{medsError}</Text> : null}
            </View>
            ) : null}
          </CollapsibleSection>
        </View>
      )}

      {isOn('SHOW_ATTACH') && isSectionVisible('adjuntos') && (
        <View
          ref={sectionRefs.adjuntos}
          onLayout={handleSectionLayout('adjuntos')}
          style={styles.section}
        >
          <CollapsibleSection
            title="Adjuntos"
            isCollapsed={collapsedSections.adjuntos}
            onToggle={() => toggleSection('adjuntos')}
          >
            <View style={styles.field}>
              <BotonPrimario
                label={t('audioNote.openRecorder')}
                onPress={() => navigation.navigate('AudioNote', { onDoneRoute: 'HandoverForm' })}
                testID="handover-open-audio-note"
              />
              <Text style={styles.helperText}>{t('audioNote.openRecorderHint')}</Text>
            </View>
            <AudioAttach
              onRecorded={(uri) => form.setValue('audioUri', uri, { shouldDirty: true })}
              onAttach={(uri) => form.setValue('audioUri', uri, { shouldDirty: true })}
            />
            <View style={styles.field}>
              <Text style={styles.label}>{t('audioNote.transcriptionLabel')}</Text>
              <Controller
                control={control}
                name="audioTranscription"
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    multiline
                    onBlur={onBlur}
                    value={value ?? ''}
                    onChangeText={onChange}
                    placeholder={t('audioNote.transcriptionPlaceholder')}
                  />
                )}
              />
              <Text style={styles.helperText}>{t('audioNote.transcriptionHelper')}</Text>
            </View>
            <View style={styles.field}>
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>{t('handover.audioUploadToggle')}</Text>
                <Switch value={audioUploadToFhir} onValueChange={setAudioUploadToFhir} />
              </View>
              {audioUploadStatus === 'uploading' ? (
                <Text style={styles.helperText}>{t('handover.audioUploadInProgress')}</Text>
              ) : null}
              {audioUploadError ? <Text style={styles.error}>{audioUploadError}</Text> : null}
            </View>
            <FileAttach />
          </CollapsibleSection>
        </View>
      )}

      <View
        ref={sectionRefs.diagnosticos}
        onLayout={handleSectionLayout('diagnosticos')}
        style={styles.section}
      >
        <CollapsibleSection
          title="Diagnósticos médicos/ enfermería"
          isCollapsed={collapsedSections.diagnosticos}
          onToggle={() => toggleSection('diagnosticos')}
        >
          <View style={styles.field}>
            {/* BEGIN HANDOVER D3 – dxMedicalStructured */}
            <DiagnosisAutocomplete
              name="dxMedicalStructured"
              label="Diagnósticos médicos (estructurados)"
              systemsAllowed={['SNOMED', 'ICD10']}
            />
            {/* END HANDOVER D3 – dxMedicalStructured */}
          </View>
          <View style={styles.field}>
            <View style={styles.dictationRow}>
              <View style={styles.flex}>
                <Controller
                  control={control}
                  name="dxNursing"
                  render={({ field: { onChange, onBlur, value } }) => (
                    <TextInput
                      style={styles.input}
                      placeholder="Diagnóstico de enfermería (texto libre, legado)"
                      onBlur={onBlur}
                      value={value ?? ''}
                      onChangeText={onChange}
                    />
                  )}
                /> 
              </View>
              <DictationMicButton
                active={activeDictationField === 'dxMedical' && sttStatus === 'listening'}
                label="Dictar dx médico"
                onPress={() =>
                  handleDictationPress('dxMedical', {
                    locale: 'es-ES',
                    interimResults: true,
                    maxSeconds: 90,
                  })
                }
              />
            </View>
            {renderDictationStatus('dxMedical')}
            {dxMedicalError ? <Text style={styles.error}>{dxMedicalError}</Text> : null}
          </View>
          {showNicCodingHint ? (
            <View style={styles.field}>
              <Text style={styles.helperText}>Clasificación NIC habilitada para esta unidad.</Text>
            </View>
          ) : null}
          {showHandoverTimingHint ? (
            <View style={styles.field}>
              <Text style={styles.helperText}>Métricas de tiempo de entrega habilitadas para esta unidad.</Text>
            </View>
          ) : null}
          <View style={styles.field}>
            {/* BEGIN HANDOVER D3 – dxNursingStructured */}
            <DiagnosisAutocomplete
              name="dxNursingStructured"
              label="Diagnósticos de enfermería (estructurados)"
              systemsAllowed={['NANDA']}
              enabled={governedNnnEnabled}
              disabledMessage="NNN gobernado desactivado para esta unidad o entorno. Usa el campo legacy mientras se reactiva el catálogo."
            />
            {/* END HANDOVER D3 – dxNursingStructured */}
          </View>
          {showLegacyNursingDiagnosisText ? (
          <View style={styles.field}>
            <View style={styles.dictationRow}>
              <View style={styles.flex}>
                <Controller
                  control={control}
                  name="dxNursing"
                  render={({ field: { onChange, onBlur, value } }) => (
                    <TextInput
                      style={styles.input}
                      placeholder="Diagnóstico de enfermería (texto libre, legado)"
                      onBlur={onBlur}
                      value={value ?? ''}
                      onChangeText={onChange}
                    />
                  )}
                />
              </View>
              <DictationMicButton
                active={activeDictationField === 'dxNursing' && sttStatus === 'listening'}
                label="Dictar dx enfermería"
                onPress={() =>
                  handleDictationPress('dxNursing', {
                    locale: 'es-ES',
                    interimResults: true,
                    maxSeconds: 90,
                  })
                }
              />
            </View>
            {renderDictationStatus('dxNursing')}
            {dxNursingError ? (
              <Text style={[styles.error, tokenErrorTextStyle]}>{dxNursingError}</Text>
            ) : null}
          </View>
          ) : null}
          {aiSuggestionsEnabled ? (
            <View style={styles.inlineActions}>
              <BotonPrimario
                label="Sugerencias IA de cuidados"
                onPress={() => requestSuggestions('diagnosis')}
                disabled={suggestionsLoading === 'diagnosis'}
              />
            </View>
          ) : null}
          {aiSuggestionsEnabled ? (
            <ClinicalSuggestions
              suggestions={suggestionsState.diagnosis}
              isLoading={suggestionsLoading === 'diagnosis'}
              onRefresh={() => requestSuggestions('diagnosis')}
              errorMessage={suggestionsError}
            />
          ) : null}
        </CollapsibleSection>
      </View>

      {isSectionVisible('outcomes') ? (
        <View
          ref={sectionRefs.outcomes}
          onLayout={handleSectionLayout('outcomes')}
          style={styles.section}
        >
          <CollapsibleSection
            title="Resultados esperados (NOC)"
            isCollapsed={collapsedSections.outcomes}
            onToggle={() => toggleSection('outcomes')}
          >
            <OutcomesSection
              control={control}
              enableAiSuggestions={aiSuggestionsEnabled}
              clinicalDecisionContext={{ patientId: patientIdValue ?? undefined, unitId: effectivePilotUnitId }}
            />
          </CollapsibleSection>
        </View>
      ) : null}

      <View
        ref={sectionRefs.evolucion}
        onLayout={handleSectionLayout('evolucion')}
        style={styles.section}
      >
        <CollapsibleSection
          title="Evolución"
          isCollapsed={collapsedSections.evolucion}
          onToggle={() => toggleSection('evolucion')}
        >
          <View style={styles.field}>
            <Text style={styles.label}>Evolución</Text>
            <Pressable
              accessibilityRole="button"
              onPress={handleSpeakNotes}
              style={styles.ttsButton}
            >
              <Text style={styles.ttsButtonText}>🔊 Leer notas del turno</Text>
            </Pressable>
            <View style={styles.dictationRow}>
              <View style={styles.flex}>
                <Controller
                  control={control}
                  name="evolution"
                  render={({ field: { onChange, onBlur, value } }) => (
                    <TextInput
                      accessibilityLabel="Notas de evolución"
                      testID="handover-evolution"
                      style={[styles.input, styles.textArea, tokenInputStyle]}
                      multiline
                      placeholder="Notas de evolución"
                      placeholderTextColor={colors.muted}
                      onBlur={onBlur}
                      value={value ?? ''}
                      onChangeText={onChange}
                    />
                  )}
                />
              </View>
              <DictationMicButton
                active={activeDictationField === 'evolution' && sttStatus === 'listening'}
                label="Dictar evolución"
                onPress={() =>
                  handleDictationPress('evolution', {
                    locale: 'es-ES',
                    interimResults: true,
                    maxSeconds: 90,
                  })
                }
              />
            </View>
            {renderDictationStatus('evolution')}
            {evolutionError ? (
              <Text style={[styles.error, tokenErrorTextStyle]}>{evolutionError}</Text>
            ) : null}
          </View>
        </CollapsibleSection>
      </View>

      <HandoverClosureSections
        styles={styles}
        sectionRefs={{
          resumen: sectionRefs.resumen,
          bedsideChecklist: sectionRefs.bedsideChecklist,
          firmas: sectionRefs.firmas,
        }}
        collapsedSections={{
          resumen: collapsedSections.resumen,
          bedsideChecklist: collapsedSections.bedsideChecklist,
          firmas: collapsedSections.firmas,
        }}
        onLayout={handleSectionLayout}
        onToggle={toggleSection}
        dictationState={{
          activeDictationField,
          sttStatus,
          dictationUnavailable,
          renderDictationStatus,
          handleDictationPress,
        }}
        DictationMicButton={DictationMicButton}
        checklistItems={checklistItems}
        currentUser={signatureUser}
        administrativeUnitId={administrativeUnitValue}
        canSignOutgoing={canSignOutgoing}
        allowedSignatureKind={demoActorKind}
        buildOutgoingSignature={buildOutgoingSignature}
        onAttestationCaptured={(kind, signature) => {
          void recordClosureAttestation(kind, signature);
        }}
        outgoingSignatureError={errors.signatures?.outgoing?.message as string | undefined}
        incomingSignatureError={errors.signatures?.incoming?.message as string | undefined}
        onSaveDraft={handleSaveDraft}
        onFinalize={handleFinalize}
        finalizeDisabled={formState.isSubmitting || hasValidationErrors}
        onBeforeExport={handleValidateForExport}
      />
      </ScrollView>
      </View>

      <BedsideChecklistModal
        visible={bedsideModalVisible}
        highlightMissing={bedsideChecklistHighlightMissing}
        items={checklistItems}
        onCancel={() => {
          setBedsideModalVisible(false);
          setBedsideChecklistHighlightMissing(false);
        }}
        onConfirm={() => {
          setBedsideModalVisible(false);
          setBedsideChecklistHighlightMissing(false);
          void handleFinalize(true);
        }}
      />
    </FormProvider>
  );
}




