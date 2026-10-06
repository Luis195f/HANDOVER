import React, { useMemo } from 'react';
import { Text } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { FormProvider, useForm } from 'react-hook-form';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VitalsSection } from '@/src/components/handover/VitalsSection';
import { prefillFromFHIR } from '@/src/lib/prefill';
import { deriveRiskEvaluationFromValues } from '@/src/lib/scores/handoverRisk';
import { zVitals, zHandover, type HandoverValues } from '@/src/validation/schemas';
import { buildHandoverBundle, mapObservationVitals, mapDeviceUse } from '@/src/lib/fhir-map';
import * as fhirMapping from '@/src/lib/fhir-map';
import uciFixture from '../fixtures/fhir/uci-adulto-contextual-bundle.json';
import { createRrReviewGate, packRrDraft, unpackRrDraft, readRrReview, parseRespiratoryRate, withoutNews2Vitals, type RrDraft } from '@/src/lib/news2-input';
import { computeNEWS2 } from '@/src/lib/news2';
import { computeAlerts } from '@/src/lib/alerts';
import { buildExternalAiClinicalContext } from '@/src/lib/ai-sbar';
import * as aiSbar from '@/src/lib/ai-sbar';
import { buildHandoverInputPayload } from '@/src/screens/handover/submission';
import QRScanScreen from '@/src/screens/QRScan';
import { snomedTerms, SNOMED_SYSTEM } from '@/src/data/snomed-dict';
import * as profileRuntime from '@/src/lib/profile-runtime';
import * as news2Calculator from '@/src/lib/news2';
import { generateSBARSummary } from '@/src/lib/summary';
import * as summaryBuilders from '@/src/lib/summary';
import { buildMinimalSbarSummary, getBestAvailableSummary } from '@/src/lib/ai-degrade';
import type { OxygenTherapy } from '@/src/types/handover';
import type { UseFormReturn } from 'react-hook-form';
import { isSupplementalOxygen, resolveSupplementalOxygen, withTransientOxygen } from '@/src/lib/oxygen';
import { LOINC, SNOMED, TERMINOLOGY_SYSTEMS } from '@/src/lib/codes';
import { normalizePatientListResponse, buildPriorityInputs } from '@/src/lib/patientListData';
import { computeMPACFromInput } from '@/src/lib/mpac';
import { sortPatientsByNEWS2Desc } from '@/src/lib/patient-filters';
import * as patientScores from '@/src/lib/patient-filters';
import * as news2Input from '@/src/lib/news2-input';
import * as patientData from '@/src/lib/patientListData';
import * as priorities from '@/src/lib/priority';
import * as patientAlerts from '@/src/lib/alerts';
import * as pilotControl from '@/src/config/pilotControl';
import { ClinicalSuggestions } from '@/src/components/ClinicalSuggestions';

const warningVisibility = vi.hoisted(() => ({ showVitals: true, ai: false, realSuggestions: false }));
const patientListAuth = vi.hoisted(() => ({ enabled: false,
  session: { userId: 'synthetic', roles: ['nurse'], units: ['icu-a'] } }));
const enqueueBundleMock = vi.hoisted(() => vi.fn(async () => ({ id: 'synthetic-queued' })));

vi.mock('react-native', async importOriginal => ({
  ...await importOriginal<typeof import('react-native')>(),
  LayoutAnimation: { configureNext: vi.fn(), Presets: { easeInEaseOut: {} } },
}));

vi.mock('@/src/components/VitalSignsChart', () => ({ default: () => null }));
vi.mock('@/src/screens/components/VitalTrendsChart', () => ({ VitalTrendsChart: () => null }));
vi.mock('@/src/components/ClinicalSuggestions', async importOriginal => {
  const original = await importOriginal<typeof import('@/src/components/ClinicalSuggestions')>();
  return { ...original, default: (props: React.ComponentProps<typeof original.default>) =>
    warningVisibility.realSuggestions ? <original.default {...props} /> : null };
});
vi.mock('@/src/config/flags', () => ({ isOn: (name: string) => name === 'AI_SUGGESTIONS_ENABLED' ? warningVisibility.ai : name === 'SHOW_VITALS' ? warningVisibility.showVitals : ['SHOW_OXY', 'SHOW_SBAR'].includes(name) }));
vi.mock('@/src/config/env', async importOriginal => {
  const original = await importOriginal<typeof import('@/src/config/env')>();
  return { ...original, get AI_BACKEND_BASE_URL() { return warningVisibility.ai ? 'https://ai.synthetic.invalid' : original.AI_BACKEND_BASE_URL; } };
});
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true, useFocusEffect: () => {} }));
vi.mock('expo-camera', () => ({
  CameraView: ({ onBarcodeScanned }: { onBarcodeScanned?: (result: { data: string }) => void }) =>
    <Text onPress={() => onBarcodeScanned?.({ data: '{"patientId":"synthetic","server":"https://fhir.invalid"}' })}>scan</Text>,
  useCameraPermissions: () => [{ granted: true }, vi.fn()],
}));
vi.mock('@/src/hooks/usePatientSummary', () => ({
  usePatientSummary: () => ({ loading: false, error: null, summary: null }),
}));
vi.mock('@/src/security/auth', () => ({
  useAuth: () => ({ session: patientListAuth.enabled ? patientListAuth.session : null }), ensureFreshAccessToken: async () => null, getSession: async () => patientListAuth.enabled ? patientListAuth.session : null,
}));
vi.mock('@/src/lib/queue', async importOriginal => ({
  ...await importOriginal<typeof import('@/src/lib/queue')>(), enqueueBundle: enqueueBundleMock,
}));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); warningVisibility.showVitals = true; warningVisibility.ai = false; warningVisibility.realSuggestions = false; patientListAuth.enabled = false; });

const message = 'NEWS2 no calculable: verificar frecuencia respiratoria';
const forbiddenResults = ['news2', 'total', 'anyThree', 'band', 'priority', 'priorityLabel'];
const observation = (value: number | string, at = '2026-09-22T10:00:00Z') => ({
  resourceType: 'Observation', id: 'forbidden-observation-id',
  subject: { reference: 'Patient/forbidden-subject' },
  encounter: { reference: 'Encounter/forbidden-encounter' },
  performer: [{ reference: 'Practitioner/forbidden-performer' }],
  note: [{ text: 'forbidden-note' }], extension: [{ url: 'forbidden-extension' }],
  code: { coding: [{ system: 'http://loinc.org', code: '9279-1' }] },
  valueQuantity: { value, unit: '/min' }, effectiveDateTime: at,
});

function fetchObservations(resources: unknown[]): typeof fetch {
  return vi.fn<typeof fetch>(async (input) => new Response(JSON.stringify({
    resourceType: 'Bundle',
    entry: String(input).includes('Observation?') ? resources.map(resource => ({ resource })) : [],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

function PendingVitals() {
  const form = useForm<HandoverValues>({ defaultValues: { vitals: { rr: 8.5 } } });
  const gate = useMemo(() => createRrReviewGate(), []);
  const blocked = gate.observe(form.watch('vitals.rr'));
  const props = {
    styles: {}, parseNumericInput: (text: string) => text === '' ? undefined : Number(text),
    riskEvaluation: deriveRiskEvaluationFromValues(blocked ? undefined : form.watch('vitals')),
    news2Blocked: blocked, onRrChange: (value: number | undefined) => gate.observe(value, true),
    loadingVitalTrends: false, vitalTrendsError: null, vitalTrends: null,
    aiSuggestionsEnabled: false, suggestionsState: { vitals: null, diagnosis: null },
    suggestionsLoading: null, suggestionsError: null, requestSuggestions: () => {},
  };
  return <FormProvider {...form}><VitalsSection {...props} /></FormProvider>;
}

const oxygenCases: { label: string; oxygen: OxygenTherapy | null | undefined; expected: boolean }[] = [
  { label: 'absent', oxygen: undefined, expected: false },
  { label: 'null', oxygen: null, expected: false },
  { label: 'empty object', oxygen: {}, expected: false },
  { label: 'empty device', oxygen: { device: '' }, expected: false },
  { label: 'whitespace', oxygen: { device: '   ' }, expected: false },
  { label: 'room air', oxygen: { device: 'aire ambiente' }, expected: false },
  { label: 'normalized room air', oxygen: { device: '  AIRE  AMBIENTE  ' }, expected: false },
  { label: 'zero flow', oxygen: { flowLMin: 0 }, expected: false },
  { label: 'ambient fio2', oxygen: { fio2: 21 }, expected: false },
  { label: 'lower fio2', oxygen: { fio2: 20 }, expected: false },
  { label: 'room air with ambient indicators', oxygen: { device: 'aire ambiente', flowLMin: 0, fio2: 21 }, expected: false },
  { label: 'device', oxygen: { device: 'cánula nasal', flowLMin: 0, fio2: 21 }, expected: true },
  { label: 'positive flow', oxygen: { flowLMin: 0.5 }, expected: true },
  { label: 'enriched fio2', oxygen: { fio2: 21.1 }, expected: true },
  { label: 'contradictory flow', oxygen: { device: 'aire ambiente', flowLMin: 2 }, expected: true },
  { label: 'contradictory fio2', oxygen: { device: ' AIRE AMBIENTE ', fio2: 35 }, expected: true },
];

const quantityObservation = (code: string, value: unknown, unit?: string, at = '2026-09-29T10:00:00Z') => ({
  resourceType: 'Observation', code: { coding: [{ system: TERMINOLOGY_SYSTEMS.LOINC, code }] },
  valueQuantity: { value, unit }, effectiveDateTime: at,
});
const oxygenMagnitudes = [
  { code: LOINC.fio2, unit: '%', ambient: 21, positive: 28 },
  { code: LOINC.o2Flow, unit: 'L/min', ambient: 0, positive: 2 },
];
const prefillPhysiology = (high = false) => [
  observation(16), quantityObservation(LOINC.spo2, high ? 94 : 98, '%'),
  quantityObservation(LOINC.hr, high ? 111 : 80, '/min'), quantityObservation(LOINC.temp, high ? 39.1 : 37, 'Cel'),
  { resourceType: 'Observation', code: { coding: [{ system: TERMINOLOGY_SYSTEMS.LOINC, code: LOINC.bpPanel }] },
    component: [{ code: { coding: [{ system: TERMINOLOGY_SYSTEMS.LOINC, code: LOINC.sbp }] }, valueQuantity: { value: 120 } }] },
  { resourceType: 'Observation', code: { text: 'ACVPU' }, valueString: 'A' },
];
const readOxygenPrefill = (resources: unknown[], high = false) => prefillFromFHIR('synthetic', {
  fhirBase: 'https://fhir.invalid', fetchImpl: fetchObservations([...prefillPhysiology(high), ...resources]),
});

describe('NEWS2 AI oxygen serialization parity', () => {
  const cases = [
    { label: 'empty with fallback', therapy: {}, legacy: true, expected: true },
    { label: 'empty without fallback', therapy: {}, legacy: undefined, expected: false },
    { label: 'empty with false fallback', therapy: {}, legacy: false, expected: false },
    { label: 'ambient fio2', therapy: { fio2: 21 }, legacy: true, expected: false },
    { label: 'zero flow', therapy: { flowLMin: 0 }, legacy: true, expected: false },
    { label: 'room air', therapy: { device: 'aire ambiente' }, legacy: true, expected: false },
    { label: 'positive fio2', therapy: { fio2: 28 }, legacy: false, expected: true },
    { label: 'positive flow', therapy: { flowLMin: 2 }, legacy: false, expected: true },
    { label: 'real device', therapy: { device: 'cánula nasal' }, legacy: false, expected: true },
  ];
  const enableProvider = () => {
    warningVisibility.ai = true;
    const originalGate = pilotControl.isPilotFeatureEnabled;
    vi.spyOn(pilotControl, 'isPilotFeatureEnabled').mockImplementation((feature, context) =>
      feature === 'ai_suggestions' || originalGate(feature, context));
    const provider = vi.fn<typeof fetch>(async input => {
      expect(String(input)).toBe('https://ai.synthetic.invalid/ai/suggest-interventions');
      return new Response(JSON.stringify({ section: 'vitals', interventions: ['synthetic'] }), { status: 200 });
    });
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) =>
      String(input).endsWith('/ai/suggest-interventions') ? provider(input, init)
        : new Response(JSON.stringify({ resourceType: 'Bundle', entry: [] }), { status: 200 })));
    return provider;
  };
  const navigation = () => ({ navigate: vi.fn(), setParams: vi.fn(), addListener: () => () => {} });
  describe('independent suggestion sections', () => {
    type Section = 'vitals' | 'diagnosis';
    const sections: Section[] = ['vitals', 'diagnosis'];
    const mountRequests = async () => {
      const { default: HandoverForm } = await import('@/src/screens/HandoverForm');
      const prefilledValues = await readOxygenPrefill([], true);
      const provider = enableProvider();
      warningVisibility.realSuggestions = true;
      const pending: { section: Section; resolve: (response: Response) => void; reject: (error: Error) => void }[] = [];
      provider.mockImplementation((_input, init) => new Promise<Response>((resolve, reject) => {
        const context: { section: Section } = JSON.parse(String(init?.body));
        pending.push({ section: context.section, resolve, reject });
      }));
      const screen = render(<HandoverForm navigation={navigation()}
        route={{ key: 'section-races', name: 'HandoverForm', params: { patientId: 'synthetic-section-races', unitId: 'icu', prefilledValues } }} />);
      if (!screen.queryByText('Sugerencias IA de cuidados')) fireEvent.press(screen.getByText('Diagnósticos médicos/ enfermería'));
      const panel = (section: Section) => {
        const panels = screen.root.findAllByType(ClinicalSuggestions);
        expect(panels).toHaveLength(2);
        return panels[section === 'vitals' ? 0 : 1].props;
      };
      const start = async (section: Section) => {
        await act(async () => { panel(section).onRefresh(); await Promise.resolve(); });
      };
      const finish = async (index: number, label: string, failure = false) => {
        await act(async () => {
          if (failure) pending[index].reject(new Error('synthetic section error'));
          else pending[index].resolve(new Response(JSON.stringify({ section: pending[index].section, interventions: [label] }), { status: 200 }));
        });
      };
      const editOxygen = () => {
        if (!screen.queryByPlaceholderText('Cánula / Mascarilla')) fireEvent.press(screen.getByText(/Oxigenoterapia/));
        fireEvent.changeText(screen.getByPlaceholderText('Cánula / Mascarilla'), 'cánula nasal');
      };
      return { screen, provider, panel, start, finish, editOxygen };
    };

    it.each(sections)('shows and caches both concurrent results when %s finishes first', async first => {
      const { screen, provider, panel, start, finish } = await mountRequests();
      const second = first === 'vitals' ? 'diagnosis' : 'vitals';
      try {
        await start('vitals');
        expect(panel('vitals').isLoading).toBe(true);
        expect(panel('diagnosis').isLoading).toBe(false);
        await start('diagnosis');
        expect(panel(first).isLoading).toBe(true);
        expect(panel(second).isLoading).toBe(true);
        await finish(first === 'vitals' ? 0 : 1, first + ' current');
        expect(screen.queryByText(first + ' current')).not.toBeNull();
        expect(panel(first).isLoading).toBe(false);
        expect(panel(second).isLoading).toBe(true);
        await finish(first === 'vitals' ? 1 : 0, second + ' current');
        for (const section of sections) {
          expect(screen.queryByText(section + ' current')).not.toBeNull();
          expect(panel(section).isLoading).toBe(false);
          expect(panel(section).errorMessage).toBeNull();
          await start(section);
        }
        expect(provider).toHaveBeenCalledTimes(2);
      } finally { screen.unmount(); }
    });

    it.each(sections)('keeps the latest request and cache within %s', async section => {
      const { screen, provider, panel, start, finish } = await mountRequests();
      try {
        await start(section);
        await start(section);
        await finish(1, 'newer result');
        await finish(0, 'obsolete result');
        expect(panel(section).suggestions.interventions).toEqual(['newer result']);
        expect(screen.queryByText('obsolete result')).toBeNull();
        await start(section);
        expect(provider).toHaveBeenCalledTimes(2);
      } finally { screen.unmount(); }
    });

    it.each(sections)('isolates errors and completion in %s from the other pending section', async first => {
      const { screen, panel, start, finish } = await mountRequests();
      const other = first === 'vitals' ? 'diagnosis' : 'vitals';
      try {
        await start(first);
        await start(other);
        await finish(0, '', true);
        expect(panel(first).errorMessage).toEqual(expect.any(String));
        const error = panel(first).errorMessage;
        expect(panel(first).isLoading).toBe(false);
        expect(panel(other).isLoading).toBe(true);
        expect(panel(other).errorMessage).toBeNull();
        await finish(1, 'other current');
        expect(panel(first).errorMessage).toBe(error);
        expect(panel(other).suggestions.interventions).toEqual(['other current']);
        await start(other);
        expect(panel(first).errorMessage).toBe(error);
        await start(first);
        expect(panel(first).errorMessage).toBeNull();
        expect(panel(other).suggestions.interventions).toEqual(['other current']);
        await finish(2, 'retry current');
      } finally { screen.unmount(); }
    });

    it.each(['rr', 'oxygen'])('invalidates both pending sections on shared %s revision', async change => {
      const { screen, provider, panel, start, finish, editOxygen } = await mountRequests();
      try {
        await start('vitals');
        await start('diagnosis');
        if (change === 'rr') fireEvent.changeText(screen.getByPlaceholderText('16'), '21');
        else editOxygen();
        await finish(0, 'obsolete vitals');
        await finish(1, 'obsolete diagnosis');
        for (const section of sections) {
          expect(panel(section).suggestions).toBeNull();
          expect(panel(section).isLoading).toBe(false);
          expect(panel(section).errorMessage).toBeNull();
        }
        expect(screen.queryByText('obsolete vitals')).toBeNull();
        expect(screen.queryByText('obsolete diagnosis')).toBeNull();
        await start('vitals');
        await start('diagnosis');
        expect(provider).toHaveBeenCalledTimes(4);
        await finish(2, 'new vitals');
        await finish(3, 'new diagnosis');
        expect(panel('vitals').suggestions.interventions).toEqual(['new vitals']);
        expect(panel('diagnosis').suggestions.interventions).toEqual(['new diagnosis']);
      } finally { screen.unmount(); }
    });

    it.each(sections)('a cache hit in %s leaves the other request pending and valid', async cached => {
      const { screen, provider, panel, start, finish } = await mountRequests();
      const other = cached === 'vitals' ? 'diagnosis' : 'vitals';
      try {
        await start(cached);
        await finish(0, 'cached result');
        await start(other);
        await start(cached);
        expect(provider).toHaveBeenCalledTimes(2);
        expect(panel(other).isLoading).toBe(true);
        expect(panel(cached).suggestions.interventions).toEqual(['cached result']);
        await finish(1, 'other result');
        expect(panel(other).suggestions.interventions).toEqual(['other result']);
        expect(panel(cached).suggestions.interventions).toEqual(['cached result']);
      } finally { screen.unmount(); }
    });
  });

  it.each(['remove oxygen', 'add oxygen', 'change RR', 'same context'])('rejects obsolete suggestions: %s', async change => {
    const { default: HandoverForm } = await import('@/src/screens/HandoverForm');
    const prefilledValues = await readOxygenPrefill([], true);
    prefilledValues.oxygenTherapy = { device: change === 'add oxygen' ? 'aire ambiente' : 'cánula nasal' };
    const provider = enableProvider();
    const pending: { resolve: (response: Response) => void; reject: (error: Error) => void }[] = [];
    provider.mockImplementation(() => new Promise<Response>((resolve, reject) => pending.push({ resolve, reject })));
    const screen = render(<HandoverForm navigation={navigation()}
      route={{ key: 'ai-race', name: 'HandoverForm', params: { patientId: 'synthetic-race', unitId: 'icu', prefilledValues } }} />);
    const section = () => screen.root.findByType(VitalsSection).props;
    const start = async () => { await act(async () => { void section().requestSuggestions('vitals'); await Promise.resolve(); }); };
    const finish = async (index: number, label: string) => {
      await act(async () => { pending[index].resolve(new Response(JSON.stringify({ section: 'vitals', interventions: [label] }), { status: 200 })); });
    };
    try {
      await start();
      expect(provider).toHaveBeenCalledTimes(1);
      if (change === 'change RR') fireEvent.changeText(screen.getByPlaceholderText('16'), '21');
      else if (change !== 'same context') {
        if (!screen.queryByPlaceholderText('Cánula / Mascarilla')) fireEvent.press(screen.getByText(/Oxigenoterapia/));
        fireEvent.changeText(screen.getByPlaceholderText('Cánula / Mascarilla'), change === 'add oxygen' ? 'cánula nasal' : 'aire ambiente');
      }
      expect(section().suggestionsState.vitals).toBeNull();
      await start();
      expect(provider).toHaveBeenCalledTimes(2);
      await finish(1, 'current');
      expect(section().suggestionsState.vitals?.interventions).toEqual(['current']);
      await finish(0, 'obsolete');
      expect(section().suggestionsState.vitals?.interventions).toEqual(['current']);
      expect(section().suggestionsError).toBeNull();
      expect(section().suggestionsLoading).toBeNull();
      await start();
      expect(provider).toHaveBeenCalledTimes(2);
      expect(section().suggestionsState.vitals?.interventions).toEqual(['current']);
    } finally { screen.unmount(); }
  }, 20000);

  it.each(['success', 'failure'])('obsolete %s cannot finish a newer pending request', async outcome => {
    const { default: HandoverForm } = await import('@/src/screens/HandoverForm');
    const prefilledValues = await readOxygenPrefill([], true);
    const provider = enableProvider();
    const pending: { resolve: (response: Response) => void; reject: (error: Error) => void }[] = [];
    provider.mockImplementation(() => new Promise<Response>((resolve, reject) => pending.push({ resolve, reject })));
    const screen = render(<HandoverForm navigation={navigation()}
      route={{ key: 'ai-loading', name: 'HandoverForm', params: { patientId: 'synthetic-loading', unitId: 'icu', prefilledValues } }} />);
    const section = () => screen.root.findByType(VitalsSection).props;
    const start = async () => { await act(async () => { void section().requestSuggestions('vitals'); await Promise.resolve(); }); };
    try {
      await start();
      if (!screen.queryByPlaceholderText('Cánula / Mascarilla')) fireEvent.press(screen.getByText(/Oxigenoterapia/));
      fireEvent.changeText(screen.getByPlaceholderText('Cánula / Mascarilla'), 'cánula nasal');
      await start();
      await act(async () => {
        if (outcome === 'failure') pending[0].reject(new Error('synthetic old failure'));
        else pending[0].resolve(new Response(JSON.stringify({ section: 'vitals', interventions: ['obsolete'] }), { status: 200 }));
      });
      expect(section().suggestionsLoading).toBe('vitals');
      expect(section().suggestionsState.vitals).toBeNull();
      expect(section().suggestionsError).toBeNull();
      await act(async () => { pending[1].resolve(new Response(JSON.stringify({ section: 'vitals', interventions: ['current'] }), { status: 200 })); });
      expect(section().suggestionsState.vitals?.interventions).toEqual(['current']);
      expect(section().suggestionsLoading).toBeNull();
      await start();
      expect(provider).toHaveBeenCalledTimes(2);
    } finally { screen.unmount(); }
  }, 20000);

  it('clears visible suggestions and cached context immediately on oxygen change', async () => {
    const { default: HandoverForm } = await import('@/src/screens/HandoverForm');
    const prefilledValues = await readOxygenPrefill([], true);
    prefilledValues.oxygenTherapy = { device: 'cánula nasal' };
    const provider = enableProvider();
    const screen = render(<HandoverForm navigation={navigation()}
      route={{ key: 'ai-cache', name: 'HandoverForm', params: { patientId: 'synthetic-cache', unitId: 'icu', prefilledValues } }} />);
    const section = () => screen.root.findByType(VitalsSection).props;
    const request = async () => { await act(async () => { await section().requestSuggestions('vitals'); }); };
    try {
      await request();
      expect(section().suggestionsState.vitals?.interventions).toEqual(['synthetic']);
      await request();
      expect(provider).toHaveBeenCalledTimes(1);
      if (!screen.queryByPlaceholderText('Cánula / Mascarilla')) fireEvent.press(screen.getByText(/Oxigenoterapia/));
      fireEvent.changeText(screen.getByPlaceholderText('Cánula / Mascarilla'), 'aire ambiente');
      expect(section().suggestionsState.vitals).toBeNull();
      fireEvent.changeText(screen.getByPlaceholderText('Cánula / Mascarilla'), 'cánula nasal');
      await request();
      expect(provider).toHaveBeenCalledTimes(2);
    } finally { screen.unmount(); }
  }, 20000);

  it.each(cases)('$label matches visible NEWS2 in the real suggestions JSON', async ({ therapy, legacy, expected }) => {
    const { default: HandoverForm } = await import('@/src/screens/HandoverForm');
    const prefilledValues = await readOxygenPrefill([], true);
    prefilledValues.oxygenTherapy = therapy;
    prefilledValues.legacyOxygen = legacy;
    const provider = enableProvider();
    const calculator = vi.spyOn(news2Calculator, 'computeNEWS2');
    const screen = render(<HandoverForm navigation={navigation()}
      route={{ key: 'ai-parity', name: 'HandoverForm', params: { patientId: 'synthetic-ai', unitId: 'icu', prefilledValues } }} />);
    try {
      const section = screen.root.findByType(VitalsSection);
      expect(section.props.aiSuggestionsEnabled).toBe(true);
      expect(section.props.riskEvaluation.news2.total).toBe(expected ? 7 : 5);
      expect(calculator.mock.calls.some(([input]) => input.o2 === expected && input.spo2 === 94)).toBe(true);
      await act(async () => { await section.props.requestSuggestions('vitals'); });
      expect(provider).toHaveBeenCalledTimes(1);
      const request = provider.mock.calls[0][1];
      expect(request?.method).toBe('POST');
      const body = JSON.parse(String(request?.body));
      expect(body.vitalSigns.onOxygen).toBe(expected);
      expect(body.scores.news2).toBe(expected ? 7 : 5);
      expect(Object.keys(body).sort()).toEqual(['language', 'section', 'unitId', 'vitalSigns', 'scores', 'notes', ...(therapy.device ? ['devices'] : [])].sort());
      expect(Object.keys(body.vitalSigns).sort()).toEqual(['respiratoryRate', 'heartRate', 'systolicBP', 'spo2', 'temperature', 'consciousness', 'onOxygen'].sort());
      const form: UseFormReturn<HandoverValues> = screen.root.findByType(FormProvider).props;
      for (const data of [request?.body, JSON.stringify(packRrDraft(form.getValues(), undefined))]) {
        expect(data).not.toMatch(/"(?:o2|legacyOxygen|transientO2Fallback)"\s*:/);
      }
    } finally { screen.unmount(); }
  }, 20000);

  it.each(['edit', 'restore', 'patient'])('invalidates AI oxygen after %s without stale serialized scores', async action => {
    const { default: HandoverForm } = await import('@/src/screens/HandoverForm');
    const prefilledValues = await readOxygenPrefill([{ resourceType: 'Observation', valueString: 'oxygen' }], true);
    const provider = enableProvider();
    const nav = navigation();
    const screen = render(<HandoverForm navigation={nav}
      route={{ key: 'ai-invalidation', name: 'HandoverForm', params: { patientId: 'synthetic-ai-before', unitId: 'icu', prefilledValues } }} />);
    try {
      const form: UseFormReturn<HandoverValues> = screen.root.findByType(FormProvider).props;
      await act(async () => { await screen.root.findByType(VitalsSection).props.requestSuggestions('vitals'); });
      expect(JSON.parse(String(provider.mock.calls[0][1]?.body))).toMatchObject({ vitalSigns: { onOxygen: true }, scores: { news2: 7 } });
      if (action === 'edit') {
        if (!screen.queryByPlaceholderText('Cánula / Mascarilla')) fireEvent.press(screen.getByText(/Oxigenoterapia/));
        fireEvent.changeText(screen.getByPlaceholderText('Cánula / Mascarilla'), 'aire ambiente');
      } else if (action === 'restore') {
        const saved = JSON.stringify(packRrDraft(form.getValues(), undefined));
        expect(saved).not.toMatch(/"(?:o2|legacyOxygen|transientO2Fallback)"\s*:/);
        act(() => form.reset(unpackRrDraft(JSON.parse(saved)).values));
      } else {
        act(() => screen.update(<HandoverForm navigation={nav}
          route={{ key: 'ai-invalidation', name: 'HandoverForm', params: { patientId: 'synthetic-ai-after', unitId: 'icu' } }} />));
      }
      expect(screen.root.findByType(VitalsSection).props.riskEvaluation.news2.total).toBe(5);
      await act(async () => { await screen.root.findByType(VitalsSection).props.requestSuggestions('vitals'); });
      expect(provider).toHaveBeenCalledTimes(2);
      expect(JSON.parse(String(provider.mock.calls[1][1]?.body))).toMatchObject({ vitalSigns: { onOxygen: false }, scores: { news2: 5 } });
    } finally { screen.unmount(); }
  }, 20000);
});

describe('FHIR ACVPU canonical reading', () => {
  const states = [
    { letter: 'A', display: 'Alert', code: SNOMED.avpuAlert },
    { letter: 'C', display: 'New confusion', code: SNOMED.avpuConfusion },
    { letter: 'V', display: 'Responds to voice', code: SNOMED.avpuVoice },
    { letter: 'P', display: 'Responds to pain', code: SNOMED.avpuPain },
    { letter: 'U', display: 'Unresponsive', code: SNOMED.avpuUnresponsive },
  ] as const;
  const read = (resource: unknown) => prefillFromFHIR('synthetic', {
    fhirBase: 'https://fhir.invalid', fetchImpl: async input => {
      const response = new Response('{}', { status: 200 });
      vi.spyOn(response, 'json').mockResolvedValue({ resourceType: 'Bundle', entry: String(input).includes('Observation?')
        ? [...prefillPhysiology(true).slice(0, -1), resource].map(value => ({ resource: value })) : [] });
      return response;
    },
  });
  const representations = states.flatMap(state => [
    { ...state, kind: 'SNOMED', value: { valueCodeableConcept: { coding: [{ system: TERMINOLOGY_SYSTEMS.SNOMED, code: state.code }] } } },
    { ...state, kind: 'display', value: { valueCodeableConcept: { coding: [{ display: state.display }] } } },
    { ...state, kind: 'text', value: { valueCodeableConcept: { text: state.display } } },
    { ...state, kind: 'string', value: { valueString: state.display } },
    { ...state, kind: 'letter', value: { valueString: state.letter } },
    { ...state, kind: 'case and spaces', value: { valueCodeableConcept: { text: `  ${state.display.toUpperCase().replace(/ /g, '   ')}  ` } } },
    { ...state, kind: 'lowercase letter', value: { valueCodeableConcept: { text: ` ${state.letter.toLowerCase()} ` } } },
  ]);
  it.each(representations)('reads $letter from $kind without changing the original', async ({ letter, value }) => {
    const resource = { resourceType: 'Observation', code: { text: 'ACVPU scale' }, ...value };
    const before = JSON.stringify(resource);
    const result = await read(resource);
    expect(result.vitals?.acvpu).toBe(letter);
    expect(result.news2).toBe(letter === 'A' ? 5 : 8);
    expect(result.priority).toBe(letter === 'A' ? 'medium' : 'high');
    expect(JSON.stringify(resource)).toBe(before);
  });
  it.each(states)('round trips the real FHIR mapper for $letter without changing its output', async ({ letter, display, code }) => {
    const [resource] = mapObservationVitals({ patientId: 'synthetic', avpu: letter });
    const before = JSON.stringify(resource);
    expect(resource.valueCodeableConcept).toEqual({ coding: [{ system: TERMINOLOGY_SYSTEMS.SNOMED, code, display }], text: display });
    expect((await read(resource)).vitals?.acvpu).toBe(letter);
    expect(JSON.stringify(resource)).toBe(before);
    expect(fhirMapping.resolveAcvpu(code)).toBe(letter);
  });
  it('reads the versioned ICU Observation as V with NEWS2 8 and critical band', async () => {
    const resource = uciFixture.entry.map(entry => entry.resource).find(resource =>
      resource.resourceType === 'Observation' && resource.code?.coding?.some(coding => coding.code === LOINC.acvpu));
    expect(resource).toBeDefined();
    const before = JSON.stringify(resource);
    const result = await read(resource);
    expect(result.vitals?.acvpu).toBe('V');
    expect(result.news2).toBe(8);
    expect(result.priority).toBe('high');
    expect(result.priorityLabel).toBe('High');
    expect(computeNEWS2({ ...result.vitals, avpu: result.vitals?.acvpu })).toMatchObject({
      avpu: 3, total: 8, anyThree: true, band: 'CRÍTICA',
    });
    expect(JSON.stringify(resource)).toBe(before);
  });
  it.each(['unknown', 'voice', 'pain', 'patient responds to voice today', 'no pain', 'not Alert', 'New confusion suspected', 'Álert', ''])('does not interpret narrative or unknown value %s', async value => {
    const resource = { resourceType: 'Observation', code: { text: 'ACVPU scale' }, valueString: value };
    expect((await read(resource)).vitals?.acvpu).toBeUndefined();
    expect(fhirMapping.resolveAcvpu(value)).toBeUndefined();
  });
  it.each([
    { coding: [{ system: TERMINOLOGY_SYSTEMS.SNOMED, code: SNOMED.avpuVoice }], text: 'Alert' },
    { coding: [{ code: SNOMED.avpuVoice, display: 'Unresponsive' }] },
    { coding: [{ code: SNOMED.avpuPain }, { code: SNOMED.avpuConfusion }] },
  ])('stops prefill rather than choosing among contradictory recognized values: %j', async valueCodeableConcept => {
    const resource = { resourceType: 'Observation', code: { text: 'ACVPU scale' },
      valueCodeableConcept };
    const before = JSON.stringify(resource);
    const result = await read(resource);
    expect(result.vitals?.acvpu).toBeUndefined();
    for (const property of forbiddenResults) expect(result).not.toHaveProperty(property);
    expect(JSON.stringify(resource)).toBe(before);
  });
  it('recognizes the existing LOINC identity without requiring a narrative label', async () => {
    const result = await read({ resourceType: 'Observation', code: { coding: [{ system: TERMINOLOGY_SYSTEMS.LOINC, code: LOINC.acvpu }] },
      valueCodeableConcept: { coding: [{ system: TERMINOLOGY_SYSTEMS.SNOMED, code: SNOMED.avpuVoice, display: 'Responds to voice' }], text: 'V' } });
    expect(result.vitals?.acvpu).toBe('V');
    expect(result.news2).toBe(8);
  });
  it('does not treat a foreign code system as SNOMED or replace an unknown latest value with an older one', async () => {
    const resource = { resourceType: 'Observation', code: { text: 'ACVPU scale' },
      valueCodeableConcept: { coding: [{ system: 'https://synthetic.invalid/codes', code: SNOMED.avpuVoice }] } };
    expect((await read(resource)).vitals?.acvpu).toBeUndefined();
    const result = await prefillFromFHIR('synthetic', { fhirBase: 'https://fhir.invalid', fetchImpl: fetchObservations([
      { ...resource, valueString: 'V', effectiveDateTime: '2026-09-29T10:00:00Z' },
      { ...resource, valueString: 'unknown', effectiveDateTime: '2026-09-30T10:00:00Z' },
    ]) });
    expect(result.vitals?.acvpu).toBeUndefined();
  });
});

describe('PatientList NEWS2 respiratory gate', () => {
  const vitals = (rr?: number) => ({ rr, spo2: 91, tempC: 37, sbp: 120, hr: 111, avpu: 'A' as const, o2: false });
  const blocked = { status: 'blocked', code: 'NEWS2_NOT_CALCULABLE', reason: 'rr_requires_integer' };

  it.each([8.5, 11.5, 20.5])('blocks calculation, not independent evidence, for RR %s', rr => {
    const calculate = vi.fn(() => computeNEWS2({ ...vitals(rr), temp: 37 }));
    const result = news2Input.evaluateNews2Input(rr, calculate);
    expect(result).toEqual(blocked);
    expect(calculate).not.toHaveBeenCalled();
    for (const field of ['result', 'total', 'band', 'anyThree', 'news2Score', 'level']) expect(result).not.toHaveProperty(field);
  });

  it.each([{ rr: 8, points: 3 }, { rr: 9, points: 1 }, { rr: 11, points: 1 },
    { rr: 12, points: 0 }, { rr: 20, points: 0 }, { rr: 21, points: 2 }, { rr: undefined, points: 0 }])(
    'preserves canonical RR $rr and real absence', ({ rr, points }) => {
      const result = news2Input.evaluateNews2Input(rr, () => computeNEWS2({ ...vitals(rr), temp: 37 }));
      expect(result).toMatchObject({ status: 'calculated', result: { rr: points, total: 5 + points } });
      expect(result).not.toHaveProperty('reason');
    });

  it('keeps independent precomputed provenance and never recalculates it', () => {
    const calculator = vi.spyOn(news2Calculator, 'computeNEWS2');
    for (const precomputed of [{ news2: 7, latestNews2: { score: 9 } }, { latestNews2: { score: 7 } }]) {
      const patient = Object.freeze({ id: 'stored', ...precomputed, vitals: Object.freeze(vitals(20.5)) });
      expect(patientScores.resolvePatientNews2(patient)).toEqual({ status: 'calculated',
        result: { score: 7, source: 'news2' in precomputed ? 'news2' : 'latestNews2' } });
      expect(patient.vitals.rr).toBe(20.5);
    }
    expect(calculator).not.toHaveBeenCalled();
  });

  it('sorts numeric scores first and keeps blocked entries stable without mutating inputs', () => {
    const patients = [
      { id: 'blocked-z', name: 'Z', vitals: vitals(20.5) },
      { id: 'zero', news2: 0 }, { id: 'stored', latestNews2: { score: 7 }, vitals: vitals(11.5) },
      { id: 'blocked-a', name: 'A', vitals: vitals(8.5) }, { id: 'valid', vitals: vitals(16) },
    ];
    const before = JSON.stringify(patients);
    expect(patientScores.resolvePatientNews2(patients[0])).toEqual(blocked);
    expect(patientScores.resolvePatientNews2(patients[4])).toEqual({ status: 'calculated', result: { score: 5, source: 'vitals' } });
    expect(sortPatientsByNEWS2Desc(patients).map(patient => patient.id)).toEqual(['stored', 'valid', 'zero', 'blocked-z', 'blocked-a']);
    expect(sortPatientsByNEWS2Desc(patients).map(patient => patient.id)).toEqual(['stored', 'valid', 'zero', 'blocked-z', 'blocked-a']);
    expect(JSON.stringify(patients)).toBe(before);
  });

  it.each([true, false])('mounts the API-to-PatientList chain, valid patient included: %s', async includeCalculated => {
    patientListAuth.enabled = true;
    const patients = (includeCalculated ? [8.5, 11.5, 20.5, 21] : [8.5, 11.5, 20.5]).map(rr => ({ id: `rr-${rr}`, name: `RR ${rr}`, unitId: 'icu-a',
      vitals: Object.freeze(vitals(rr)), risks: Object.freeze({ fall: true }) }));
    const before = JSON.stringify(patients);
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(patients),
      { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const normalize = vi.spyOn(patientData, 'normalizePatientListResponse');
    const priority = vi.spyOn(priorities, 'computePriority');
    const sorted = vi.spyOn(priorities, 'computePriorityList');
    const alerts = vi.spyOn(patientAlerts, 'computeAlerts');
    const { default: PatientList } = await import('@/src/screens/PatientList');
    const screen = render(<PatientList navigation={{ navigate: vi.fn(), setOptions: vi.fn() }}
      route={{ key: 'rr-patient-list', name: 'PatientList' }} />);
    try {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/patients'))).toBe(true);
      expect(normalize).toHaveBeenCalled();
      await waitFor(() => expect(screen.getByTestId('patient-card-rr-20.5')).toBeTruthy());
      for (const rr of [8.5, 11.5, 20.5]) {
        const card = screen.getByTestId(`patient-card-rr-${rr}`);
        const notices = card.findAll(node => typeof node.type === 'string' && node.props.children === message);
        expect(notices).toHaveLength(1);
        expect(notices[0].props.accessibilityRole).toBe('alert');
        expect(screen.queryByTestId(`priority-badge-rr-${rr}`)).toBeNull();
      }
      if (includeCalculated) expect(priority.mock.calls.length).toBeGreaterThan(0);
      else expect(priority).not.toHaveBeenCalled();
      expect(priority.mock.calls.every(([input]) => input.vitals.rr === 21)).toBe(true);
      expect(sorted).toHaveBeenCalled();
      expect(sorted.mock.calls.flatMap(([inputs]) => inputs).every(input => input.vitals.rr === 21)).toBe(true);
      if (includeCalculated) expect(screen.getByTestId('priority-badge-rr-21')).toBeTruthy();
      const lastAlerts = alerts.mock.results.slice(-patients.length).map(result => result.value.map((alert: { id: string }) => alert.id));
      expect(lastAlerts).toHaveLength(patients.length);
      for (const independent of lastAlerts.slice(0, 3)) expect(independent).toEqual(['risk-fall-no-actions']);
      if (includeCalculated) expect(lastAlerts[3]).toContain('news2-high-with-risk');
      const cards = screen.root.findAll(node => typeof node.type === 'string' &&
        typeof node.props.testID === 'string' && node.props.testID.startsWith('patient-card-'));
      expect(cards.map(card => card.props.testID)).toEqual([
        ...(includeCalculated ? ['patient-card-rr-21'] : []),
        'patient-card-rr-8.5', 'patient-card-rr-11.5', 'patient-card-rr-20.5',
      ]);
      expect(JSON.stringify(patients)).toBe(before);
      expect(normalize.mock.results.at(-1)?.value.map((patient: { vitals: unknown }) => patient.vitals)).toEqual(patients.map(patient => patient.vitals));
    } finally { screen.unmount(); }
  }, 30000);
});

describe('NEWS2 canonical temperature precedence', () => {
  const cases = [
    { label: 'canonical fever wins', temperatures: { tempC: 39.1, temp: 37 }, selected: 39.1, total: 7 },
    { label: 'canonical normal wins', temperatures: { tempC: 37, temp: 39.1 }, selected: 37, total: 5 },
    { label: 'legacy alone', temperatures: { temp: 39.1 }, selected: 39.1, total: 7 },
    { label: 'null canonical normal legacy', temperatures: { tempC: null, temp: 37 }, selected: 37, total: 5 },
    { label: 'null canonical fever legacy', temperatures: { tempC: null, temp: 39.1 }, selected: 39.1, total: 7 },
    { label: 'equal values', temperatures: { tempC: 39.1, temp: 39.1 }, selected: 39.1, total: 7 },
    { label: 'canonical alone', temperatures: { tempC: 39.1 }, selected: 39.1, total: 7 },
    { label: 'both absent', temperatures: {}, selected: undefined, total: 5 },
    { label: 'null without legacy', temperatures: { tempC: null }, selected: undefined, total: 5 },
  ];
  it.each(cases)('$label agrees in real PatientList normalization, MPAC, alerts and sorting', ({ temperatures, selected, total }) => {
    const original = [{ id: 'synthetic-temp', name: 'Synthetic', unitId: 'icu',
      vitals: { rr: 16, spo2: 91, sbp: 120, hr: 111, avpu: 'A', o2: false, ...temperatures },
      risks: { fall: true }, devices: [], pendingTasks: [] }];
    Object.freeze(original[0].vitals);
    const before = JSON.stringify(original);
    const [patient] = normalizePatientListResponse(original);
    const [input] = buildPriorityInputs([patient]);
    const calculator = vi.spyOn(news2Calculator, 'computeNEWS2');
    const mpac = computeMPACFromInput(input);
    const alerts = computeAlerts({ vitals: patient.vitals, risks: patient.risks, risksStructured: [] });
    expect.soft(mpac.news2Score).toBe(total);
    expect.soft(alerts.some(alert => alert.id === 'news2-high-with-risk')).toBe(total === 7);
    expect(alerts.some(alert => alert.id === 'risk-fall-no-actions')).toBe(true);
    expect.soft(calculator.mock.calls.length).toBeGreaterThanOrEqual(2);
    for (const [index, [newsInput]] of calculator.mock.calls.entries()) {
      expect.soft(newsInput.temp).toBe(selected);
      expect.soft(calculator.mock.results[index].value.total).toBe(total);
    }
    const sorted = sortPatientsByNEWS2Desc([patient, { id: 'reference', name: 'Reference', news2: 6 }]);
    expect.soft(sorted[0].id).toBe(total === 7 ? patient.id : 'reference');
    expect(patient.vitals).toEqual(original[0].vitals);
    expect(JSON.stringify(original)).toBe(before);
  });
  it.each(['39.1', 'invalid'])('does not introduce numeric-string conversion for %s', tempC => {
    const calculator = vi.spyOn(news2Calculator, 'computeNEWS2');
    expect(computeAlerts({ vitals: { rr: 16, tempC, temp: 37 }, risks: { fall: true } })
      .some(alert => alert.id === 'news2-high-with-risk')).toBe(false);
    expect(calculator).not.toHaveBeenCalled();
  });
});

describe('NEWS2 transient summary context', () => {
  const forbiddenContext = /"(?:o2|legacyOxygen|transientO2Fallback)"\s*:/;
  it.each(oxygenCases.flatMap(entry => [undefined, false, true].map(fallback => ({ ...entry, fallback }))))(
    '$label with optional fallback $fallback preserves parity without mutating or exporting context', async ({ oxygen, expected, label, fallback }) => {
      const values = zHandover.parse({ patientId: 'synthetic', status: 'draft',
        vitals: { rr: 16, spo2: 94, tempC: 39.1, sbp: 120, hr: 111, avpu: 'A' }, oxygenTherapy: oxygen ?? undefined,
        risks: { fall: true },
        dxMedical: { system: SNOMED_SYSTEM, code: snomedTerms[0].code, display: snomedTerms[0].display },
        administrativeData: { unit: 'icu', census: 0, staffIn: ['Synthetic in'], staffOut: ['Synthetic out'],
          shiftStart: '2026-09-29T08:00:00Z', shiftEnd: '2026-09-29T20:00:00Z', shiftType: 'Mañana' },
        bedsideChecklist: { patientIdentityConfirmed: true, allergiesReviewed: true, linesAndDevicesChecked: true,
          medicationPlanReviewed: true, safetyMeasuresApplied: true, questionsAnswered: true },
      });
      const before = JSON.stringify(values);
      const informative = !['absent', 'null', 'empty object', 'empty device', 'whitespace'].includes(label);
      const onOxygen = informative ? expected : fallback === true;
      const total = onOxygen ? 7 : 5;
      const context = { transientO2Fallback: fallback };
      const normal = generateSBARSummary(values, context);
      const minimal = buildMinimalSbarSummary(values, context);
      for (const summary of [normal, minimal, await getBestAvailableSummary(values, { useLocalRules: false, sbarOptions: context })]) {
        expect(summary.assessment).toContain(`NEWS2 ${total} (`);
        expect(summary.situation).toContain(`NEWS2 ${total} (`);
        expect(Object.keys(summary).sort()).toEqual(['assessment', 'background', 'recommendation', 'situation']);
        expect(JSON.stringify(summary)).not.toMatch(forbiddenContext);
      }
      expect(normal.assessment).toContain(onOxygen ? 'crítico riesgo' : 'alto riesgo');
      expect(minimal.assessment).toContain(onOxygen ? 'crítica riesgo' : 'alta riesgo');
      const memoryVitals = withTransientOxygen(values.vitals, () => fallback);
      expect(deriveRiskEvaluationFromValues(memoryVitals, undefined, values.oxygenTherapy).news2?.total).toBe(total);
      expect(computeAlerts({ ...values, vitals: memoryVitals }).some(alert => alert.id === 'news2-high-with-risk')).toBe(onOxygen);
      expect(generateSBARSummary(values).assessment).toContain(`NEWS2 ${expected ? 7 : 5} (`);
      expect(buildMinimalSbarSummary(values).assessment).toContain(`NEWS2 ${expected ? 7 : 5} (`);
      expect(JSON.stringify(values)).toBe(before);
      for (const output of [packRrDraft(values, undefined), buildHandoverInputPayload(values, {}),
        buildHandoverBundle(buildHandoverInputPayload(values, {})), buildExternalAiClinicalContext(values)]) {
        expect(JSON.stringify(output)).not.toMatch(forbiddenContext);
      }
    },
  );

  it.each([false, true])('mounted form keeps normal and minimal summaries current (force minimal: %s)', async minimal => {
    const { default: HandoverForm } = await import('@/src/screens/HandoverForm');
    const prefilledValues = await readOxygenPrefill([{ resourceType: 'Observation', valueString: 'oxygen' }], true);
    const backend = vi.spyOn(aiSbar, 'generateSbarViaBackendResult').mockResolvedValue({ ok: false, error: new aiSbar.AISbarError('UNCONFIGURED', 'synthetic') });
    const nav = { navigate: vi.fn(), setParams: vi.fn(), addListener: () => () => {} };
    const screen = render(<HandoverForm navigation={nav}
      route={{ key: 'summary-context', name: 'HandoverForm', params: { patientId: 'synthetic-sbar-context', unitId: 'icu', prefilledValues } }} />);
    try {
      const form: UseFormReturn<HandoverValues> = screen.root.findByType(FormProvider).props;
      const sbar = () => screen.root.find(node => typeof node.props.handleGenerateSbarWithAi === 'function');
      const verify = async (total: number) => {
        if (minimal) vi.spyOn(summaryBuilders, 'generateSBARSummary').mockImplementationOnce(() => { throw new Error('synthetic fallback'); });
        await act(async () => { await sbar().props.handleGenerateSbarWithAi(); });
        expect(sbar().props.pendingSbarSuggestionPreview).toContain(`NEWS2 ${total} (`);
        expect(screen.root.findByType(VitalsSection).props.riskEvaluation.news2.total).toBe(total);
        expect(JSON.stringify(form.getValues())).not.toMatch(forbiddenContext);
        expect(JSON.stringify(backend.mock.calls)).not.toMatch(forbiddenContext);
      };
      expect(form.getValues('sbarAssessment')).toContain('NEWS2 7 (');
      await verify(7);
      const originalDraft = JSON.stringify(packRrDraft(form.getValues(), undefined));
      if (!screen.queryByPlaceholderText('Cánula / Mascarilla')) fireEvent.press(screen.getByText(/Oxigenoterapia/));
      fireEvent.changeText(screen.getByPlaceholderText('Cánula / Mascarilla'), 'aire ambiente');
      expect(sbar().props.pendingSbarSuggestionPreview).toBeNull();
      expect(form.getValues('sbarAssessment')).toContain('NEWS2 5 (');
      await verify(5);
      fireEvent.changeText(screen.getByPlaceholderText('Cánula / Mascarilla'), 'cánula nasal');
      await verify(7);
      act(() => form.reset(JSON.parse(originalDraft)));
      expect(sbar().props.pendingSbarSuggestionPreview).toBeNull();
      await verify(5);
      act(() => sbar().props.onAcceptPendingSbarSuggestion());
      expect(form.getValues('sbarAssessment')).toContain('NEWS2 5 (');
      act(() => screen.update(<HandoverForm navigation={nav}
        route={{ key: 'summary-next', name: 'HandoverForm', params: { patientId: 'synthetic-sbar-next', unitId: 'icu' } }} />));
      expect(sbar().props.pendingSbarSuggestionPreview).toBeNull();
      await verify(5);
    } finally { screen.unmount(); }
  }, 30000);
  it('does not revive a summary response captured before an oxygen edit', async () => {
    const { default: HandoverForm } = await import('@/src/screens/HandoverForm');
    const prefilledValues = await readOxygenPrefill([{ resourceType: 'Observation', valueString: 'oxygen' }], true);
    let finish: ((result: aiSbar.GenerateSbarViaBackendResult) => void) | undefined;
    const pending = new Promise<aiSbar.GenerateSbarViaBackendResult>(resolve => { finish = resolve; });
    vi.spyOn(aiSbar, 'generateSbarViaBackendResult').mockReturnValue(pending);
    const screen = render(<HandoverForm navigation={{ navigate: vi.fn(), setParams: vi.fn(), addListener: () => () => {} }}
      route={{ key: 'summary-obsolete', name: 'HandoverForm', params: { patientId: 'synthetic-sbar-async', unitId: 'icu', prefilledValues } }} />);
    try {
      const form: UseFormReturn<HandoverValues> = screen.root.findByType(FormProvider).props;
      const sbar = () => screen.root.find(node => typeof node.props.handleGenerateSbarWithAi === 'function');
      let request: Promise<void> | undefined;
      act(() => { request = sbar().props.handleGenerateSbarWithAi(); });
      if (!screen.queryByPlaceholderText('Cánula / Mascarilla')) fireEvent.press(screen.getByText(/Oxigenoterapia/));
      fireEvent.changeText(screen.getByPlaceholderText('Cánula / Mascarilla'), 'aire ambiente');
      await act(async () => {
        finish?.({ ok: true, result: { situation: 'obsolete', background: '', assessment: 'NEWS2 7', recommendation: '', fullText: 'obsolete NEWS2 7' } });
        await request;
      });
      expect(sbar().props.pendingSbarSuggestionPreview).toBeNull();
      expect(form.getValues('sbarAssessment')).toContain('NEWS2 5 (');
    } finally { screen.unmount(); }
  }, 20000);
});

describe('FHIR oxygen administration from measured prefill', () => {
  const cases = [
    { label: 'FiO2 21', observations: [quantityObservation(LOINC.fio2, 21, '%')], therapy: { fio2: 21 }, total: 5, administered: false },
    { label: 'flow 0', observations: [quantityObservation(LOINC.o2Flow, 0, 'L/min')], therapy: { flowLMin: 0 }, total: 5, administered: false },
    { label: 'both ambient', observations: [quantityObservation(LOINC.fio2, 21, '%'), quantityObservation(LOINC.o2Flow, 0, 'L/min')], therapy: { fio2: 21, flowLMin: 0 }, total: 5, administered: false },
    { label: 'room air', observations: [], therapy: { device: 'aire ambiente' }, total: 5, administered: false },
    { label: 'text-only legacy', observations: [{ resourceType: 'Observation', valueString: 'oxygen' }], therapy: {}, total: 7, administered: false },
    { label: 'FiO2 28', observations: [quantityObservation(LOINC.fio2, 28, '%')], therapy: { fio2: 28 }, total: 7, administered: true },
    { label: 'positive flow', observations: [quantityObservation(LOINC.o2Flow, 2, 'L/min')], therapy: { flowLMin: 2 }, total: 7, administered: true },
  ];
  it.each(cases)('$label preserves measurements and maps only real administration after mounted submit', async ({ observations, therapy, total, administered }) => {
    patientListAuth.enabled = true;
    const { default: HandoverForm } = await import('@/src/screens/HandoverForm');
    const prefilledValues = await readOxygenPrefill(observations, true);
    const screen = render(<HandoverForm navigation={{ navigate: vi.fn(), setParams: vi.fn(), addListener: () => () => {} }}
      route={{ key: 'fhir-oxygen', name: 'HandoverForm', params: { patientId: 'synthetic', unitId: 'icu-a', prefilledValues } }} />);
    try {
      const form: UseFormReturn<HandoverValues> = screen.root.findByType(FormProvider).props;
      if ('device' in therapy) act(() => form.setValue('oxygenTherapy', therapy));
      expect(form.getValues('oxygenTherapy')).toMatchObject(therapy);
      expect(screen.root.findByType(VitalsSection).props.riskEvaluation.news2.total).toBe(total);
      act(() => {
        form.setValue('dxMedical', { system: SNOMED_SYSTEM, code: '195967001', display: 'Neumonía' });
        form.setValue('administrativeData.staffIn', ['Synthetic nurse']);
        form.setValue('administrativeData.staffOut', ['Synthetic nurse']);
        form.setValue('fluidBalance', { intakeMl: 0, outputMl: 0 });
        form.setValue('braden', { sensoryPerception: 4, moisture: 4, activity: 4, mobility: 4, nutrition: 4, frictionShear: 4, totalScore: 24, riskLevel: 'sin_riesgo' });
        form.setValue('glasgow', { eye: 4, verbal: 5, motor: 6, total: 15, severity: 'leve' });
        form.setValue('bedsideChecklist', {
          ...form.getValues('bedsideChecklist'), patientIdentityConfirmed: true, allergiesReviewed: true,
          linesAndDevicesChecked: true, medicationPlanReviewed: true, safetyMeasuresApplied: true, questionsAnswered: true,
        });
      });
      const builder = vi.spyOn(fhirMapping, 'buildHandoverBundleAsync');
      enqueueBundleMock.mockClear();
      fireEvent.press(screen.getByText('Guardar borrador'));
      await waitFor(() => expect(builder).toHaveBeenCalled());
      await builder.mock.results[0].value;
      await waitFor(() => expect(enqueueBundleMock).toHaveBeenCalled());
      const bundle = enqueueBundleMock.mock.calls[0][0];
      const resources = bundle.entry.map((entry: { resource: { resourceType: string; code?: { coding?: { code: string }[] } } }) => entry.resource);
      expect(resources.filter((resource: { resourceType: string }) => resource.resourceType === 'DeviceUseStatement')).toHaveLength(0);
      expect(resources.filter((resource: { resourceType: string; code?: { coding?: { code: string }[] } }) => resource.resourceType === 'Procedure' && resource.code?.coding?.[0]?.code === SNOMED.oxygenTherapy)).toHaveLength(administered ? 1 : 0);
      for (const code of observations.flatMap(item => 'code' in item ? [item.code.coding[0].code] : [])) {
        expect(resources.some((resource: { code?: { coding?: { code: string }[] } }) => resource.code?.coding?.[0]?.code === code)).toBe(true);
      }
    } finally { screen.unmount(); }
  }, 30000);

  it.each([
    { device: 'aire ambiente' }, { fio2: 28 }, { flowLMin: 2 }, { device: 'cánula nasal' },
    { device: 'aire ambiente', fio2: 28 }, { deviceDisplay: 'Cánula nasal' },
  ])('maps oxygen administration only for real therapy %j', therapy => {
    const resources = mapDeviceUse({ patientId: 'synthetic', oxygenTherapy: { status: 'in-progress', ...therapy } });
    const administered = 'fio2' in therapy || 'flowLMin' in therapy || therapy.device !== 'aire ambiente';
    expect(resources.some(resource => resource.resourceType === 'Procedure')).toBe(administered);
    expect(resources.some(resource => resource.resourceType === 'DeviceUseStatement')).toBe(administered && ('device' in therapy || 'deviceDisplay' in therapy));
  });

  it('retains explicit historical treatment procedures and their completed/in-progress states', () => {
    const completedOxygen = mapDeviceUse({ patientId: 'synthetic', oxygenTherapy: {
      status: 'completed', device: 'cánula nasal', flowLMin: 2, end: '2026-09-28T12:00:00Z',
    } });
    expect(completedOxygen.find(resource => resource.resourceType === 'Procedure')?.status).toBe('completed');
    const bundle = buildHandoverBundle({
      patientId: 'synthetic', status: 'draft', oxygenTherapy: { status: 'in-progress', fio2: 21 },
      treatments: [
        { id: 'historical-oxygen', type: 'respiratory', description: 'Oxigenoterapia anterior', done: true },
        { id: 'planned-care', type: 'respiratory', description: 'Tratamiento actual', done: false },
      ],
    });
    const procedures = bundle.entry.map(entry => entry.resource).filter(resource => resource.resourceType === 'Procedure');
    expect(procedures.map(resource => resource.status)).toEqual(['completed', 'in-progress']);
  });

  it.each([
    { label: 'completed without measurements', therapy: { status: 'completed' as const }, expectedPeriod: false },
    { label: 'completed with historical metadata', therapy: { status: 'completed' as const, start: '2026-09-27T10:00:00Z', end: '2026-09-28T12:00:00Z', note: 'Terapia concluida' }, expectedPeriod: true },
    { label: 'completed with ambient measurements', therapy: { status: 'completed' as const, fio2: 21, flowLMin: 0, start: '2026-09-27T10:00:00Z', end: '2026-09-28T12:00:00Z', note: 'Terapia concluida' }, expectedPeriod: true },
  ])('$label retains its explicit oxygen Procedure without inventing a device', ({ therapy, expectedPeriod }) => {
    const resources = mapDeviceUse({ patientId: 'synthetic', oxygenTherapy: therapy });
    expect(resources.map(resource => resource.resourceType)).toEqual(['Procedure']);
    const procedure = resources[0];
    expect(procedure.status).toBe('completed');
    if (procedure.resourceType !== 'Procedure') throw new Error('Expected historical Procedure');
    if (expectedPeriod && 'start' in therapy) {
      expect(procedure.performedPeriod).toEqual({
        start: new Date(therapy.start).toISOString(), end: new Date(therapy.end).toISOString(),
      });
      expect(procedure.note).toEqual([{ text: therapy.note }]);
    }
    const bundle = buildHandoverBundle({ patientId: 'synthetic', status: 'draft', oxygenTherapy: therapy });
    expect(bundle.entry.filter(entry => entry.resource.resourceType === 'Procedure')).toHaveLength(1);
    expect(bundle.entry.filter(entry => entry.resource.resourceType === 'DeviceUseStatement')).toHaveLength(0);
    const measurementCodes = bundle.entry.filter(entry => entry.resource.resourceType === 'Observation')
      .map(entry => entry.resource.code?.coding?.[0]?.code);
    if ('fio2' in therapy) expect(measurementCodes).toContain(LOINC.fio2);
    if ('flowLMin' in therapy) expect(measurementCodes).toContain(LOINC.o2Flow);
  });
});

describe('NEWS2 transient oxygen transport', () => {
  const cases = [
    { label: 'fio2 28', observations: [quantityObservation(LOINC.fio2, 28, '%')], therapy: { fio2: 28 }, total: 7 },
    { label: 'fio2 21', observations: [quantityObservation(LOINC.fio2, 21, '%')], therapy: { fio2: 21 }, total: 5 },
    { label: 'zero flow', observations: [quantityObservation(LOINC.o2Flow, 0, 'L/min')], therapy: { flowLMin: 0 }, total: 5 },
    { label: 'positive flow', observations: [quantityObservation(LOINC.o2Flow, 2, 'L/min')], therapy: { flowLMin: 2 }, total: 7 },
    { label: 'text only', observations: [{ resourceType: 'Observation', valueString: 'oxygen' }], therapy: {}, total: 7 },
    { label: 'no evidence', observations: [], therapy: {}, total: 5 },
  ];
  const navigation = () => ({ navigate: vi.fn(), setParams: vi.fn(), addListener: () => () => {} });
  const assertNoLegacy = (value: unknown) => {
    const json = JSON.stringify(value);
    expect(json).not.toMatch(/"(?:o2|legacyOxygen)"\s*:/);
  };
  it('accepts a boolean-only legacy prefill without placing it in form values', async () => {
    const { default: HandoverForm } = await import('@/src/screens/HandoverForm');
    const prefilledValues = { vitals: { rr: 16, spo2: 94, temp: 39.1, sbp: 120, hr: 111, acvpu: 'A' as const, o2: true } };
    const screen = render(<HandoverForm navigation={navigation()}
      route={{ key: 'legacy', name: 'HandoverForm', params: { patientId: 'synthetic-legacy-o2', prefilledValues } }} />);
    try {
      const form: UseFormReturn<HandoverValues> = screen.root.findByType(FormProvider).props;
      expect(screen.root.findByType(VitalsSection).props.riskEvaluation.news2.total).toBe(7);
      act(() => form.setValue('oxygenTherapy', {}));
      expect(screen.root.findByType(VitalsSection).props.riskEvaluation.news2.total).toBe(7);
      assertNoLegacy(form.getValues());
      expect(form.getValues('vitals')).not.toHaveProperty('o2');
    } finally { screen.unmount(); }
  });

  it('invalidates the fallback before the real asynchronous offline restoration', async () => {
    const { default: HandoverForm } = await import('@/src/screens/HandoverForm');
    const prefilledValues = await readOxygenPrefill([{ resourceType: 'Observation', valueString: 'oxygen' }], true);
    const gate = createRrReviewGate();
    gate.observe(8.5);
    gate.observe(16, true);
    const draft = packRrDraft({ patientId: 'synthetic-restore-oxygen',
      administrativeData: { unit: 'icu', census: 0, staffIn: [], staffOut: [],
        shiftStart: '2026-09-29T08:00:00Z', shiftEnd: '2026-09-29T20:00:00Z', shiftType: 'Mañana' },
      vitals: { rr: 16, spo2: 94, tempC: 39.1, sbp: 120, hr: 111, avpu: 'A' }, oxygenTherapy: {} }, gate.snapshot());
    const key = 'handoverDraft:synthetic-restore-oxygen:icu';
    await SecureStore.setItemAsync(key, JSON.stringify(draft));
    const screen = render(<HandoverForm navigation={navigation()}
      route={{ key: 'restoration', name: 'HandoverForm', params: { patientId: 'synthetic-restore-oxygen', unitId: 'icu', prefilledValues } }} />);
    try {
      expect(screen.root.findByType(VitalsSection).props.riskEvaluation.news2.total).toBe(7);
      await act(async () => { await Promise.resolve(); });
      await waitFor(() => expect(screen.root.findByType(VitalsSection).props.riskEvaluation.news2.total).toBe(5));
      const form: UseFormReturn<HandoverValues> = screen.root.findByType(FormProvider).props;
      expect(form.getValues('vitals')).not.toHaveProperty('o2');
      assertNoLegacy(packRrDraft(form.getValues(), undefined));
    } finally { screen.unmount(); await SecureStore.deleteItemAsync(key); }
  }, 20000);
  it.each(cases)('$label reaches the mounted form without hidden persisted oxygen', async ({ observations, therapy, total }) => {
    const { default: HandoverForm } = await import('@/src/screens/HandoverForm');
    const prefilledValues = await readOxygenPrefill(observations, true);
    expect(prefilledValues.news2).toBe(total);
    expect(prefilledValues.priority).toBe(total === 7 ? 'high' : 'medium');
    expect(prefilledValues).toMatchObject({ oxygenTherapy: therapy });
    const calculator = vi.spyOn(news2Calculator, 'computeNEWS2');
    const screen = render(<HandoverForm navigation={navigation()}
      route={{ key: 'transport', name: 'HandoverForm', params: { patientId: 'synthetic-transport', prefilledValues } }} />);
    try {
      const form: UseFormReturn<HandoverValues> = screen.root.findByType(FormProvider).props;
      expect(form.getValues('oxygenTherapy')).toMatchObject(therapy);
      expect(screen.root.findByType(VitalsSection).props.riskEvaluation.news2.total).toBe(total);
      act(() => {
        form.setValue('risks', { fall: true });
        form.setValue('braden', { sensoryPerception: 2, moisture: 2, activity: 2, mobility: 2, nutrition: 2, frictionShear: 2 });
      });
      expect(screen.root.findByType(VitalsSection).props.riskEvaluation.braden.total).toBe(12);
      expect(screen.root.findByType(VitalsSection).props.riskEvaluation.news2.total).toBe(total);
      const reactive = calculator.mock.calls.map(([input], index) => ({ input, result: calculator.mock.results[index] }))
        .filter(({ input }) => !('scale2' in input));
      expect(reactive.length).toBeGreaterThanOrEqual(2);
      for (const { input, result } of reactive) {
        expect(Boolean(input.o2)).toBe(total === 7);
        expect(result.value.total).toBe(total);
        expect(result.value.band).toBe(total === 7 ? 'CRÍTICA' : 'ALTA');
      }
      const values = form.getValues();
      expect(values.vitals).not.toHaveProperty('o2');
      assertNoLegacy(values);
      const draft = packRrDraft(values, undefined);
      assertNoLegacy(draft);
      expect(draft.oxygenTherapy).toMatchObject(therapy);
      const payload = buildHandoverInputPayload(values, {});
      assertNoLegacy(payload);
      assertNoLegacy(buildHandoverBundle(payload));
      assertNoLegacy(buildExternalAiClinicalContext(values));
      if (!Object.keys(therapy).length) {
        expect(values.oxygenTherapy?.fio2).toBeUndefined();
        expect(values.oxygenTherapy?.flowLMin).toBeUndefined();
        expect(values.oxygenTherapy?.device?.trim() ?? '').toBe('');
      }
      await SecureStore.setItemAsync('synthetic-oxygen-roundtrip', JSON.stringify(draft));
      const saved = await SecureStore.getItemAsync('synthetic-oxygen-roundtrip');
      expect(saved).toBe(JSON.stringify(draft));
      calculator.mockClear();
      act(() => form.reset(JSON.parse(saved ?? '{}')));
      expect(screen.root.findByType(VitalsSection).props.riskEvaluation.news2.total)
        .toBe(Object.keys(therapy).length ? total : 5);
    } finally { screen.unmount(); }
  }, 20000);

  it.each(['aire ambiente', 'cánula nasal', ''])('user edit %s permanently invalidates text fallback', async device => {
    const { default: HandoverForm } = await import('@/src/screens/HandoverForm');
    const prefilledValues = await readOxygenPrefill([{ resourceType: 'Observation', valueString: 'oxygen' }], true);
    const screen = render(<HandoverForm navigation={navigation()}
      route={{ key: 'edit', name: 'HandoverForm', params: { patientId: 'synthetic-edit', prefilledValues } }} />);
    try {
      const form: UseFormReturn<HandoverValues> = screen.root.findByType(FormProvider).props;
      expect(screen.root.findByType(VitalsSection).props.riskEvaluation.news2.total).toBe(7);
      if (!screen.queryByPlaceholderText('Cánula / Mascarilla')) fireEvent.press(screen.getByText(/Oxigenoterapia/));
      fireEvent.changeText(screen.getByPlaceholderText('Cánula / Mascarilla'), device);
      expect(screen.root.findByType(VitalsSection).props.riskEvaluation.news2.total).toBe(device === 'cánula nasal' ? 7 : 5);
      fireEvent.changeText(screen.getByPlaceholderText('Cánula / Mascarilla'), '');
      expect(screen.root.findByType(VitalsSection).props.riskEvaluation.news2.total).toBe(5);
      assertNoLegacy(packRrDraft(form.getValues(), undefined));
    } finally { screen.unmount(); }
  }, 20000);

  it('patient change or a new form cannot reuse the previous transient fallback', async () => {
    const { default: HandoverForm } = await import('@/src/screens/HandoverForm');
    const prefilledValues = await readOxygenPrefill([{ resourceType: 'Observation', valueString: 'oxygen' }], true);
    const nav = navigation();
    const screen = render(<HandoverForm navigation={nav}
      route={{ key: 'patient', name: 'HandoverForm', params: { patientId: 'synthetic-first', prefilledValues } }} />);
    try {
      expect(screen.root.findByType(VitalsSection).props.riskEvaluation.news2.total).toBe(7);
      act(() => screen.update(<HandoverForm navigation={nav}
        route={{ key: 'patient', name: 'HandoverForm', params: { patientId: 'synthetic-next' } }} />));
      expect(screen.root.findByType(VitalsSection).props.riskEvaluation.news2.total).toBe(5);
      act(() => screen.update(<HandoverForm navigation={nav}
        route={{ key: 'patient', name: 'HandoverForm', params: { patientId: 'synthetic-first', prefilledValues } }} />));
      expect(screen.root.findByType(VitalsSection).props.riskEvaluation.news2.total).toBe(5);
    } finally { screen.unmount(); }
  }, 20000);
  it.each(oxygenCases.flatMap(entry => [false, true, undefined].map(legacy => ({ ...entry, legacy }))))(
    '$label resolves against transient $legacy without serialization or mutation', ({ oxygen, expected, label, legacy }) => {
      const before = JSON.stringify(oxygen);
      const informative = !['absent', 'null', 'empty object', 'empty device', 'whitespace'].includes(label);
      const resolved = informative ? expected : legacy === true;
      expect(resolveSupplementalOxygen(oxygen, legacy)).toBe(resolved);
      const raw = { rr: 16, spo2: 94, tempC: 39.1, sbp: 120, hr: 111, avpu: 'A' as const };
      const vitals = withTransientOxygen(raw, () => legacy);
      expect(raw).not.toHaveProperty('o2');
      expect(Object.keys(vitals ?? {})).not.toContain('o2');
      assertNoLegacy(vitals);
      expect(deriveRiskEvaluationFromValues(vitals, undefined, oxygen ?? undefined).news2?.total).toBe(resolved ? 7 : 5);
      const alerts = computeAlerts({ vitals, oxygenTherapy: oxygen, risks: { fall: true } });
      expect(alerts.some(alert => alert.id === 'news2-high-with-risk')).toBe(resolved);
      expect(JSON.stringify(oxygen)).toBe(before);
    },
  );
});

describe('NEWS2 prefill oxygen observations', () => {
  it.each(oxygenMagnitudes.flatMap(entry => [entry.ambient, entry.ambient - 1, entry.positive]
    .map(value => ({ ...entry, value, expected: value > entry.ambient }))))(
    '$code quantity $value $unit respects the oxygen threshold and priority', async ({ code, unit, value, expected }) => {
      for (const high of [false, true]) {
        const result = await readOxygenPrefill([quantityObservation(code, value, unit)], high);
        const total = (high ? 5 : 0) + (expected ? 2 : 0);
        expect(result.vitals?.o2).toBe(expected);
        expect(result.news2).toBe(total);
        expect(result.priority).toBe(total >= 7 ? 'high' : total >= 5 ? 'medium' : 'low');
        expect(result).not.toHaveProperty('rrReview');
      }
    },
  );

  it.each(oxygenMagnitudes.flatMap(entry => [false, true].map(positiveLatest => ({ ...entry, positiveLatest })) ))(
    '$code selects the latest valid value, positive latest=$positiveLatest', async ({ code, unit, ambient, positive, positiveLatest }) => {
      const older = quantityObservation(code, positiveLatest ? ambient : positive, unit, '2026-09-28T10:00:00Z');
      const newer = quantityObservation(code, positiveLatest ? positive : ambient, unit);
      const invalidNewest = quantityObservation(code, 'invalid', unit, '2026-09-30T10:00:00Z');
      for (const resources of [[older, invalidNewest, newer], [newer, invalidNewest, older]]) {
        expect((await readOxygenPrefill(resources)).vitals?.o2).toBe(positiveLatest);
      }
    },
  );

  it.each(['issued', 'meta'] as const)('preserves temporal fallback through %s', async clock => {
    const older = quantityObservation(LOINC.fio2, 28, '%', '2026-09-28T10:00:00Z');
    const { effectiveDateTime, ...newer } = quantityObservation(LOINC.fio2, 21, '%');
    const dated = clock === 'issued' ? { ...newer, issued: effectiveDateTime } : { ...newer, meta: { lastUpdated: effectiveDateTime } };
    expect((await readOxygenPrefill([older, dated])).vitals?.o2).toBe(false);
  });

  it.each([[21, 0, false], [21, 2, true], [28, 0, true], [28, 2, true]] as const)(
    'combines latest FiO2 %i and flow %i', async (fio2, flow, expected) => {
      const result = await readOxygenPrefill([
        quantityObservation(LOINC.fio2, 100, '%', '2026-09-28T10:00:00Z'),
        quantityObservation(LOINC.fio2, fio2, '%'), quantityObservation(LOINC.o2Flow, flow, 'L/min'),
      ]);
      expect(result.vitals?.o2).toBe(expected);
    },
  );

  it.each([undefined, null, '', false, '28', 'invalid', NaN, Infinity, -Infinity])('rejects invalid oxygen quantity %s', async value => {
    const resources = oxygenMagnitudes.map(({ code, unit }) => quantityObservation(code, value, unit));
    const fetchImpl = vi.fn<typeof fetch>(async input => {
      const response = new Response();
      vi.spyOn(response, 'json').mockResolvedValue({ resourceType: 'Bundle', entry: String(input).includes('Observation?')
        ? resources.map(resource => ({ resource })) : [] });
      return response;
    });
    expect((await prefillFromFHIR('synthetic', { fhirBase: 'https://fhir.invalid', fetchImpl })).vitals?.o2).toBe(false);
  });

  it.each([undefined, '', '1', 'percent', 'mL/min'])('does not convert unsupported or missing units %s', async unit => {
    const result = await readOxygenPrefill(oxygenMagnitudes.map(({ code, positive }) => quantityObservation(code, positive, unit)));
    expect(result.vitals?.o2).toBe(false);
  });

  it('accepts explicit UCUM codes and rejects incompatible systems', async () => {
    const base = quantityObservation(LOINC.fio2, 28);
    const resource = { ...base, valueQuantity: { value: 28, code: '%', system: TERMINOLOGY_SYSTEMS.UCUM } };
    expect((await readOxygenPrefill([resource])).vitals?.o2).toBe(true);
    expect((await readOxygenPrefill([{ ...resource, valueQuantity: { ...resource.valueQuantity, system: 'urn:unsupported' } }])).vitals?.o2).toBe(false);
  });

  it('keeps text as fallback only when there is no usable structured value', async () => {
    const text = { resourceType: 'Observation', valueString: 'oxygen nasal mask' };
    expect((await readOxygenPrefill([])).vitals?.o2).toBe(false);
    expect((await readOxygenPrefill([text])).vitals?.o2).toBe(true);
    expect((await readOxygenPrefill([text, quantityObservation(LOINC.fio2, 'invalid', '%')])).vitals?.o2).toBe(true);
    for (const { code, unit, ambient } of oxygenMagnitudes) {
      expect((await readOxygenPrefill([text, quantityObservation(code, ambient, unit)])).vitals?.o2).toBe(false);
    }
  });

  it.each([21, 28])('QR passes the corrected prefill and priority for FiO2 %i', async fio2 => {
    vi.stubGlobal('fetch', fetchObservations([...prefillPhysiology(true), quantityObservation(LOINC.fio2, fio2, '%')]));
    const navigate = vi.fn();
    const screen = render(<QRScanScreen navigation={{ navigate }} route={{ key: 'oxygen-qr', name: 'QRScan', params: {} }} />);
    try {
      await act(async () => { fireEvent.press(screen.getByText('scan')); });
      fireEvent.press(screen.getByText('Continuar con entrega'));
      expect(navigate).toHaveBeenCalledWith('HandoverForm', expect.objectContaining({
        prefilledValues: expect.objectContaining({ news2: fio2 === 21 ? 5 : 7, priority: fio2 === 21 ? 'medium' : 'high',
          vitals: expect.objectContaining({ o2: fio2 > 21 }) }),
      }));
    } finally { screen.unmount(); }
  });
});

describe('NEWS2 supplemental oxygen parity', () => {
  it.each(oxygenCases.flatMap(entry => [false, true].map(legacy => ({ ...entry, legacy }))))(
    'alerts prefer $label over legacy oxygen $legacy', ({ oxygen, expected, legacy, label }) => {
      const calculator = vi.spyOn(news2Calculator, 'computeNEWS2');
      const source = {
        vitals: { rr: 16, spo2: 91, tempC: 37, sbp: 120, hr: 131, avpu: 'A', o2: legacy },
        oxygenTherapy: oxygen, risks: { fall: true },
      };
      const before = JSON.stringify(source);
      const nonInformative = ['absent', 'null', 'empty object', 'empty device', 'whitespace'].includes(label);
      const onOxygen = nonInformative ? legacy : expected;
      const alerts = computeAlerts(source);
      expect(calculator).toHaveBeenCalledOnce();
      expect(calculator.mock.calls[0][0].o2).toBe(onOxygen);
      expect(calculator.mock.results[0].value.total).toBe(onOxygen ? 8 : 6);
      expect(alerts.map(alert => alert.id)).toEqual(onOxygen
        ? ['risk-fall-no-actions', 'news2-high-with-risk'] : ['risk-fall-no-actions']);
      expect(JSON.stringify(source)).toBe(before);
    },
  );

  it('alerts preserve the reproduced NEWS2 8 and the active-risk requirement', () => {
    const calculator = vi.spyOn(news2Calculator, 'computeNEWS2');
    const source = {
      vitals: { rr: 16, spo2: 91, tempC: 37, sbp: 120, hr: 131, avpu: 'A' },
      oxygenTherapy: { device: 'cánula nasal', flowLMin: 2, fio2: 28 }, risks: { fall: true },
    };
    expect(computeAlerts(source)).toContainEqual(expect.objectContaining({
      id: 'news2-high-with-risk', severity: 'critical', source: 'vitals',
    }));
    expect(calculator.mock.results[0].value).toMatchObject({ total: 8, o2: 2, anyThree: true, band: 'CRÍTICA' });
    expect(computeAlerts({ ...source, risks: {} })).toEqual([]);
  });

  it('alerts keep the existing RR gate blocked while independent alerts survive', () => {
    const calculator = vi.spyOn(news2Calculator, 'computeNEWS2');
    const gate = createRrReviewGate();
    gate.observe(8.5);
    const source = {
      vitals: { rr: 16, spo2: 91, tempC: 37, sbp: 120, hr: 131, avpu: 'A' },
      oxygenTherapy: { flowLMin: 2 }, risks: { fall: true, pressureUlcer: true }, braden: { totalScore: 12 },
    };
    for (const rr of [8.5, undefined, 11.5, 4, 61, NaN]) {
      const blocked = gate.observe(rr, true);
      expect(blocked).toBe(true);
      expect(computeAlerts(withoutNews2Vitals({ ...source, vitals: { ...source.vitals, rr } }, blocked))
        .map(alert => alert.id)).toEqual(['risk-fall-no-actions', 'risk-pressure-no-actions']);
      expect(calculator).not.toHaveBeenCalled();
    }
    expect(gate.observe(16, true)).toBe(false);
    expect(computeAlerts(source).map(alert => alert.id))
      .toEqual(['risk-fall-no-actions', 'risk-pressure-no-actions', 'news2-high-with-risk']);
  });

  it.each(oxygenCases)('$label determines oxygen without mutating the input', ({ oxygen, expected }) => {
    if (oxygen) Object.freeze(oxygen);
    const before = JSON.stringify(oxygen);
    expect(isSupplementalOxygen(oxygen)).toBe(expected);
    expect(JSON.stringify(oxygen)).toBe(before);
  });

  it.each(oxygenCases.flatMap(entry => [98, 94].map(spo2 => ({ ...entry, spo2 }))))(
    '$label at SpO2 $spo2 agrees across summaries and risk', ({ oxygen, expected, spo2 }) => {
      const vitals = { rr: 16, spo2, tempC: 37, sbp: 120, hr: 110, avpu: 'A' };
      const values = zHandover.parse({
        patientId: 'synthetic', status: 'draft', vitals, oxygenTherapy: oxygen ?? undefined,
        dxMedical: { system: SNOMED_SYSTEM, code: snomedTerms[0].code, display: snomedTerms[0].display },
        administrativeData: { unit: 'icu', census: 0, staffIn: ['Synthetic in'], staffOut: ['Synthetic out'],
          shiftStart: '2026-09-22T08:00:00Z', shiftEnd: '2026-09-22T20:00:00Z', shiftType: 'Mañana', incidents: [] },
        bedsideChecklist: { patientIdentityConfirmed: true, allergiesReviewed: true,
          linesAndDevicesChecked: true, medicationPlanReviewed: true, safetyMeasuresApplied: true, questionsAnswered: true },
        braden: { sensoryPerception: 2, moisture: 2, activity: 2, mobility: 2, nutrition: 2, frictionShear: 2,
          totalScore: 12, riskLevel: 'alto' },
      });
      const before = JSON.stringify(values);
      const canonical = computeNEWS2({ rr: 16, spo2, temp: 37, sbp: 120, hr: 110, avpu: 'A', o2: expected });
      expect(canonical.total).toBe((spo2 === 98 ? 1 : 2) + (expected ? 2 : 0));
      for (const summary of [generateSBARSummary(values), buildMinimalSbarSummary(values)]) {
        expect.soft(summary.situation).toContain(`NEWS2 ${canonical.total} (`);
        expect.soft(summary.assessment).toContain(`NEWS2 ${canonical.total} (`);
      }
      const risk = deriveRiskEvaluationFromValues(values.vitals, values.braden, values.oxygenTherapy);
      expect.soft(risk.news2?.total).toBe(canonical.total);
      expect(risk.braden?.total).toBe(12);
      expect(risk.level).toBe('high');
      expect(JSON.stringify(values)).toBe(before);
    },
  );

  it.each([98, 94])('real form uses the same oxygen decision at SpO2 %i', async spo2 => {
    const { default: HandoverForm } = await import('@/src/screens/HandoverForm');
    const calculator = vi.spyOn(news2Calculator, 'computeNEWS2');
    const screen = render(<HandoverForm navigation={{ navigate: vi.fn(), setParams: vi.fn(), addListener: () => () => {} }}
      route={{ key: 'oxygen-parity', name: 'HandoverForm', params: { patientId: 'synthetic-oxygen' } }} />);
    try {
      const form: UseFormReturn<HandoverValues> = screen.root.findByType(FormProvider).props;
      for (const { oxygen, expected, label } of oxygenCases) {
        calculator.mockClear();
        act(() => {
          form.setValue('vitals', { rr: 16, spo2, tempC: 37, sbp: 120, hr: 110, avpu: 'A' });
          form.setValue('oxygenTherapy', oxygen ?? undefined);
        });
        const calls = calculator.mock.calls.map(([input], index) => ({ input, result: calculator.mock.results[index] }))
          .filter(({ input }) => !('scale2' in input));
        expect(calls.length, label).toBeGreaterThanOrEqual(2);
        for (const { input, result } of calls) {
          expect.soft(Boolean(input.o2), label).toBe(expected);
          expect.soft(result.value.total, label).toBe((spo2 === 98 ? 1 : 2) + (expected ? 2 : 0));
        }
        expect(form.getValues('oxygenTherapy')).toEqual(oxygen ?? undefined);
      }
    } finally {
      screen.unmount();
    }
  }, 30000);
});

describe('NEWS2 integer respiratory input contract', () => {
  it.each([
    { showVitals: true, profileVisible: true },
    { showVitals: false, profileVisible: true },
    { showVitals: true, profileVisible: false },
  ])('owns exactly one visible accessible warning with $showVitals / profile $profileVisible', async ({ showVitals, profileVisible }) => {
    warningVisibility.showVitals = showVitals;
    if (!profileVisible) {
      const resolveRuntime = profileRuntime.resolveHandoverProfileRuntime;
      vi.spyOn(profileRuntime, 'resolveHandoverProfileRuntime').mockImplementation((...args) => {
        const runtime = resolveRuntime(...args);
        return { ...runtime, sectionVisibility: { ...runtime.sectionVisibility, signos: false } };
      });
    }
    const { default: HandoverForm } = await import('@/src/screens/HandoverForm');
    const prefilledValues = await prefillFromFHIR('synthetic', {
      fhirBase: 'https://fhir.invalid', fetchImpl: fetchObservations([observation(8.5)]),
    });
    const screen = render(<HandoverForm navigation={{ navigate: vi.fn(), setParams: vi.fn(), addListener: () => () => {} }}
      route={{ key: 'warning-owner', name: 'HandoverForm', params: { patientId: 'synthetic', prefilledValues } }} />);
    try {
      const notices = () => screen.root.findAll(node => typeof node.type === 'string' && node.props.children === message);
      const announcements = () => screen.root.findAll(node => typeof node.type === 'string' &&
        node.props.children === message && node.props.accessibilityRole === 'alert');
      expect(notices()).toHaveLength(1);
      expect(announcements()).toHaveLength(1);
      if (showVitals && profileVisible) {
        expect(screen.root.findByType(VitalsSection).findAll(node =>
          typeof node.type === 'string' && node.props.children === message)).toHaveLength(1);
        fireEvent.press(screen.getByLabelText('Sección Signos vitales. Expandida.'));
        expect(screen.root.findAllByType(VitalsSection)).toHaveLength(0);
        expect(notices()).toHaveLength(1);
        expect(announcements()).toHaveLength(1);
        fireEvent.press(screen.getByLabelText('Sección Signos vitales. Contraída.'));
        expect(notices()).toHaveLength(1);
        expect(announcements()).toHaveLength(1);
        expect(screen.getByPlaceholderText('16').props.value).toBe('8.5');
        fireEvent.changeText(screen.getByPlaceholderText('16'), '16');
        expect(notices()).toHaveLength(0);
        expect(announcements()).toHaveLength(0);
      } else {
        expect(screen.root.findAllByType(VitalsSection)).toHaveLength(0);
      }
    } finally {
      screen.unmount();
    }
  }, 20000);

  it('persists and restores a cleared pending field through the real offline form route', async () => {
    const { default: HandoverForm } = await import('@/src/screens/HandoverForm');
    const prefilledValues = await prefillFromFHIR('synthetic', {
      fhirBase: 'https://fhir.invalid', fetchImpl: fetchObservations([observation(8.5)]),
    });
    const navigation = { navigate: vi.fn(), setParams: vi.fn(), addListener: () => () => {} };
    const write = vi.spyOn(SecureStore, 'setItemAsync');
    const screen = render(<HandoverForm navigation={navigation}
      route={{ key: 'handover', name: 'HandoverForm', params: { patientId: 'synthetic', unitId: 'icu', prefilledValues } }} />);
    if (!screen.queryByPlaceholderText('16')) fireEvent.press(screen.getByText(/Signos vitales/));
    fireEvent.changeText(screen.getByPlaceholderText('16'), '');
    await act(async () => {
      screen.root.find(node => typeof node.props.onSaveDraft === 'function').props.onSaveDraft();
    });
    const saved = write.mock.calls.find(([key]) => key.startsWith('handoverDraft:'));
    expect(saved).toBeDefined();
    const snapshot: RrDraft = JSON.parse(saved?.[1] ?? '{}');
    expect(snapshot.vitals?.rr).toBeUndefined();
    expect(snapshot.news2RrReview).toEqual({ originalValue: 8.5, source: 'fhir', unit: '/min',
      observedAt: '2026-09-22T10:00:00Z', reason: 'RR_NON_INTEGER', resolution: 'pending' });
    expect(saved?.[1]).not.toContain('forbidden-');
    screen.unmount();
    const read = vi.spyOn(SecureStore, 'getItemAsync');
    const restored = render(<HandoverForm navigation={navigation}
      route={{ key: 'restore', name: 'HandoverForm', params: { patientId: 'synthetic', unitId: 'icu' } }} />);
    await act(async () => { await Promise.resolve(); });
    expect(read).toHaveBeenCalledWith(saved?.[0]);
    expect(restored.root.find(node => typeof node.props.getValues === 'function').props.formState.dirtyFields).toEqual({});
    await waitFor(() => expect(restored.getByText(message)).toBeTruthy());
    if (!restored.queryByPlaceholderText('16')) fireEvent.press(restored.getByText(/Signos vitales/));
    expect(restored.getByPlaceholderText('16').props.value).toBe('');
    fireEvent.changeText(restored.getByPlaceholderText('16'), '11.5');
    expect(restored.getByText(message)).toBeTruthy();
    fireEvent.changeText(restored.getByPlaceholderText('16'), '16');
    expect(restored.queryByText(message)).toBeNull();
    restored.unmount();
  }, 20000);

  it('discards an obsolete backend response in the real HandoverForm', async () => {
    const { default: HandoverForm } = await import('@/src/screens/HandoverForm');
    let finish: ((result: aiSbar.GenerateSbarViaBackendResult) => void) | undefined;
    const pending = new Promise<aiSbar.GenerateSbarViaBackendResult>(resolve => { finish = resolve; });
    const backend = vi.spyOn(aiSbar, 'generateSbarViaBackendResult').mockReturnValue(pending);
    const screen = render(<HandoverForm navigation={{ navigate: vi.fn(), setParams: vi.fn(), addListener: () => () => {} }}
      route={{ key: 'async', name: 'HandoverForm', params: { patientId: 'synthetic', unitId: 'icu', prefilledValues: { vitals: { rr: 16 } } } }} />);
    if (!screen.queryByPlaceholderText('16')) fireEvent.press(screen.getByText(/Signos vitales/));
    const sbar = () => screen.root.find(node => typeof node.props.handleGenerateSbarWithAi === 'function');
    let request: Promise<void> | undefined;
    act(() => { request = sbar().props.handleGenerateSbarWithAi(); });
    expect(backend).toHaveBeenCalledOnce();
    fireEvent.changeText(screen.getByPlaceholderText('16'), '8.5');
    fireEvent.changeText(screen.getByPlaceholderText('16'), '');
    fireEvent.changeText(screen.getByPlaceholderText('16'), '16');
    await act(async () => {
      finish?.({ ok: true, result: { situation: 'obsolete', background: '', assessment: 'NEWS2 0', recommendation: '', fullText: 'obsolete NEWS2 0' } });
      await request;
    });
    expect(sbar().props.pendingSbarSuggestionPreview).toBeNull();
    expect(JSON.stringify(backend.mock.calls)).not.toContain('RR_NON_INTEGER');
    screen.unmount();
  });
  it('blocks the real HandoverForm until manual correction without changing the decimal', async () => {
    const { default: HandoverForm } = await import('@/src/screens/HandoverForm');
    const prefilledValues = await prefillFromFHIR('synthetic', {
      fhirBase: 'https://fhir.invalid', fetchImpl: fetchObservations([observation(8.5)]),
    });
    const screen = render(<HandoverForm navigation={{ navigate: vi.fn(), setParams: vi.fn(), addListener: () => () => {} }}
      route={{ key: 'handover', name: 'HandoverForm', params: { patientId: 'synthetic', prefilledValues } }} />);
    expect(screen.getByText(message)).toBeTruthy();
    if (!screen.queryByPlaceholderText('16')) fireEvent.press(screen.getByText(/Signos vitales/));
    const field = screen.getByPlaceholderText('16');
    expect(field.props.value).toBe('8.5');
    fireEvent.changeText(field, '');
    expect(screen.getByText(message)).toBeTruthy();
    fireEvent.changeText(field, '16');
    expect(screen.queryByText(message)).toBeNull();
    screen.unmount();
  });
  it('shows the exact QR warning and permits continuing with the intact decimal', async () => {
    vi.stubGlobal('fetch', fetchObservations([observation(8.5)]));
    const navigate = vi.fn();
    const screen = render(<QRScanScreen navigation={{ navigate }} route={{ key: 'qr', name: 'QRScan', params: {} }} />);
    await act(async () => { fireEvent.press(screen.getByText('scan')); });
    expect(fetch).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText(message)).toBeTruthy());
    expect(screen.queryByText(/NEWS2\s+\d|prioridad\s+(baja|media|alta)/i)).toBeNull();
    fireEvent.press(screen.getByText('Continuar con entrega'));
    expect(navigate).toHaveBeenCalledWith('HandoverForm', expect.objectContaining({
      prefilledValues: expect.objectContaining({ vitals: expect.objectContaining({ rr: 8.5 }) }),
    }));
    screen.unmount();
  });

  it('releases the visible block only after a valid manual integer', () => {
    const screen = render(<PendingVitals />);
    const field = screen.getByPlaceholderText('16');
    expect(field.props.value).toBe('8.5');
    for (const text of ['', '11.5', '4', '61']) {
      fireEvent.changeText(field, text);
      expect(screen.getByText(message)).toBeTruthy();
    }
    fireEvent.changeText(field, '16');
    expect(screen.queryByText(message)).toBeNull();
    expect(field.props.value).toBe('16');
    screen.unmount();
  });

  it.each(['8.5', '11.5', '20.5'])('parses strict numeric text %s without retaining the text', async value => {
    const result = await prefillFromFHIR('synthetic', {
      fhirBase: 'https://fhir.invalid', fetchImpl: fetchObservations([observation(value)]),
    });
    expect(result.rrReview?.originalValue).toBe(Number(value));
    expect(result.vitals?.rr).toBe(Number(value));
    for (const property of forbiddenResults) expect(result).not.toHaveProperty(property);
    expect(JSON.stringify(result)).not.toContain('forbidden-');
  });

  it.each(['8.5 notes', ' 8.5 ', '', 'Infinity', 'NaN', '0x10', Infinity, NaN, null])('rejects non-strict input %s', value => {
    expect(parseRespiratoryRate(value)).toBeUndefined();
  });

  it('never falls back to an earlier integer observation', async () => {
    const result = await prefillFromFHIR('synthetic', {
      fhirBase: 'https://fhir.invalid',
      fetchImpl: fetchObservations([observation(16, '2026-09-21T10:00:00Z'), observation(20.5)]),
    });
    expect(result.vitals?.rr).toBe(20.5);
    expect(result).not.toHaveProperty('news2');
  });

  it('sanitizes metadata by allowlist and preserves offline blocking after deletion', async () => {
    const gate = createRrReviewGate();
    gate.observe(8.5);
    gate.observe(undefined, true);
    const poisoned = { ...gate.snapshot(), resource: observation(8.5), id: 'forbidden-id',
      subject: 'forbidden-patient', encounter: 'forbidden-encounter', performer: 'forbidden-performer',
      note: 'forbidden-note', extension: 'forbidden-extension', unit: 'forbidden-unit', observedAt: 'forbidden-date' };
    const snapshot = packRrDraft({ vitals: {} }, poisoned);
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('forbidden-');
    expect(serialized).not.toContain('Observation');
    await SecureStore.setItemAsync('handoverDraft:synthetic:unit', serialized);
    const raw = await SecureStore.getItemAsync('handoverDraft:synthetic:unit');
    const restored: RrDraft = JSON.parse(raw ?? '{}');
    const unpacked = unpackRrDraft(restored);
    expect(Object.keys(restored.news2RrReview ?? {}).sort()).toEqual(['originalValue', 'reason', 'resolution', 'source']);
    expect(unpacked.values).not.toHaveProperty('news2RrReview');
    const fresh = createRrReviewGate();
    expect(fresh.restore(unpacked.values.vitals?.rr, unpacked.review)).toBe(true);
    expect(fresh.observe(16)).toBe(true);
    expect(fresh.observe(16, true)).toBe(false);
    expect(fresh.snapshot()?.originalValue).toBe(8.5);
  });

  it('reconstructs legacy drafts and cannot erase a pending review by restoring another snapshot', () => {
    const gate = createRrReviewGate();
    expect(gate.restore(11.5, undefined)).toBe(true);
    expect(gate.snapshot()?.source).toBe('legacy-draft');
    expect(gate.restore(undefined, undefined)).toBe(true);
    expect(gate.restore(16, undefined)).toBe(true);
    expect(gate.observe(16, true)).toBe(false);
    const fresh = createRrReviewGate();
    expect(fresh.restore(16, gate.snapshot())).toBe(false);
    expect(fresh.observe(20.5, true)).toBe(true);
  });

  it('accepts only finite numeric originals and safe optional metadata', () => {
    const metadata = { originalValue: 8.5, source: 'fhir', reason: 'RR_NON_INTEGER', resolution: 'pending' };
    for (const originalValue of ['8.5', NaN, Infinity, 16]) {
      expect(readRrReview({ ...metadata, originalValue })).toBeUndefined();
    }
    expect(readRrReview({ ...metadata, unit: '/min', observedAt: '2026-09-22T10:00:00Z' }))
      .toMatchObject({ unit: '/min', observedAt: '2026-09-22T10:00:00Z' });
  });

  it('keeps review metadata outside real FHIR and external-AI export paths', () => {
    const gate = createRrReviewGate();
    gate.observe(8.5);
    gate.observe(16, true);
    const base = zHandover.parse({
      patientId: 'synthetic', status: 'draft', vitals: { rr: 16 },
      dxMedical: { system: SNOMED_SYSTEM, code: snomedTerms[0].code, display: snomedTerms[0].display },
      administrativeData: { unit: 'icu', census: 0, staffIn: ['Synthetic in'], staffOut: ['Synthetic out'],
        shiftStart: '2026-09-22T08:00:00Z', shiftEnd: '2026-09-22T20:00:00Z', shiftType: 'Mañana', incidents: [] },
      bedsideChecklist: { patientIdentityConfirmed: true, allergiesReviewed: true,
        linesAndDevicesChecked: true, medicationPlanReviewed: true, safetyMeasuresApplied: true, questionsAnswered: true },
    });
    const packed = packRrDraft(base, { ...gate.snapshot(), resource: observation(8.5), id: 'forbidden-id' });
    const values = zHandover.parse(unpackRrDraft(packed).values);
    const payload = buildHandoverInputPayload(values, {});
    const bundle = buildHandoverBundle(payload);
    const external = buildExternalAiClinicalContext(values);
    for (const output of [values, payload, bundle, external]) {
      const serialized = JSON.stringify(output);
      for (const forbidden of ['news2RrReview', 'originalValue', 'RR_NON_INTEGER', 'forbidden-']) {
        expect(serialized).not.toContain(forbidden);
      }
    }
  });

  it('invalidates asynchronous results even after correcting back to the previous integer', async () => {
    const gate = createRrReviewGate();
    gate.observe(16);
    const token = gate.capture();
    const response = Promise.resolve(computeNEWS2({ rr: 16 }));
    gate.observe(8.5, true);
    gate.observe(undefined, true);
    gate.observe(16, true);
    await response;
    expect(gate.isCurrent(token)).toBe(false);
    const current = gate.capture();
    expect(gate.isCurrent(current)).toBe(true);
    gate.invalidate();
    expect(gate.isCurrent(current)).toBe(false);
  });

  it('preserves Braden and independent risk alerts without NEWS2', () => {
    const braden = { sensoryPerception: 2, moisture: 2, activity: 2, mobility: 2, nutrition: 2, frictionShear: 2 };
    const evaluation = deriveRiskEvaluationFromValues(undefined, braden, undefined);
    expect(evaluation.news2).toBeNull();
    expect(evaluation.braden?.total).toBe(12);
    expect(evaluation.level).toBe('high');
    const values = { vitals: { rr: 8.5, spo2: 80, hr: 140 }, risks: { fall: true }, braden };
    const independent = withoutNews2Vitals(values, true);
    expect(values.vitals.rr).toBe(8.5);
    expect(independent).not.toHaveProperty('vitals');
    expect(computeAlerts(independent).map(alert => alert.id)).toEqual(['risk-fall-no-actions']);
    expect(withoutNews2Vitals(values, false)).toBe(values);
  });

  it.each([5, 8, 9, 11, 12, 20, 21, 24, 25, 60])('preserves integer RR %s and existing Scale 1/2 oxygen scores', async rr => {
    expect(zVitals.innerType().shape.rr.safeParse(rr).success).toBe(true);
    const gate = createRrReviewGate();
    expect(gate.observe(rr)).toBe(false);
    const result = await prefillFromFHIR('synthetic', {
      fhirBase: 'https://fhir.invalid', fetchImpl: fetchObservations([observation(rr)]),
    });
    expect(result.news2).toBe(computeNEWS2({ rr }).total);
    expect(result.priority).toBeDefined();
    expect(result).not.toHaveProperty('rrReview');
    for (const scale2 of [false, true]) for (const o2 of [false, true]) {
      const input = { rr, spo2: 94, scale2, o2 };
      const projected = withoutNews2Vitals({ vitals: input }, gate.observe(rr));
      expect(computeNEWS2(projected.vitals)).toEqual(computeNEWS2(input));
      expect(computeNEWS2(input).o2).toBe(o2 ? 2 : 0);
    }
  });
  it.each([8.5, 11.5, 20.5])('keeps RR %s without returning scores or priority', async rr => {
    const result = await prefillFromFHIR('synthetic', {
      fhirBase: 'https://fhir.invalid', fetchImpl: fetchObservations([observation(rr)]),
    });
    expect(result.vitals?.rr).toBe(rr);
    for (const property of forbiddenResults) expect(result).not.toHaveProperty(property);
    expect(result).toHaveProperty('rrReview.resolution', 'pending');
  });

  it('keeps the review warning after clearing the decimal field', () => {
    const screen = render(<PendingVitals />);
    fireEvent.changeText(screen.getByPlaceholderText('16'), '');
    expect(screen.queryByText(message)).not.toBeNull();
    expect(screen.queryByText('Riesgo bajo')).toBeNull();
    screen.unmount();
  });
});
