import React, { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Controller } from 'react-hook-form';

import { isOn } from '@/src/config/flags';
import AudioAttach from '@/src/components/AudioAttach';
import { hashHex } from '@/src/lib/crypto';
import { buildHandoverBundle } from '@/src/lib/fhir-map';
import { computeNEWS2 } from '@/src/lib/news2';
import { enqueueBundle } from '@/src/lib/queue';
import type { RootStackParamList } from '@/src/navigation/types';
import { currentUser, hasUnitAccess } from '@/src/security/acl';
import { getSession, type Session } from '@/src/security/auth';
import { ALL_UNITS_OPTION, useSelectedUnitId } from '@/src/state/filterStore';
import { useZodForm } from '@/src/validation/form-hooks';
import { zHandover } from '@/src/validation/schemas';

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
  vitalsGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  vitalsCell: { width: '50%', paddingHorizontal: 6, marginBottom: 12 },
});

type Props = NativeStackScreenProps<RootStackParamList, 'HandoverForm'>;

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
  control: ReturnType<typeof useZodForm>['control'];
  parseNumber: (value: string) => number | undefined;
  errors: any;
}) {
  const fields: Array<{
    name: any;
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
          const errorMessage = item.errorPath.reduce<any>((acc, key) => acc?.[key], errors)?.message;
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
  control: ReturnType<typeof useZodForm>['control'];
  parseNumber: (value: string) => number | undefined;
  errors: any;
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
    unitId: unitIdParam ?? '',
    start: new Date().toISOString(),
    end: new Date(Date.now() + 4 * 3600 * 1000).toISOString(),
    patientId: patientIdParam ?? '',
    staffIn: '',
    staffOut: '',
    dxMedical: '',
    dxNursing: '',
    evolution: '',
    meds: '',
    sbarSituation: '',
    sbarBackground: '',
    sbarAssessment: '',
    sbarRecommendation: '',
    vitals: {},
    oxygenTherapy: {},
  });

  const { control, formState } = form;
  const errors: any = formState.errors ?? {};
  const unitError = errors.unitId?.message as string | undefined;
  const startError = errors.start?.message as string | undefined;
  const endError = errors.end?.message as string | undefined;
  const staffInError = errors.staffIn?.message as string | undefined;
  const staffOutError = errors.staffOut?.message as string | undefined;
  const patientError = errors.patientId?.message as string | undefined;
  const medsError = errors.meds?.message as string | undefined;
  const dxMedicalError = errors.dxMedical?.message as string | undefined;
  const dxNursingError = errors.dxNursing?.message as string | undefined;
  const evolutionError = errors.evolution?.message as string | undefined;
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
      const fieldState = form.getFieldState?.('unitId');
      const current = form.getValues('unitId');
      if (!fieldState?.isDirty && current !== unitIdParam) {
        form.setValue('unitId', unitIdParam, {
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

        const unitFromForm = normalizeUnit(values.unitId);
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
            sbar: {
              situation: values.sbarSituation,
              background: values.sbarBackground,
              assessment: values.sbarAssessment,
              recommendation: values.sbarRecommendation,
            },
          },
          { now: () => nowIso },
        );

        await enqueueBundle(bundle, {
          patientId: values.patientId,
          unitId: unitEffective,
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
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.section}>
        <View style={styles.field}>
          <Text style={styles.label}>Unidad</Text>
          <Controller
            control={control}
            name="unitId"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={styles.input}
                placeholder="Unidad"
                onBlur={onBlur}
                value={value ?? ''}
                onChangeText={onChange}
              />
            )}
          />
          {unitError ? <Text style={styles.error}>{unitError}</Text> : null}
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Inicio</Text>
          <Controller
            control={control}
            name="start"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={styles.input}
                placeholder="Inicio (ISO)"
                onBlur={onBlur}
                value={value ?? ''}
                onChangeText={onChange}
              />
            )}
          />
          {startError ? <Text style={styles.error}>{startError}</Text> : null}
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Fin</Text>
          <Controller
            control={control}
            name="end"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={styles.input}
                placeholder="Fin (ISO)"
                onBlur={onBlur}
                value={value ?? ''}
                onChangeText={onChange}
              />
            )}
          />
          {endError ? <Text style={styles.error}>{endError}</Text> : null}
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Enfermería entrante</Text>
          <Controller
            control={control}
            name="staffIn"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={styles.input}
                placeholder="Entrante"
                onBlur={onBlur}
                value={value ?? ''}
                onChangeText={onChange}
              />
            )}
          />
          {staffInError ? <Text style={styles.error}>{staffInError}</Text> : null}
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Enfermería saliente</Text>
          <Controller
            control={control}
            name="staffOut"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={styles.input}
                placeholder="Saliente"
                onBlur={onBlur}
                value={value ?? ''}
                onChangeText={onChange}
              />
            )}
          />
          {staffOutError ? <Text style={styles.error}>{staffOutError}</Text> : null}
        </View>
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
          {evolutionError ? <Text style={styles.error}>{evolutionError}</Text> : null}
        </View>
      </View>

      <View style={styles.buttonRow}>
        <Button title="Guardar" onPress={onSubmit} />
      </View>
    </ScrollView>
  );
}
