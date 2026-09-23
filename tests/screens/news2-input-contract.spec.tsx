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
import { buildHandoverBundle } from '@/src/lib/fhir-map';
import { createRrReviewGate, packRrDraft, unpackRrDraft, readRrReview, parseRespiratoryRate, withoutNews2Vitals, type RrDraft } from '@/src/lib/news2-input';
import { computeNEWS2 } from '@/src/lib/news2';
import { computeAlerts } from '@/src/lib/alerts';
import { buildExternalAiClinicalContext } from '@/src/lib/ai-sbar';
import * as aiSbar from '@/src/lib/ai-sbar';
import { buildHandoverInputPayload } from '@/src/screens/handover/submission';
import QRScanScreen from '@/src/screens/QRScan';
import { snomedTerms, SNOMED_SYSTEM } from '@/src/data/snomed-dict';

vi.mock('@/src/components/VitalSignsChart', () => ({ default: () => null }));
vi.mock('@/src/screens/components/VitalTrendsChart', () => ({ VitalTrendsChart: () => null }));
vi.mock('@/src/components/ClinicalSuggestions', () => ({ default: () => null }));
vi.mock('@/src/config/flags', () => ({ isOn: (name: string) => ['SHOW_VITALS', 'SHOW_OXY', 'SHOW_SBAR'].includes(name) }));
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
vi.mock('expo-camera', () => ({
  CameraView: ({ onBarcodeScanned }: { onBarcodeScanned?: (result: { data: string }) => void }) =>
    <Text onPress={() => onBarcodeScanned?.({ data: '{"patientId":"synthetic","server":"https://fhir.invalid"}' })}>scan</Text>,
  useCameraPermissions: () => [{ granted: true }, vi.fn()],
}));
vi.mock('@/src/hooks/usePatientSummary', () => ({
  usePatientSummary: () => ({ loading: false, error: null, summary: null }),
}));
vi.mock('@/src/security/auth', () => ({
  useAuth: () => ({ session: null }), ensureFreshAccessToken: async () => null, getSession: async () => null,
}));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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

function fetchObservations(resources: ReturnType<typeof observation>[]): typeof fetch {
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

describe('NEWS2 integer respiratory input contract', () => {
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
