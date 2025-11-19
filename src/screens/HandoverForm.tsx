import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Controller, FormProvider, useFieldArray, type Control, type FieldErrors } from 'react-hook-form';

import { isOn } from '@/src/config/flags';
import AudioAttach from '@/src/components/AudioAttach';
import { hashHex } from '@/src/lib/crypto';
import { buildHandoverBundle } from '@/src/lib/fhir-map';
import { computeNEWS2 } from '@/src/lib/news2';
import {
  createSttService,
  type SttConfig,
  type SttErrorCode,
  type SttService,
  type SttStatus,
} from '@/src/lib/stt';
import { enqueueBundle } from '@/src/lib/queue';
import type { RootStackParamList } from '@/src/navigation/types';
import { currentUser, hasUnitAccess } from '@/src/security/acl';
import { getSession, type Session } from '@/src/security/auth';
import { ALL_UNITS_OPTION, useSelectedUnitId } from '@/src/state/filterStore';
import type { AdministrativeData } from '@/src/types/administrative';
import { useZodForm } from '@/src/validation/form-hooks';
import { zHandover, type HandoverValues as HandoverFormValues } from '@/src/validation/schemas';
import SpecificCareSection from './components/SpecificCareSection';
import ClinicalScalesSection from './components/ClinicalScalesSection';

const styles = StyleSheet.create({
  container: { flexGrow: 1, padding: 16 },
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
});

type Props = NativeStackScreenProps<RootStackParamList, 'HandoverForm'>;
type HandoverFormControl = Control<HandoverFormValues>;
type HandoverFormErrors = FieldErrors<HandoverFormValues>;

type DictationField = 'evolution' | 'closingSummary';

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
      encoding: 'base64' as any,
    });
    const info = await FileSystem.getInfoAsync(uri);
    const reportedSize = typeof (info as any).size === 'number' ? (info as any).size : undefined;
    const size = reportedSize ?? Math.floor((dataBase64.length * 3) / 4);
    return {
      dataBase64,
      size,
      hash: hashHex(dataBase64),
      contentType: 'audio/m4a',
      title: 'Audio de entrega',
    } as const;
  } catch (error) {
    console.warn('[handover] audio attachment error', error);
    return undefined;
  }
}

function VitalsGroup({
  control,
  parseNumber,
  errors,
}: {
  control: HandoverFormControl;
  parseNumber: (value: string) => number | undefined;
  errors: HandoverFormErrors;
}) {
  const fields: Array<{
    name: `vitals.${string}`;
    label: string;
    placeholder: string;
    keyboard?: 'default' | 'numeric';
    errorPath: string[];
  }> = [
    { name: 'vitals.hr', label: 'Frecuencia cardíaca (/min)', placeholder: '80', keyboard: 'numeric', errorPath: ['vitals', 'hr'] },
    { name: 'vitals.rr', label: 'Frecuencia respiratoria (/min)', placeholder: '16', keyboard: 'numeric', errorPath: ['vitals', 'rr'] },
    { name: 'vitals.tempC', label: 'Temperatura (°C)', placeholder: '37.2', keyboard: 'numeric', errorPath: ['vitals', 'tempC'] },
    { name: 'vitals.spo2', label: 'SpO₂ (%)', placeholder: '96', keyboard: 'numeric', errorPath: ['vitals', 'spo2'] },
    { name: 'vitals.sbp', label: 'TA sistólica (mmHg)', placeholder: '118', keyboard: 'numeric', errorPath: ['vitals', 'sbp'] },
    { name: 'vitals.dbp', label: 'TA diastólica (mmHg)', placeholder: '75', keyboard: 'numeric', errorPath: ['vitals', 'dbp'] },
    { name: 'vitals.glucoseMgDl', label: 'Glucemia (mg/dL)', placeholder: '110', keyboard: 'numeric', errorPath: ['vitals', 'glucoseMgDl'] },
    { name: 'vitals.glucoseMmolL', label: 'Glucemia (mmol/L)', placeholder: '6.1', keyboard: 'numeric', errorPath: ['vitals', 'glucoseMmolL'] },
  ];

  return (
    <View>
      <View style={styles.vitalsGrid}>
        {fields.map((item) => {
          const errorValue = item.errorPath.reduce<unknown>((acc, key) => {
            if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
              return (acc as Record<string, unknown>)[key];
            }
            return undefined;
          }, errors);
          const errorMessage =
            typeof (errorValue as { message?: unknown } | undefined)?.message === 'string'
              ? (errorValue as { message?: string }).message
              : undefined;
          return (
            <View key={item.name as string} style={styles.vitalsCell}>
              <View style={styles.field}>
                <Text style={styles.label}>{item.label}</Text>
                <Controller
                  control={control}
                  name={item.name}
                  render={({ field: { onChange, onBlur, value } }) => (
                    <TextInput
                      style={styles.input}
                      keyboardType={item.keyboard === 'numeric' ? 'numeric' : 'default'}
                      placeholder={item.placeholder}
                      onBlur={onBlur}
                      value={value == null ? '' : String(value)}
                      onChangeText={(text) => onChange(parseNumber(text))}
                    />
                  )}
                />
                {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
              </View>
            </View>
          );
        })}
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>AVPU</Text>
        <Controller
          control={control}
          name="vitals.avpu"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={styles.input}
              placeholder="A / C / V / P / U"
              autoCapitalize="characters"
              onBlur={onBlur}
              value={value ?? ''}
              onChangeText={(text) => onChange(text.trim().toUpperCase().slice(0, 1) || undefined)}
            />
          )}
        />
        {errors?.vitals?.avpu?.message ? (
          <Text style={styles.error}>{errors.vitals.avpu.message}</Text>
        ) : null}
      </View>
    </View>
  );
}

function OxygenGroup({
  control,
  parseNumber,
  errors,
}: {
  control: HandoverFormControl;
  parseNumber: (value: string) => number | undefined;
  errors: HandoverFormErrors;
}) {
  const deviceError = errors?.oxygenTherapy?.device?.message as string | undefined;
  const flowError = errors?.oxygenTherapy?.flowLMin?.message as string | undefined;
  const fio2Error = errors?.oxygenTherapy?.fio2?.message as string | undefined;
  return (
    <View>
      <View style={styles.field}>
        <Text style={styles.label}>Dispositivo</Text>
        <Controller
          control={control}
          name="oxygenTherapy.device"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={styles.input}
              placeholder="Cánula / Mascarilla"
              onBlur={onBlur}
              value={value ?? ''}
              onChangeText={onChange}
            />
          )}
        />
        {deviceError ? <Text style={styles.error}>{deviceError}</Text> : null}
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>Flujo O₂ (L/min)</Text>
        <Controller
          control={control}
          name="oxygenTherapy.flowLMin"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              placeholder="2"
              onBlur={onBlur}
              value={value == null ? '' : String(value)}
              onChangeText={(text) => onChange(parseNumber(text))}
            />
          )}
        />
        {flowError ? <Text style={styles.error}>{flowError}</Text> : null}
      </View>
      <View style={styles.field}>
        <Text style={styles.label}>FiO₂ (%)</Text>
        <Controller
          control={control}
          name="oxygenTherapy.fio2"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              placeholder="30"
              onBlur={onBlur}
              value={value == null ? '' : String(value)}
              onChangeText={(text) => onChange(parseNumber(text))}
            />
          )}
        />
        {fio2Error ? <Text style={styles.error}>{fio2Error}</Text> : null}
      </View>
    </View>
  );
}

function StaffListInput({
  control,
  name,
  label,
  placeholder,
  error,
}: {
  control: HandoverFormControl;
  name: 'administrativeData.staffIn' | 'administrativeData.staffOut';
  label: string;
  placeholder: string;
  error?: string;
}) {
  const { fields, append, remove } = useFieldArray({ control, name });

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {fields.map((field, index) => (
        <View key={field.id} style={[styles.row, { marginBottom: 8 }]}>
          <View style={styles.flex}>
            <Controller
              control={control}
              name={`${name}.${index}` as const}
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  style={styles.input}
                  placeholder={`${placeholder} ${index + 1}`}
                  onBlur={onBlur}
                  value={value ?? ''}
                  onChangeText={onChange}
                />
              )}
            />
          </View>
          <View style={styles.spacer} />
          <Button title="Eliminar" onPress={() => remove(index)} />
        </View>
      ))}
      <View style={styles.inlineActions}>
        <Button title="Añadir" onPress={() => append('')} />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

export default function HandoverForm({ navigation, route }: Props) {
  const { patientId: patientIdParam, unitId: unitIdParam, specialtyId } = route.params ?? {};
  const [session, setSession] = useState<Session | null>(null);
  const selectedUnitId = useSelectedUnitId();

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

  const form = useZodForm(zHandover, {
    administrativeData: {
      unit: unitIdParam ?? '',
      census: 0,
      staffIn: [],
      staffOut: [],
      shiftStart: new Date().toISOString(),
      shiftEnd: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
      incidents: [],
    },
    patientId: patientIdParam ?? '',
    dxMedical: '',
    dxNursing: '',
    evolution: '',
    closingSummary: '',
    meds: '',
    sbarSituation: '',
    sbarBackground: '',
    sbarAssessment: '',
    sbarRecommendation: '',
    vitals: {},
    oxygenTherapy: {},
    fluidBalance: {
      intakeMl: undefined,
      outputMl: undefined,
      netBalanceMl: undefined,
      notes: '',
    },
    painAssessment: {
      hasPain: false,
      evaScore: null,
      location: null,
      actionsTaken: null,
    },
  });

  const { control, formState } = form;
  const errors: HandoverFormErrors = formState.errors ?? {};
  const administrativeErrors = errors.administrativeData ?? {};
  const unitError = administrativeErrors.unit?.message as string | undefined;
  const censusError = administrativeErrors.census?.message as string | undefined;
  const startError = administrativeErrors.shiftStart?.message as string | undefined;
  const endError = administrativeErrors.shiftEnd?.message as string | undefined;
  const staffInError = administrativeErrors.staffIn?.message as string | undefined;
  const staffOutError = administrativeErrors.staffOut?.message as string | undefined;
  const patientError = errors.patientId?.message as string | undefined;
  const medsError = errors.meds?.message as string | undefined;
  const dxMedicalError = errors.dxMedical?.message as string | undefined;
  const dxNursingError = errors.dxNursing?.message as string | undefined;
  const evolutionError = errors.evolution?.message as string | undefined;
  const closingSummaryError = errors.closingSummary?.message as string | undefined;
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
      if (!target) {
        return;
      }
      if (!result.isFinal) {
        setDictatedPartial(result.text);
        return;
      }
      const trimmed = result.text.trim();
      if (trimmed) {
        const merged = mergeDictationText(form.getValues(target), trimmed);
        form.setValue(target, merged, { shouldDirty: true });
      }
      setDictatedPartial('');
      setActiveDictationField(null);
      setLastDictationField(target);
    });
    return () => {
      unsubscribe();
      void service.cancel();
    };
  }, [form]);

  const dictationUnavailable = sttError === 'UNSUPPORTED' || sttServiceRef.current?.getLastError() === 'UNSUPPORTED';

  const handleDictationPress = async (field: DictationField, config: SttConfig) => {
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
      } catch (error) {
        console.warn('[handover] stt stop error', error);
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
    } catch (error) {
      console.warn('[handover] stt start error', error);
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
    if (dictationUnavailable && field === 'evolution') {
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
    if (lastDictationField === field && sttError && sttError !== 'UNSUPPORTED') {
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

  const parseNumericInput = (value: string) => {
    if (value === '') return undefined;
    const normalized = value.replace(',', '.');
    const parsed = Number(normalized);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  const onScanPress = () => {
    const routeNames = (navigation as any)?.getState?.()?.routeNames ?? ([] as string[]);
    if (routeNames.includes('QRScan')) {
      navigation.navigate('QRScan' as never, { returnTo: 'HandoverForm' } as never);
    } else {
      Alert.alert('Escáner no disponible', 'Esta build no incluye la pantalla de QR (opcional para demo).');
    }
  };

  const onSubmit = form.handleSubmit(
    async (values) => {
      try {
        const normalizeUnit = (value?: string | null) => {
          if (typeof value !== 'string') return undefined;
          const trimmed = value.trim();
          if (!trimmed || trimmed === ALL_UNITS_OPTION) return undefined;
          return trimmed;
        };

        const unitFromForm = normalizeUnit(values.administrativeData?.unit);
        const unitFromNav = normalizeUnit(unitIdParam ?? route.params?.unitId);
        const unitFromStore = normalizeUnit(selectedUnitId);
        const unitEffective = unitFromForm ?? unitFromNav ?? unitFromStore ?? undefined;

        const user = currentUser();
        const hasAccess = hasUnitAccess(unitEffective, user);
        if (!hasAccess) {
          Alert.alert('Sin acceso a la unidad');
          return;
        }

        const meds = (values.meds ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);

        const medications = meds.map((med) => ({ status: 'active' as const, display: med }));
        const oxygenTherapyInput = values.oxygenTherapy ?? {};
        const hasOxygenValues =
          oxygenTherapyInput.device ||
          oxygenTherapyInput.flowLMin != null ||
          oxygenTherapyInput.fio2 != null;

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
          incidents: values.administrativeData.incidents?.filter(Boolean),
        };

        const nowIso = new Date().toISOString();
        const bundle = buildHandoverBundle(
          {
            patientId: values.patientId,
            author: session?.user?.id
              ? { id: session.user.id, display: session.user.name }
              : undefined,
            vitals: values.vitals,
            medications,
            oxygenTherapy,
            audioAttachment: audioAttachment ?? undefined,
            composition: { title: 'Clinical handover summary' },
            administrativeData,
            closingSummary: values.closingSummary,
            sbar: {
              situation: values.sbarSituation,
              background: values.sbarBackground,
              assessment: values.sbarAssessment,
              recommendation: values.sbarRecommendation,
            },
            painAssessment: values.painAssessment,
          },
          { now: () => nowIso },
        );

        await enqueueBundle(bundle, {
          patientId: values.patientId,
          unitId: administrativeData.unit,
          specialtyId,
        });

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
            avpu: vitals.avpu as any,
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
      } catch (error: any) {
        const message = error?.message ?? 'No se pudo guardar';
        Alert.alert('Error', message);
      }
    },
    (error) => {
      const message = error?.message ?? 'No se pudo guardar';
      Alert.alert('Error', message);
    },
  );

  return (
    <FormProvider {...form}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.section}>
        <Text style={styles.sectionTitle}>Datos del turno</Text>
        <View style={styles.field}>
          <Text style={styles.label}>Unidad</Text>
          <Controller
            control={control}
            name="administrativeData.unit"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={styles.input}
                placeholder="UCI Adulto"
                onBlur={onBlur}
                value={value ?? ''}
                onChangeText={onChange}
              />
            )}
          />
          {unitError ? <Text style={styles.error}>{unitError}</Text> : null}
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Censo de pacientes</Text>
          <Controller
            control={control}
            name="administrativeData.census"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={styles.input}
                placeholder="0"
                keyboardType="numeric"
                onBlur={onBlur}
                value={value == null ? '' : String(value)}
                onChangeText={(text) => onChange(parseNumericInput(text))}
              />
            )}
          />
          {censusError ? <Text style={styles.error}>{censusError}</Text> : null}
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Inicio de turno</Text>
          <Controller
            control={control}
            name="administrativeData.shiftStart"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={styles.input}
                placeholder="2024-01-01T08:00"
                onBlur={onBlur}
                value={value ?? ''}
                onChangeText={onChange}
              />
            )}
          />
          {startError ? <Text style={styles.error}>{startError}</Text> : null}
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Fin de turno</Text>
          <Controller
            control={control}
            name="administrativeData.shiftEnd"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={styles.input}
                placeholder="2024-01-01T20:00"
                onBlur={onBlur}
                value={value ?? ''}
                onChangeText={onChange}
              />
            )}
          />
          {endError ? <Text style={styles.error}>{endError}</Text> : null}
        </View>
        <StaffListInput
          control={control}
          name="administrativeData.staffIn"
          label="Personal entrante"
          placeholder="Nombre"
          error={staffInError}
        />
        <StaffListInput
          control={control}
          name="administrativeData.staffOut"
          label="Personal saliente"
          placeholder="Nombre"
          error={staffOutError}
        />
      </View>

      <View style={styles.section}>
        <View style={styles.field}>
          <Text style={styles.label}>Paciente</Text>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Controller
                control={control}
                name="patientId"
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    style={styles.input}
                    placeholder="Paciente"
                    onBlur={onBlur}
                    value={value ?? ''}
                    onChangeText={onChange}
                  />
                )}
              />
            </View>
            <View style={styles.spacer} />
            <Button title="Escanear" onPress={onScanPress} />
          </View>
          {patientError ? <Text style={styles.error}>{patientError}</Text> : null}
        </View>
      </View>

      {isOn('SHOW_SBAR') && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>SBAR</Text>
          <View style={styles.field}>
            <Text style={styles.label}>SBAR - Situation</Text>
            <Controller
              control={control}
              name="sbarSituation"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  style={[styles.input, styles.textArea]}
                  multiline
                  onBlur={onBlur}
                  value={value ?? ''}
                  onChangeText={onChange}
                />
              )}
            />
            {sbarSituationError ? <Text style={styles.error}>{sbarSituationError}</Text> : null}
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>SBAR - Background</Text>
            <Controller
              control={control}
              name="sbarBackground"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  style={[styles.input, styles.textArea]}
                  multiline
                  onBlur={onBlur}
                  value={value ?? ''}
                  onChangeText={onChange}
                />
              )}
            />
            {sbarBackgroundError ? <Text style={styles.error}>{sbarBackgroundError}</Text> : null}
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>SBAR - Assessment</Text>
            <Controller
              control={control}
              name="sbarAssessment"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  style={[styles.input, styles.textArea]}
                  multiline
                  onBlur={onBlur}
                  value={value ?? ''}
                  onChangeText={onChange}
                />
              )}
            />
            {sbarAssessmentError ? <Text style={styles.error}>{sbarAssessmentError}</Text> : null}
          </View>
          <View style={styles.field}>
            <Text style={styles.label}>SBAR - Recommendation</Text>
            <Controller
              control={control}
              name="sbarRecommendation"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  style={[styles.input, styles.textArea]}
                  multiline
                  onBlur={onBlur}
                  value={value ?? ''}
                  onChangeText={onChange}
                />
              )}
            />
            {sbarRecommendationError ? <Text style={styles.error}>{sbarRecommendationError}</Text> : null}
          </View>
        </View>
      )}

      {isOn('SHOW_VITALS') && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Signos vitales</Text>
          <VitalsGroup control={control} parseNumber={parseNumericInput} errors={errors} />
        </View>
      )}

      {isOn('SHOW_OXY') && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Oxigenoterapia</Text>
          <OxygenGroup control={control} parseNumber={parseNumericInput} errors={errors} />
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Cuidados específicos</Text>
        <SpecificCareSection
          control={control}
          errors={errors}
          parseNumber={parseNumericInput}
          setValue={form.setValue}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Escalas clínicas</Text>
        <ClinicalScalesSection />
      </View>

      {isOn('SHOW_MEDS') && (
        <View style={styles.section}>
          <View style={styles.field}>
            <Text style={styles.label}>Medicaciones (separadas por coma)</Text>
            <Controller
              control={control}
              name="meds"
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  style={[styles.input, styles.textArea]}
                  multiline
                  placeholder="Paracetamol 1g, Omeprazol 20mg"
                  onBlur={onBlur}
                  value={value ?? ''}
                  onChangeText={onChange}
                />
              )}
            />
            {medsError ? <Text style={styles.error}>{medsError}</Text> : null}
          </View>
        </View>
      )}

      {isOn('SHOW_ATTACH') && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Adjuntos</Text>
          <AudioAttach
            onRecorded={(uri) => form.setValue('audioUri', uri, { shouldDirty: true })}
            onAttach={(uri) => form.setValue('audioUri', uri, { shouldDirty: true })}
          />
        </View>
      )}

      <View style={styles.section}>
        <View style={styles.field}>
          <Text style={styles.label}>Diagnósticos médicos</Text>
          <Controller
            control={control}
            name="dxMedical"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={[styles.input, styles.textArea]}
                multiline
                placeholder="Diagnósticos médicos"
                onBlur={onBlur}
                value={value ?? ''}
                onChangeText={onChange}
              />
            )}
          />
          {dxMedicalError ? <Text style={styles.error}>{dxMedicalError}</Text> : null}
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Diagnósticos de enfermería</Text>
          <Controller
            control={control}
            name="dxNursing"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={[styles.input, styles.textArea]}
                multiline
                placeholder="Diagnósticos de enfermería"
                onBlur={onBlur}
                value={value ?? ''}
                onChangeText={onChange}
              />
            )}
          />
          {dxNursingError ? <Text style={styles.error}>{dxNursingError}</Text> : null}
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Evolución</Text>
          <View style={styles.dictationRow}>
            <View style={styles.flex}>
              <Controller
                control={control}
                name="evolution"
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    multiline
                    placeholder="Notas de evolución"
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
          {evolutionError ? <Text style={styles.error}>{evolutionError}</Text> : null}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Resumen / cierre de turno</Text>
          <View style={styles.dictationRow}>
            <View style={styles.flex}>
              <Controller
                control={control}
                name="closingSummary"
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    style={[styles.input, styles.textArea]}
                    multiline
                    placeholder="Resumen breve para el equipo entrante"
                    onBlur={onBlur}
                    value={value ?? ''}
                    onChangeText={onChange}
                  />
                )}
              />
            </View>
            <DictationMicButton
              active={activeDictationField === 'closingSummary' && sttStatus === 'listening'}
              disabled={dictationUnavailable}
              label="Dictar cierre"
              onPress={() =>
                handleDictationPress('closingSummary', {
                  locale: 'es-ES',
                  interimResults: true,
                  maxSeconds: 60,
                })
              }
            />
          </View>
          {renderDictationStatus('closingSummary')}
          {closingSummaryError ? <Text style={styles.error}>{closingSummaryError}</Text> : null}
        </View>
      </View>

      <View style={styles.buttonRow}>
        <Button title="Guardar" onPress={onSubmit} />
      </View>
    </ScrollView>
    </FormProvider>
  );
}
