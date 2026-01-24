import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
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
import { Controller, FormProvider } from 'react-hook-form';
import type { FieldErrors, UseFormReturn } from 'react-hook-form';
import * as Speech from 'expo-speech';

import { isOn } from '@/src/config/flags';
import AudioAttach from '@/src/components/AudioAttach';
import FileAttach from '@/src/components/FileAttach';
import { hashHex } from '@/src/lib/crypto';
import { buildHandoverBundle, type HandoverInput as FhirHandoverInput } from '@/src/lib/fhir-map';
import { computeAlerts } from '@/src/lib/alerts';
import { computeNEWS2 } from '@/src/lib/news2';
import { refineSBARWithAI } from '@/src/lib/ai-sbar';
import { fetchInterventionsSuggestions, type ClinicalContext, type SuggestionsResult } from '@/src/lib/ai-suggestions';
import { confirmHighRiskSubmission, deriveRiskEvaluationFromValues } from '@/src/lib/scores/handoverRisk';
import useDraftAutosave from '@/src/lib/useDraftAutosave';
import {
  createSttService,
  type SttConfig,
  type SttErrorCode,
  type SttService,
  type SttStatus,
} from '@/src/lib/stt';
import { appendAuditEvent, createAsyncStorageAuditStorage, makeAuditEvent, type AuditStorage } from '@/src/lib/audit';
import { formatSbar, generateSBARSummary, generateSbarSummary } from '@/src/lib/summary';
import { enqueueBundle } from '@/src/lib/queue';
import NetInfo from '@/src/lib/netinfo';
import { fastValidateBundleRemotely, hasNetwork, isFastValidateEnabled } from '@/src/lib/fast-validate';
import { getUserFacingNetworkMessage, normalizeNetError } from '@/src/lib/net-errors';
import { AI_SBAR_ENABLED } from '@/src/config/env';
import type { RootStackParamList } from '@/src/navigation/types';
import { ensureUnitAccess } from '@/src/security/acl';
import { getSession, useAuth, type Session } from '@/src/security/auth';
import type { HandoverUser } from '@/src/security/auth-types';
import { ALL_UNITS_OPTION, useSelectedUnitId } from '@/src/state/filterStore';
import { SHIFT_TYPES, type AdministrativeData } from '@/src/types/administrative';
import type { HandoverStructuredDiagnosis, RiskItem } from '@/src/types/handover';
import type { SBARSummary } from '@/src/types/sbar';
import { usePatientSummary } from '@/src/hooks/usePatientSummary';
import type { PrefillOutput } from '@/src/lib/prefill';
import type { PatientSummary } from '@/src/lib/fhir-client';
import { useZodForm } from '@/src/validation/form-hooks';
import { zHandover, type HandoverValues as BaseHandoverFormValues } from '@/src/validation/schemas';
import type { PsychosocialCare } from '@/src/types/handover';
import BotonPrimario from '../components/BotonPrimario';
import { useThemeTokens } from '../theme';
type HandoverFormValues = BaseHandoverFormValues & {
  psychosocial?: PsychosocialCare;
};

// BEGIN HANDOVER D4 – Form imports
import { getUnitConfig, getDefaultUnitConfig } from '@/src/lib/unitConfig';
// END HANDOVER D4 – Form imports
import DiagnosisAutocomplete from './components/DiagnosisAutocomplete';
import { PatientBanner } from './components/PatientBanner';
// BEGIN HANDOVER D2 – VitalTrends imports
import { useVitalTrends } from '@/src/lib/hooks/useVitalTrends';
import { BedsideChecklistModal } from './components/BedsideChecklistModal';
import { BedsideChecklistSection } from './components/BedsideChecklistSection';
import EliminationSection from './components/EliminationSection';
import FluidBalanceSection from './components/FluidBalanceSection';
import MobilitySkinSection from './components/MobilitySkinSection';
import NutritionSection from './components/NutritionSection';
import PsychosocialSection from './components/PsychosocialSection';
import ClinicalScalesSection from './components/ClinicalScalesSection';
import { SignaturesSection, type SignatureUser } from './components/SignaturesSection';
import MedicationSection from './components/MedicationSection';
import ExamsProceduresSection from './components/ExamsProceduresSection';
import TreatmentsSection from './components/TreatmentsSection';
import SafetySection from './components/SafetySection';
// END HANDOVER D2 – VitalTrends imports
import { CollapsibleSection } from './components/CollapsibleSection';
import { SidebarIndex, type SectionInfo } from './components/SidebarIndex';
import ClinicalSuggestions from '@/src/components/ClinicalSuggestions';
import { AdministrativeSection } from '@/src/components/handover/AdministrativeSection';
import { PatientSection } from '@/src/components/handover/PatientSection';
import { VitalsSection } from '@/src/components/handover/VitalsSection';
import { SummarySection } from '@/src/components/handover/SummarySection';
import OxygenGroupSection from './components/OxygenGroupSection';
import DevicesSection from './components/DevicesSection';
import { isBedsideChecklistComplete } from './components/bedsideChecklist.constants';
import { SbarSection } from './handover/SbarSection';
import { HandoverFormActions } from './handover/HandoverFormActions';

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
});

type HandoverRouteName = "HandoverForm" | "HandoverMain";
type Props = NativeStackScreenProps<RootStackParamList, HandoverRouteName>;
type HandoverFormErrors = FieldErrors<HandoverFormValues>;

const deriveShiftType = (shiftStartValue?: string | null) => {
  if (!shiftStartValue) return SHIFT_TYPES[0];
  const date = new Date(shiftStartValue);
  const hours = date.getHours();
  if (Number.isNaN(hours)) return SHIFT_TYPES[0];
  if (hours >= 6 && hours < 14) return 'Mañana';
  if (hours >= 14 && hours < 22) return 'Tarde';
  return 'Noche';
};

export type DictationField =
  | 'dxMedical'
  | 'dxNursing'
  | 'meds'
  | 'evolution'
  | 'closingSummary'
  | 'incidents';

const sectionsInfo = [
  { key: 'turno', title: 'Datos del turno' },
  { key: 'paciente', title: 'Paciente' },
  { key: 'sbar', title: 'SBAR' },
  { key: 'signos', title: 'Signos vitales' },
  { key: 'oxigenoterapia', title: 'Oxigenoterapia' },
  { key: 'dispositivos', title: 'Dispositivos Médicos' },
  { key: 'seguridad', title: 'Seguridad y riesgos' },
  { key: 'alertas', title: 'Alertas' },
  { key: 'nutrition', title: 'Nutrición' },
  { key: 'elimination', title: 'Eliminación' },
  { key: 'fluidBalance', title: 'Balance hídrico' },
  { key: 'mobilitySkin', title: 'Movilidad y piel' },
  { key: 'psychosocial', title: 'Psicosocial' },
  { key: 'escalas', title: 'Escalas clínicas' },
  { key: 'examenes', title: 'Exámenes y procedimientos' },
  { key: 'medicacion', title: 'Medicación y tratamientos' },
  { key: 'adjuntos', title: 'Adjuntos' },
  { key: 'diagnosticos', title: 'Diagnósticos médicos/ enfermería' },
  { key: 'evolucion', title: 'Evolución' },
  { key: 'resumen', title: 'Resumen / cierre de turno' },
  { key: 'bedsideChecklist', title: 'Bedside Checklist' },
  { key: 'firmas', title: 'Firmas' },
] as const satisfies readonly SectionInfo[];

type SectionKey = (typeof sectionsInfo)[number]['key'];

const mergeDictationText = (currentValue: string | undefined, dictated: string) => {
  const addition = dictated.trim();
  if (!addition) {
    return currentValue ?? '';
  }
  if (!currentValue) {
    return addition;
  }
  const base = currentValue.trimEnd();
  if (!base) {
    return addition;
  }
  return `${base}\n${addition}`;
};

const findActiveSection = (
  offset: number,
  positions: Partial<Record<SectionKey, number>>,
): SectionKey | null => {
  const entries = sectionsInfo
    .map(({ key }) => ({ key, y: positions[key] }))
    .filter((entry): entry is { key: SectionKey; y: number } => typeof entry.y === 'number')
    .sort((a, b) => a.y - b.y);

  if (entries.length === 0) return null;

  let current: SectionKey = entries[0].key;
  for (const entry of entries) {
    if (offset >= entry.y - 24) {
      current = entry.key;
    } else {
      break;
    }
  }

  return current;
};

function deriveInitialRisksStructured(values: HandoverFormValues): RiskItem[] {
  if (Array.isArray(values.risksStructured) && values.risksStructured.length > 0) {
    return values.risksStructured.map((item) => ({
      ...item,
      actions: item.actions ?? [],
      notes: typeof item.notes === 'string' ? item.notes : undefined,
    }));
  }

  const items: RiskItem[] = [];
  if (values.risks?.fall) {
    items.push({ type: 'fall', present: true, notes: undefined, actions: [] });
  }
  if (values.risks?.pressureUlcer) {
    items.push({ type: 'pressureUlcer', present: true, notes: undefined, actions: [] });
  }
  if (values.risks?.isolation) {
    items.push({ type: 'isolation', present: true, notes: undefined, actions: [] });
  }

  return items;
}

function asStringArray(value: unknown[] | undefined): string[] | undefined {
  if (!value) return undefined;
  const normalized = value.filter((item): item is string => typeof item === 'string');
  return normalized.length ? normalized : undefined;
}

function getSessionUser(session?: (Session & { user?: HandoverUser | null }) | null): HandoverUser | null {
  if (!session) return null;
  if (session.user) return session.user;
  return {
    id: session.userId,
    userId: session.userId,
    displayName: session.displayName,
    fullName: session.displayName,
    name: session.displayName,
    roles: session.roles,
    units: session.units,
  };
}

function normalizeSignatureUser(session?: (Session & { user?: HandoverUser | null }) | null): SignatureUser | null {
  const base = getSessionUser(session);
  if (!base) return null;

  const roles = asStringArray(base.roles) ?? (base.role ? [base.role] : undefined);
  const units = asStringArray(base.units);

  return {
    id: base.id ?? base.userId ?? session?.userId,
    userId: base.userId ?? base.id ?? session?.userId,
    name: base.name ?? base.displayName ?? base.fullName ?? session?.displayName,
    fullName: base.fullName ?? base.name ?? base.displayName ?? session?.displayName,
    displayName: base.displayName ?? base.name ?? base.fullName ?? session?.displayName,
    role: base.role ?? roles?.[0],
    roles,
    units,
    activeUnitId: base.activeUnitId ?? units?.[0],
  };
}

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
    patientId: patientIdParam,
    unitId: unitIdParam,
    specialtyId,
    administrativeData: administrativeDataParam,
    prefilledValues: prefilledValuesParam,
    patientSummary: patientSummaryParam,
    prefillMeta,
  } = route.params ?? {};
  const [session, setSession] = useState<Session | null>(null);
  const { session: authSession, logout } = useAuth();
  const selectedUnitId = useSelectedUnitId();
  const auditStorageRef = useRef<AuditStorage>(createAsyncStorageAuditStorage());
  const auditedPatientsRef = useRef<Set<string>>(new Set());
  const scrollRef = useRef<ScrollView>(null);
  const { colors, fontSizes, spacing, radius } = useThemeTokens();
  const { width } = useWindowDimensions();
  const isTablet = width >= 900;
  const sectionRefs = useMemo(
    () =>
      sectionsInfo.reduce(
        (acc, { key }) => {
          acc[key] = React.createRef<View>();
          return acc;
        },
        {} as Record<SectionKey, React.RefObject<View | null>>,
      ),
    [],
  );
  const [sectionPositions, setSectionPositions] = useState<Partial<Record<SectionKey, number>>>({});
  const [collapsedSections, setCollapsedSections] = useState<Record<SectionKey, boolean>>(() =>
    sectionsInfo.reduce((acc, { key }) => ({ ...acc, [key]: false }), {} as Record<SectionKey, boolean>),
  );
  const [activeSection, setActiveSection] = useState<SectionKey | null>(sectionsInfo[0]?.key ?? null);
  const [bedsideModalVisible, setBedsideModalVisible] = useState(false);
  const [bedsideChecklistHighlightMissing, setBedsideChecklistHighlightMissing] = useState(false);

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

  const defaultValues = useMemo<HandoverFormValues>(() => {
    const shiftStartDefault = administrativeDataParam?.shiftStart ?? new Date().toISOString();
    const shiftEndDefault =
      administrativeDataParam?.shiftEnd ?? new Date(Date.now() + 4 * 3600 * 1000).toISOString();
    const administrativeDefaults: AdministrativeData = {
      unit:
        administrativeDataParam?.unit ??
        unitIdParam ??
        selectedUnitId ??
        prefillMeta?.unit ??
        prefilledValuesParam?.location ??
        '',
      census: administrativeDataParam?.census ?? 0,
      staffIn: administrativeDataParam?.staffIn ?? [],
      staffOut: administrativeDataParam?.staffOut ?? [],
      shiftStart: shiftStartDefault,
      shiftEnd: shiftEndDefault,
      shiftType:
        administrativeDataParam?.shiftType ??
        deriveShiftType(shiftStartDefault),
      generalNotes: administrativeDataParam?.generalNotes ?? undefined,
      incidents: administrativeDataParam?.incidents ?? [],
    };

    const base: HandoverFormValues = {
      administrativeData: administrativeDefaults,
      patientId: patientIdParam ?? patientSummaryParam?.id ?? '',
      status: 'draft',
      dxMedical: prefilledValuesParam?.dxText ?? '',
      dxNursing: '',
      dxMedicalStructured: [],
      dxNursingStructured: [],
      evolution: '',
      closingSummary: '',
      meds: '',
      medications: [],
      treatments: [],
      exams: [],
      procedures: [],
      sbarSituation: '',
      sbarBackground: '',
      sbarAssessment: '',
      sbarRecommendation: '',
      vitals: prefilledVitals ?? {},
      oxygenTherapy: {},
      devices: [],
      fluidBalance: undefined,
      painAssessment: {
        hasPain: false,
        evaScore: null,
        location: null,
        actionsTaken: null,
      },
      // BEGIN HANDOVER D1 – BedsideChecklist
      bedsideChecklist: {
        patientIdentityConfirmed: false,
        allergiesReviewed: false,
        linesAndDevicesChecked: false,
        medicationPlanReviewed: false,
        safetyMeasuresApplied: false,
        questionsAnswered: false,
        bedsideNotes: '',
      },
      // END HANDOVER D1 – BedsideChecklist
      risks: {},
      risksStructured: [],
      signatures: {
        outgoing: undefined,
        incoming: undefined,
      },
      attachments: [],
    };
    return { ...base, risksStructured: deriveInitialRisksStructured(base) };
  }, [
    patientIdParam,
    patientSummaryParam,
    unitIdParam,
    administrativeDataParam,
    selectedUnitId,
    prefilledValuesParam,
    prefilledVitals,
    prefillMeta,
  ]);

 const form = useZodForm(zHandover, defaultValues) as unknown as UseFormReturn<HandoverFormValues>;

  const { control, formState } = form;
  const patientIdValue = form.watch('patientId');
  const errors: HandoverFormErrors = formState.errors ?? {};
  const hasValidationErrors = Object.keys(errors).length > 0;
  const medsError = errors.meds?.message as string | undefined;
  const dxMedicalError = errors.dxMedical?.message as string | undefined;
  const dxNursingError = errors.dxNursing?.message as string | undefined;
  const evolutionError = errors.evolution?.message as string | undefined;
  const signatureUser = useMemo(() => normalizeSignatureUser(authSession ?? session), [authSession, session]);
  const administrativeUnitValue = form.watch('administrativeData.unit');
  // BEGIN HANDOVER D4 – Get active unit
  const adminUnitId = administrativeUnitValue || '';
  const unitConfig = getUnitConfig(adminUnitId) ?? getDefaultUnitConfig();
  const features = unitConfig.features ?? {};
  // END HANDOVER D4 – Get active unit
  const signaturesValue = form.watch('signatures');
  const outgoingSignature = signaturesValue?.outgoing;
  const signatureErrors = errors.signatures ?? {};
  const outgoingSignatureError = signatureErrors.outgoing?.message as string | undefined;
  const incomingSignatureError = signatureErrors.incoming?.message as string | undefined;
  const [watchedVitals, watchedBraden, watchedOxygen] = form.watch([
    'vitals',
    'braden',
    'oxygenTherapy',
  ]);
  const watchedValues = form.watch();

  const { loadNow: loadDraftNow, scheduleSave } = useDraftAutosave<HandoverFormValues>({
    patientId: patientIdValue,
    enabled: true,
    delay: 800,
    getSnapshot: () => form.getValues(),
    onLoad: (data) => {
      if (!data) return;
      form.reset({ ...form.getValues(), ...data });
    },
  });

  useEffect(() => {
    void loadDraftNow();
  }, [loadDraftNow, patientIdValue]);

  useEffect(() => {
    const subscription = form.watch(() => scheduleSave());
    return () => (typeof subscription === 'function' ? subscription() : subscription?.unsubscribe?.());
  }, [form, scheduleSave]);
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
  const aiSuggestionsEnabled = isOn('AI_SUGGESTIONS_ENABLED');
  const dictationAdapters = useMemo(
    () => ({
      dxMedical: {
        get: () => form.getValues('dxMedical') ?? '',
        set: (text: string) => form.setValue('dxMedical', text, { shouldDirty: true, shouldValidate: true }),
      },
      dxNursing: {
        get: () => form.getValues('dxNursing') ?? '',
        set: (text: string) => form.setValue('dxNursing', text, { shouldDirty: true, shouldValidate: true }),
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
  const [sbarPreview, setSbarPreview] = useState<string | null>(null);
  const [isRefiningSbarWithAI, setIsRefiningSbarWithAI] = useState(false);
  const [sbarAiError, setSbarAiError] = useState<string | null>(null);
  const [sbarHelperMessage, setSbarHelperMessage] = useState<string | null>(null);
  const aiSbarAvailable = AI_SBAR_ENABLED;

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
      return (
        <Text style={styles.dictationError}>
          La transcripción por voz no está disponible en este dispositivo.
        </Text>
      );
    }
    if (activeDictationField === field && sttStatus === 'listening') {
      return (
        <Text style={styles.dictationStatus}>
          Escuchando… {dictatedPartial ? `“${dictatedPartial}”` : ''}
        </Text>
      );
    }
    if (activeDictationField === field && sttStatus === 'processing') {
      return <Text style={styles.dictationStatus}>Procesando dictado…</Text>;
    }
    if (lastDictationField === field && sttError && !dictationUnavailable) {
      const message =
        sttError === 'PERMISSION_DENIED'
          ? 'Activa los permisos de micrófono para dictar las notas.'
          : 'No pudimos transcribir en este momento. Puedes escribir manualmente y volver a intentar.';
      return <Text style={styles.dictationError}>{message}</Text>;
    }
    return null;
  };
  const sbarSituationError = errors.sbarSituation?.message as string | undefined;
  const sbarBackgroundError = errors.sbarBackground?.message as string | undefined;
  const sbarAssessmentError = errors.sbarAssessment?.message as string | undefined;
  const sbarRecommendationError = errors.sbarRecommendation?.message as string | undefined;

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

  const handleShiftDetailsPress = () => {
    navigation.navigate('ShiftDetails', {
      returnTo: 'HandoverForm',
      administrativeData: form.getValues('administrativeData'),
    });
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

  const handleRefineSbarWithAi = async () => {
    const values = form.getValues();

    setIsRefiningSbarWithAI(true);
    setSbarAiError(null);
    setSbarHelperMessage(null);

    try {
      const draft = buildDraftSbar(values);
      const refined = await refineSBARWithAI(values, draft);

      if (refined) {
        form.setValue('sbarSituation', refined.situation, { shouldDirty: true, shouldValidate: true });
        form.setValue('sbarBackground', refined.background, { shouldDirty: true, shouldValidate: true });
        form.setValue('sbarAssessment', refined.assessment, { shouldDirty: true, shouldValidate: true });
        form.setValue('sbarRecommendation', refined.recommendation, { shouldDirty: true, shouldValidate: true });
        setSbarHelperMessage('SBAR refinada por IA. Revise y ajuste según criterio clínico.');
      } else {
        setSbarAiError('No se pudo contactar con la IA. Se mantiene el resumen generado por reglas.');
      }
    } catch {
      setSbarAiError('No se pudo contactar con la IA. Se mantiene el resumen generado por reglas.');
    } finally {
      setIsRefiningSbarWithAI(false);
    }
  };

  const handleGenerateSbarSuggestion = () => {
    try {
      const values = form.getValues();
      const summary = generateSBARSummary(values, { maxCharsPerSection: 320 });
      form.setValue('sbarSituation', summary.situation, { shouldDirty: true, shouldValidate: true });
      form.setValue('sbarBackground', summary.background, { shouldDirty: true, shouldValidate: true });
      form.setValue('sbarAssessment', summary.assessment, { shouldDirty: true, shouldValidate: true });
      form.setValue('sbarRecommendation', summary.recommendation, { shouldDirty: true, shouldValidate: true });
      setSbarHelperMessage(
        'SBAR generada automáticamente a partir del formulario. Revise y ajuste según criterio clínico.',
      );
      setSbarAiError(null);
    } catch {
      Alert.alert(
        'No se pudo generar la SBAR automática',
        'Revise los datos o complete la SBAR de forma manual.',
      );
    }
  };

  const handleGenerateSbar = async () => {
    const isValid = await form.trigger();
    if (!isValid) {
      Alert.alert('Revisa el formulario', 'Completa los campos obligatorios para generar el SBAR.');
      return;
    }
    const values = form.getValues();
    const summary = generateSbarSummary(values, { locale: 'es', maxCharsPerSection: 280 });
    const sbarText = formatSbar(summary, 'es');
    setSbarPreview(sbarText);
  };

  const applySbarToClosingSummary = (text: string) => {
    form.setValue('closingSummary', text, { shouldDirty: true, shouldValidate: true });
    setSbarPreview(text);
  };

  const handleInsertSbar = () => {
    if (!sbarPreview) return;
    const current = form.getValues('closingSummary') ?? '';
    if (current.trim()) {
      Alert.alert(
        'Reemplazar resumen',
        'Ya existe un resumen escrito. ¿Quieres reemplazarlo por el SBAR sugerido?',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Reemplazar', style: 'destructive', onPress: () => applySbarToClosingSummary(sbarPreview) },
        ],
        { cancelable: true },
      );
      return;
    }
    applySbarToClosingSummary(sbarPreview);
  };

  const handleCloseSbarPreview = () => setSbarPreview(null);

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
  // END HANDOVER D6 – HandoverForm PatientBanner

  // BEGIN HANDOVER D2 – VitalTrends hook usage
  const shouldLoadVitalTrends = isOn('SHOW_VITALS') && !collapsedSections.signos;
  const {
    loading: loadingVitalTrends,
    error: vitalTrendsError,
    data: vitalTrends,
  } = useVitalTrends(shouldLoadVitalTrends ? trimmedPatientId : undefined);
  // END HANDOVER D2 – VitalTrends hook usage

  const deriveShiftCode = (shiftStartValue?: string | null) => {
    if (!shiftStartValue) return undefined;
    const date = new Date(shiftStartValue);
    const hours = date.getHours();
    if (Number.isNaN(hours)) return undefined;
    if (hours >= 6 && hours < 14) return 'MORNING';
    if (hours >= 14 && hours < 22) return 'AFTERNOON';
    return 'NIGHT';
  };

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
      await appendAuditEvent(auditStorageRef.current, event);
      auditedPatientsRef.current.add(targetPatientId);
    })();
  }, [form, patientIdValue, session]);

  const onScanPress = () => {
    const routeNames = (navigation as { getState?: () => { routeNames?: string[] } }).getState?.()
      ?.routeNames ?? [];
    if (routeNames.includes('QRScan')) {
      const trimmedPatientId =
        typeof patientIdValue === 'string' && patientIdValue.trim()
          ? patientIdValue.trim()
          : undefined;
      (navigation as any).navigate('QRScan', {
        returnTo: 'HandoverForm',
        patientIdParam: trimmedPatientId,
      });
    } else {
      Alert.alert('Escáner no disponible', 'Esta build no incluye la pantalla de QR (opcional para demo).');
    }
  };

  const handleInvalidSubmit = (formErrors: HandoverFormErrors) => {
    const currentStatus = form.getValues('status');
    const hasOutgoing = form.getValues('signatures')?.outgoing;
    if (currentStatus === 'final' && !hasOutgoing) {
      Alert.alert('Falta firma', 'Para finalizar la entrega falta la firma de enfermera saliente.');
      return;
    }
    const message =
      typeof formErrors?.root?.message === 'string' ? formErrors.root.message : 'No se pudo guardar';
    Alert.alert('Error', message);
  };

  const truncateNote = (value?: string | null, maxLength = 400) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed.slice(0, maxLength);
  };

  const compactObject = (input: Record<string, any>) =>
    Object.fromEntries(
      Object.entries(input).filter(([, value]) => value !== undefined && value !== null),
    );

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

    const scores = compactObject({
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
    if (watchedValues.dxMedical) {
      diagnoses.push(watchedValues.dxMedical);
    }
    if (watchedValues.dxNursing) {
      diagnoses.push(watchedValues.dxNursing);
    }

    const notes = truncateNote(watchedValues.evolution) ?? truncateNote(watchedValues.closingSummary);
    const devices = oxygen.device ? [oxygen.device] : undefined;

    const context: ClinicalContext = {
      language: 'es',
      section,
      vitalSigns: Object.keys(vitalSigns).length ? vitalSigns : undefined,
      scores: Object.keys(scores).length ? scores : undefined,
      diagnoses: diagnoses.length ? diagnoses : undefined,
      devices,
      notes,
    };

    return context;
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

  const submitHandover = async (values: HandoverFormValues, attempt = 0): Promise<void> => {
    try {
      const normalizeUnit = (value?: string | null) => {
        if (typeof value !== 'string') return undefined;
        const trimmed = value.trim();
        if (!trimmed || trimmed === ALL_UNITS_OPTION) return undefined;
        return trimmed;
      };

      const status = values.status ?? 'draft';
      const unitFromForm = normalizeUnit(values.administrativeData?.unit);
      const unitFromNav = normalizeUnit(unitIdParam ?? route.params?.unitId);
      const unitFromStore = normalizeUnit(selectedUnitId);
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
        Alert.alert('Sin acceso a la unidad');
        return;
      }

      const medications = values.medications ?? [];
      const treatments = values.treatments ?? [];
      const medsText = values.meds;
      const oxygenTherapyInput = values.oxygenTherapy ?? {};
      const hasOxygenValues = Boolean(
        oxygenTherapyInput.device ||
        oxygenTherapyInput.flowLMin != null ||
        oxygenTherapyInput.fio2 != null
      );

      const oxygenTherapy = hasOxygenValues
        ? {
            status: 'in-progress' as const,
            device: oxygenTherapyInput.device,
            deviceDisplay: oxygenTherapyInput.device,
            flowLMin: oxygenTherapyInput.flowLMin,
            fio2: oxygenTherapyInput.fio2,
          }
        : null;

      const audioAttachment = await buildAudioAttachment(values.audioUri);

      const administrativeData: AdministrativeData = {
        unit: unitEffective ?? values.administrativeData.unit,
        census: values.administrativeData.census ?? 0,
        staffIn: (values.administrativeData.staffIn ?? []).filter(Boolean),
        staffOut: (values.administrativeData.staffOut ?? []).filter(Boolean),
        shiftStart: values.administrativeData.shiftStart,
        shiftEnd: values.administrativeData.shiftEnd,
        shiftType: values.administrativeData.shiftType,
        generalNotes: values.administrativeData.generalNotes,
        incidents: values.administrativeData.incidents?.filter(Boolean),
      };

      const nowIso = new Date().toISOString();
      const handoverInput: FhirHandoverInput = {
        ...values,
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
      };

      const bundle = buildHandoverBundle(handoverInput, { now: () => nowIso });

      if (isFastValidateEnabled()) {
        const netState = await NetInfo.fetch();
        if (hasNetwork(netState)) {
          const validation = await fastValidateBundleRemotely(bundle, {
            token: activeSession?.accessToken ?? null,
          });
          if (!validation.ok) {
            Alert.alert('Error de validación FHIR', validation.message ?? 'El servidor rechazó el Bundle.');
            return;
          }
        }
      }

      const activeSessionUser = getSessionUser(activeSession);
      const signerId = activeSessionUser?.userId ?? activeSessionUser?.id ?? activeSession?.userId;

      await enqueueBundle(bundle, {
        patientId: values.patientId,
        unitId: administrativeData.unit,
        specialtyId,
        signerId,
      });

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
        await appendAuditEvent(auditStorageRef.current, auditEvent);
      }

      let successMessage = 'Entrega encolada para envío.';
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
          alerts.push(`NEWS2 ${breakdown.total} (${breakdown.band})`);
        }
        if (typeof vitals.spo2 === 'number' && vitals.spo2 < 90) {
          alerts.push('SpO₂ menor a 90%');
        }
        if (alerts.length > 0) {
          successMessage = `${successMessage}\n\nAlertas:\n- ${alerts.join('\n- ')}`;
        }
      }

      Alert.alert('OK', successMessage);
      navigation.goBack();
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
          buttons.push({ text: 'Cancelar', style: 'cancel' });
          buttons.push({ text: ui.cta.label, onPress: handleRetry });
          break;
        case 'LOGIN':
          buttons.push({ text: 'Cancelar', style: 'cancel' });
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
          buttons.push({ text: 'Cerrar', style: 'cancel' });
          buttons.push({
            text: ui.cta.label,
            onPress: () => navigation.navigate('SyncCenter'),
          });
          break;
        case 'DISMISS':
          buttons.push({ text: ui.cta.label, style: 'cancel' });
          break;
        default:
          buttons.push({ text: ui.cta?.label ?? 'Entendido', style: 'cancel' });
          break;
      }

      Alert.alert(ui.title, ui.message, buttons);
    }
  };

  const onSubmit = form.handleSubmit(
  (values) => {
    // Tri-estado real: si el usuario NO tocó el switch, no registramos "false"
    const visitsTouched = Boolean(
  (form.formState as any)?.dirtyFields?.psychosocial?.familyVisits
);

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
  handleInvalidSubmit
);

  const handleValidateForExport = async () => {
    const isValid = await form.trigger();
    if (!isValid) {
      Alert.alert('Revisa el formulario', 'Completa los campos obligatorios antes de exportar el PDF.');
    }
    return isValid;
  };

  const handleSaveDraft = () => {
    form.setValue('status', 'draft', { shouldDirty: true, shouldValidate: true });
    onSubmit();
  };

  const handleFinalize = () => {
    const checklist = form.getValues('bedsideChecklist');
    if (!isBedsideChecklistComplete(checklist)) {
      setBedsideChecklistHighlightMissing(true);
      setBedsideModalVisible(true);
      return;
    }
    form.setValue('status', 'final', { shouldDirty: true, shouldValidate: true });
    onSubmit();
  };

  const handleSectionLayout = (key: SectionKey) => (event: LayoutChangeEvent) => {
    const y = event.nativeEvent.layout.y;
    setSectionPositions((prev) => ({ ...prev, [key]: y }));
  };

  const toggleSection = (key: SectionKey) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleIndexSelect = (key: string) => {
    const sectionKey = key as SectionKey;
    setCollapsedSections((prev) => (prev[sectionKey] ? { ...prev, [sectionKey]: false } : prev));
    const y = sectionPositions[sectionKey];
    if (typeof y !== 'number') return;

    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y, animated: true });
    });
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const yOffset = event.nativeEvent.contentOffset.y;
    const current = findActiveSection(yOffset, sectionPositions);
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

  return (
    <FormProvider {...form}>
      <View style={styles.screen}>
        <SidebarIndex
          sectionsInfo={sectionsInfo}
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
        {/* BEGIN HANDOVER D6 – HandoverForm PatientBanner */}
        <PatientBanner summary={bannerSummary} loading={bannerLoading} error={patientSummaryError} />
        {/* END HANDOVER D6 – HandoverForm PatientBanner */}
        <View
          ref={sectionRefs.turno}
          onLayout={handleSectionLayout('turno')}
          style={styles.section}
        >
          <CollapsibleSection
            title="Datos del turno"
            isCollapsed={collapsedSections.turno}
            onToggle={() => toggleSection('turno')}
          >
            <AdministrativeSection
              styles={styles}
              onEditShift={handleShiftDetailsPress}
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
          </CollapsibleSection>
        </View>

        <View
          ref={sectionRefs.paciente}
          onLayout={handleSectionLayout('paciente')}
          style={styles.section}
        >
          <CollapsibleSection
            title="Paciente"
            isCollapsed={collapsedSections.paciente}
            onToggle={() => toggleSection('paciente')}
          >
            <PatientSection styles={styles} onScanPress={onScanPress} />
          </CollapsibleSection>
        </View>

      {isOn('SHOW_SBAR') && (
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
              handleGenerateSbarSuggestion={handleGenerateSbarSuggestion}
              handleRefineSbarWithAi={handleRefineSbarWithAi}
              sbarHelperMessage={sbarHelperMessage}
              sbarAiError={sbarAiError}
              sbarSituationError={sbarSituationError}
              sbarBackgroundError={sbarBackgroundError}
              sbarAssessmentError={sbarAssessmentError}
              sbarRecommendationError={sbarRecommendationError}
            />
          </CollapsibleSection>
        </View>
      )}

      {isOn('SHOW_VITALS') && (
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
            unmountOnCollapse
            sectionKey="vitals"
          >
            <VitalsSection
              styles={styles}
              parseNumericInput={parseNumericInput}
              riskEvaluation={riskEvaluation}
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

      {isOn('SHOW_OXY') && (
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

      {computedAlerts.length > 0 && (
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

      {/* BEGIN HANDOVER D4 – Conditional sections */}
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
          unmountOnCollapse
          sectionKey="clinicalScales"
        >
          <ClinicalScalesSection />
          {features.enablePediatricScales && (
            <Text style={{ marginVertical: 8 }}>Escalas pediátricas próximamente.</Text>
          )}
          {features.enableOncoFields && (
            <Text style={{ marginVertical: 8 }}>Campos oncológicos adicionales próximamente.</Text>
          )}
        </CollapsibleSection>
      </View>
      {/* END HANDOVER D4 – Conditional sections */}

      <View
        ref={sectionRefs.examenes}
        onLayout={handleSectionLayout('examenes')}
        style={styles.section}
      >
        <CollapsibleSection
          title="Exámenes y procedimientos"
          isCollapsed={collapsedSections.examenes}
          onToggle={() => toggleSection('examenes')}
        >
          <ExamsProceduresSection />
        </CollapsibleSection>
      </View>

      {isOn('SHOW_MEDS') && (
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
            <MedicationSection control={control} />
            <View style={{ marginTop: 24 }}>
              <TreatmentsSection control={control} />
            </View>
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
                  disabled={dictationUnavailable}
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
          </CollapsibleSection>
        </View>
      )}

      {isOn('SHOW_ATTACH') && (
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
            <AudioAttach
              onRecorded={(uri) => form.setValue('audioUri', uri, { shouldDirty: true })}
              onAttach={(uri) => form.setValue('audioUri', uri, { shouldDirty: true })}
            />
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
            <Text style={styles.label}>Notas libres de diagnósticos médicos</Text>
            <View style={styles.dictationRow}>
              <View style={styles.flex}>
                <Controller
                  control={control}
                  name="dxMedical"
                  render={({ field: { onChange, onBlur, value } }) => (
                    <TextInput
                      style={[styles.input, styles.textArea]}
                      multiline
                      placeholder="Diagnósticos médicos en texto libre (legado)"
                      onBlur={onBlur}
                      value={value ?? ''}
                      onChangeText={onChange}
                    />
                  )}
                />
              </View>
              <DictationMicButton
                active={activeDictationField === 'dxMedical' && sttStatus === 'listening'}
                disabled={dictationUnavailable}
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
          <View style={styles.field}>
            {/* BEGIN HANDOVER D3 – dxNursingStructured */}
            <DiagnosisAutocomplete
              name="dxNursingStructured"
              label="Diagnósticos de enfermería (estructurados)"
              systemsAllowed={['NANDA']}
            />
            {/* END HANDOVER D3 – dxNursingStructured */}
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>Notas libres de diagnósticos de enfermería</Text>
            <View style={styles.dictationRow}>
              <View style={styles.flex}>
                <Controller
                  control={control}
                  name="dxNursing"
                  render={({ field: { onChange, onBlur, value } }) => (
                    <TextInput
                      style={[styles.input, styles.textArea, tokenInputStyle]}
                      multiline
                      placeholder="Diagnósticos de enfermería en texto libre (legado)"
                      placeholderTextColor={colors.muted}
                      onBlur={onBlur}
                      value={value ?? ''}
                      onChangeText={onChange}
                    />
                  )}
                />
              </View>
              <DictationMicButton
                active={activeDictationField === 'dxNursing' && sttStatus === 'listening'}
                disabled={dictationUnavailable}
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
          <View style={styles.dictationRow}>
            <View style={styles.flex}>
              <Controller
                control={control}
                name="evolution"
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
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
              disabled={dictationUnavailable}
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

      <View
        ref={sectionRefs.resumen}
        onLayout={handleSectionLayout('resumen')}
        style={styles.section}
      >
        <CollapsibleSection
          title="Resumen / cierre de turno"
          isCollapsed={collapsedSections.resumen}
          onToggle={() => toggleSection('resumen')}
        >
          <SummarySection
            styles={styles}
            dictationState={{
              activeDictationField,
              sttStatus,
              dictationUnavailable,
              renderDictationStatus,
              handleDictationPress,
            }}
            DictationMicButton={DictationMicButton}
            sbarPreview={sbarPreview}
            onGenerateSbar={handleGenerateSbar}
            onInsertSbar={handleInsertSbar}
            onCloseSbarPreview={handleCloseSbarPreview}
          />
        </CollapsibleSection>
      </View>

      <View
        ref={sectionRefs.bedsideChecklist}
        onLayout={handleSectionLayout('bedsideChecklist')}
        style={styles.section}
      >
        <CollapsibleSection
          title="Bedside Checklist"
          isCollapsed={collapsedSections.bedsideChecklist}
          onToggle={() => toggleSection('bedsideChecklist')}
          lazy
          sectionKey="bedsideChecklist"
        >
          <BedsideChecklistSection />
        </CollapsibleSection>
      </View>

      {/* BEGIN HANDOVER: SIGNATURES_DUAL_UI */}
      <View
        ref={sectionRefs.firmas}
        onLayout={handleSectionLayout('firmas')}
        style={styles.section}
      >
        <CollapsibleSection
          title="Firmas"
          isCollapsed={collapsedSections.firmas}
          onToggle={() => toggleSection('firmas')}
        >
          <SignaturesSection
            value={signaturesValue}
            onChange={(next) =>
              form.setValue('signatures', next, { shouldDirty: true, shouldValidate: true })
            }
            currentUser={signatureUser}
            administrativeUnitId={administrativeUnitValue}
          />
          {outgoingSignatureError ? <Text style={styles.error}>{outgoingSignatureError}</Text> : null}
          {incomingSignatureError ? <Text style={styles.error}>{incomingSignatureError}</Text> : null}
        </CollapsibleSection>
      </View>
      {/* END HANDOVER: SIGNATURES_DUAL_UI */}

      <View style={styles.buttonRow}>
        <HandoverFormActions
          styles={styles}
          onSaveDraft={handleSaveDraft}
          onFinalize={handleFinalize}
          finalizeDisabled={formState.isSubmitting || hasValidationErrors}
          handover={form.getValues()}
          onBeforeExport={handleValidateForExport}
        />
      </View>
      </ScrollView>
      </View>

      <BedsideChecklistModal
        visible={bedsideModalVisible}
        highlightMissing={bedsideChecklistHighlightMissing}
        onCancel={() => {
          setBedsideModalVisible(false);
          setBedsideChecklistHighlightMissing(false);
        }}
        onConfirm={() => {
          setBedsideModalVisible(false);
          setBedsideChecklistHighlightMissing(false);
          form.setValue('status', 'final', { shouldDirty: true, shouldValidate: true });
          onSubmit();
        }}
      />
    </FormProvider>
  );
}
