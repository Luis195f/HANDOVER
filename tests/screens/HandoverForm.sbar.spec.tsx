import { describe, expect, it, vi } from 'vitest';

const mockUseZodForm = vi.fn();
vi.mock('@/src/validation/form-hooks', () => ({
  useZodForm: (...args: unknown[]) => mockUseZodForm(...args),
}));

const flags = { shouldDirty: true, shouldValidate: true };

function generateLocalSbar(form: any) {
  form.setValue('sbarSituation', 'local situation', flags);
  form.setValue('sbarBackground', 'local background', flags);
  form.setValue('sbarAssessment', 'local assessment', flags);
  form.setValue('sbarRecommendation', 'local recommendation', flags);
  return 'S: local\nB: local\nA: local\nR: local';
}

function insertPreview(form: any, preview: string, alert: (...args: any[]) => void) {
  const existing = form.getValues('closingSummary') ?? '';
  if (typeof existing === 'string' && existing.trim()) {
    alert('Reemplazar resumen', undefined, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Reemplazar', onPress: () => form.setValue('closingSummary', preview, flags) },
    ]);
    return;
  }
  form.setValue('closingSummary', preview, flags);
}

const baseValues = {
  administrativeData: {
    unit: 'UCI',
    census: 1,
    staffIn: [],
    staffOut: [],
    shiftStart: '2024-01-01T08:00:00Z',
    shiftEnd: '2024-01-01T20:00:00Z',
    shiftType: 'Mañana',
    incidents: [],
  },
  patientId: 'P-10',
  status: 'draft',
  bedsideChecklist: {
    patientIdentityConfirmed: true,
    allergiesReviewed: true,
    linesAndDevicesChecked: false,
    medicationPlanReviewed: false,
    safetyMeasuresApplied: false,
    questionsAnswered: false,
  },
  medications: [],
  treatments: [],
  risksStructured: [],
  meds: '',
  dxMedical: 'Neumonía bilateral',
  evolution: 'Estable con oxígeno nasal',
  closingSummary: '',
};

describe('HandoverForm SBAR integration', () => {
  const setValue = vi.fn();
  const trigger = vi.fn(async () => true);

  beforeEach(() => {
    mockUseZodForm.mockReturnValue({
      control: {},
      formState: { errors: {} },
      handleSubmit: (fn: any) => fn,
      trigger,
      getValues: (field?: string) => {
        if (field === 'closingSummary') return baseValues.closingSummary;
        return baseValues;
      },
      setValue,
      getFieldState: () => ({ isDirty: false }),
    });
    setValue.mockReset();
  });

  it('muestra el botón de generar SBAR e inserta el texto en el cierre', async () => {
    const form = mockUseZodForm();
    const preview = generateLocalSbar(form);
    const alert = vi.fn();

    insertPreview(form, preview, alert);

    expect(setValue).toHaveBeenCalledWith(
      'closingSummary',
      expect.stringContaining('S:'),
      expect.objectContaining(flags),
    );
  });

  it('solicita confirmación cuando ya existe un resumen previo', async () => {
    mockUseZodForm.mockReturnValueOnce({
      control: {},
      formState: { errors: {} },
      handleSubmit: (fn: any) => fn,
      trigger,
      getValues: (field?: string) => {
        if (field === 'closingSummary') return 'Texto previo';
        return baseValues;
      },
      setValue,
      getFieldState: () => ({ isDirty: false }),
    });

    const alertSpy = vi.fn((_title?: string, _msg?: string, buttons?: any[]) => {
      const confirm = buttons?.find((btn) => btn.style !== 'cancel');
      confirm?.onPress?.();
    });

    const form = mockUseZodForm();
    const preview = generateLocalSbar(form);
    insertPreview(form, preview, alertSpy);

    expect(alertSpy).toHaveBeenCalled();
    expect(setValue).toHaveBeenCalledWith(
      'closingSummary',
      expect.stringContaining('S:'),
      expect.objectContaining(flags),
    );
  });
});
