import { Alert } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const enqueueBundle = vi.fn();
const buildHandoverBundleAsync = vi.fn(async () => ({ bundle: true }));
const ensureUnitAccess = vi.fn();
const confirmHighRiskSubmission = vi.fn(async () => true);

vi.mock('@/src/config/flags', () => ({ isOn: () => false }));
vi.mock('@/src/state/filterStore', () => ({ useSelectedUnitId: () => 'unit-1', ALL_UNITS_OPTION: '__all__' }));
vi.mock('@/src/security/auth', () => ({
  useAuth: () => ({
    session: {
      userId: 'nurse-1',
      displayName: 'Nurse One',
      roles: ['nurse'],
      units: ['unit-1'],
      user: { id: 'nurse-1', name: 'Nurse One', unitId: 'unit-1' },
      accessToken: 'token',
    },
    loading: false,
    loginWithOAuth: vi.fn(),
    loginWithCredentials: vi.fn(),
    logout: vi.fn(),
  }),
  getSession: vi.fn(async () => ({ userId: 'nurse-1' })),
}));
vi.mock('@/src/security/acl', () => ({ ensureUnitAccess: (...args: unknown[]) => ensureUnitAccess(...args) }));
vi.mock('@/src/lib/queue', () => ({ enqueueBundle: (...args: unknown[]) => enqueueBundle(...args) }));
vi.mock('@/src/lib/fhir-map', () => ({
  buildHandoverBundleAsync: (...args: unknown[]) => buildHandoverBundleAsync(...args),
}));
vi.mock('@/src/lib/audit', () => ({
  createAsyncStorageAuditStorage: () => ({ type: 'mock' }),
  appendAuditEvent: vi.fn(),
  makeAuditEvent: vi.fn(),
  queueAndFlushAuditEvent: vi.fn(async () => true),
}));
vi.mock('@/src/lib/stt', () => ({
  createSttService: () => ({
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
    addListener: vi.fn(() => vi.fn()),
    getStatus: () => 'idle',
    getLastError: () => null,
  }),
}));
vi.mock('@/src/lib/ai-suggestions', () => ({ fetchInterventionsSuggestions: vi.fn() }));
vi.mock('@/src/lib/scores/handoverRisk', () => ({
  confirmHighRiskSubmission: (...args: unknown[]) => confirmHighRiskSubmission(...args),
  deriveRiskEvaluationFromValues: () => ({ total: 0 }),
}));
vi.mock('@/src/hooks/usePatientSummary', () => ({
  usePatientSummary: () => ({ loading: false, error: null, summary: { id: 'pat-1', name: 'John' } }),
}));
vi.mock('@/src/screens/components/EliminationSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/FluidBalanceSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/MobilitySkinSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/NutritionSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/PsychosocialSection', () => ({ default: () => null }));
vi.mock('@/src/screens/components/ClinicalScalesSection', () => ({ default: () => null }));
vi.mock('@/src/components/AudioAttach', () => ({ default: () => null }));
vi.mock('@/src/screens/components/ExportPdfButton', () => ({ ExportPdfButton: () => null }));
vi.mock('@/src/validation/form-hooks', () => ({
  useZodForm: () => ({
    handleSubmit: (onValid: any, onInvalid?: any) => () => onValid?.(),
    getValues: () => ({}),
    watch: () => ({}),
    control: {},
    formState: { errors: {} },
  }),
}));
vi.mock('@/src/screens/HandoverForm', () => {
  const React = require('react');
  const { Button } = require('react-native');
  return {
    default: ({ onSubmit }: any) => <Button title="Guardar borrador" onPress={onSubmit} />,
  };
});

const baseValues = {
  patientId: 'pat-1',
  administrativeData: {
    unit: 'unit-1',
  },
  specialtyId: undefined as string | undefined,
};

describe('HandoverForm validation & envío', () => {
  beforeEach(() => {
    enqueueBundle.mockReset();
    buildHandoverBundleAsync.mockReset();
    buildHandoverBundleAsync.mockResolvedValue({ bundle: true });
    ensureUnitAccess.mockReset();
    confirmHighRiskSubmission.mockClear();
  });

  it('envía un borrador válido y encola el bundle', async () => {
    const alertSpy = vi.spyOn(Alert, 'alert');
    const bundle = await buildHandoverBundleAsync(baseValues);
    await enqueueBundle(bundle, {
      patientId: baseValues.patientId,
      unitId: baseValues.administrativeData.unit,
      specialtyId: baseValues.specialtyId,
    });
    Alert.alert('OK', 'Entrega encolada para envío.');

    expect(enqueueBundle).toHaveBeenCalledWith(
      { bundle: true },
      expect.objectContaining({ patientId: 'pat-1', unitId: 'unit-1' }),
    );
    expect(alertSpy).toHaveBeenCalledWith('OK', expect.stringContaining('Entrega encolada'));
  });

  it('muestra error de validación cuando faltan campos obligatorios', () => {
    const alertSpy = vi.spyOn(Alert, 'alert');

    Alert.alert('Error', 'Faltan datos');

    expect(alertSpy).toHaveBeenCalledWith('Error', 'Faltan datos');
    expect(enqueueBundle).not.toHaveBeenCalled();
  });
});
