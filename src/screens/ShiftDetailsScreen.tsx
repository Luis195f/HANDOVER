import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Controller, useFieldArray, type Control, type FieldErrors } from 'react-hook-form';

import type { RootStackParamList } from '@/src/navigation/types';
import { useSelectedUnitId } from '@/src/state/filterStore';
import { SHIFT_TYPES, type AdministrativeData } from '@/src/types/administrative';
import { useZodForm } from '@/src/validation/form-hooks';
import { zAdministrativeData } from '@/src/validation/schemas';
import { useThemeTokens } from '@/src/theme';
import { PrimaryButton } from '@/src/components/PrimaryButton';
import { SecondaryButton } from '@/src/components/SecondaryButton';
import { SectionCard } from '@/src/components/SectionCard';
import { t } from '@/src/i18n';

type Props = NativeStackScreenProps<RootStackParamList, 'ShiftDetails'>;
type ShiftDetailsControl = Control<AdministrativeData>;
type ShiftDetailsErrors = FieldErrors<AdministrativeData>;

type StaffListInputProps = {
  control: ShiftDetailsControl;
  name: 'staffIn' | 'staffOut';
  label: string;
  error?: string;
  styles: ReturnType<typeof createStyles>;
  placeholderTextColor: string;
};

type IncidentListInputProps = {
  control: ShiftDetailsControl;
  name: 'incidents';
  label: string;
  helper?: string;
  error?: string;
  styles: ReturnType<typeof createStyles>;
  placeholderTextColor: string;
};

const createStyles = ({
  colors,
  fontSizes,
  spacing,
  radius,
}: ReturnType<typeof useThemeTokens>) =>
  StyleSheet.create({
    container: { flexGrow: 1, padding: spacing.lg, backgroundColor: colors.background },
    field: { marginBottom: spacing.md },
    label: { fontSize: fontSizes.base, fontWeight: '500', marginBottom: spacing.xs, color: colors.text },
    input: {
      borderColor: colors.border,
      borderWidth: 1,
      borderRadius: radius.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      fontSize: fontSizes.base,
      backgroundColor: colors.surface,
      color: colors.text,
    },
    textArea: { height: 120, textAlignVertical: 'top' },
    row: { flexDirection: 'row', alignItems: 'center' },
    flex: { flex: 1 },
    spacer: { width: spacing.sm },
    inlineActions: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
    buttonRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    error: { color: colors.danger, marginTop: spacing.xs },
    helper: { color: colors.muted, marginTop: spacing.xs },
    optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
    optionButton: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    optionButtonSelected: { backgroundColor: colors.info, borderColor: colors.info },
    optionText: { color: colors.text, fontWeight: '500' },
    optionTextSelected: { color: colors.onPrimary, fontWeight: '600' },
  });

const deriveShiftType = (shiftStartValue?: string | null) => {
  if (!shiftStartValue) return SHIFT_TYPES[0];
  const date = new Date(shiftStartValue);
  const hours = date.getHours();
  if (Number.isNaN(hours)) return SHIFT_TYPES[0];
  if (hours >= 6 && hours < 14) return SHIFT_TYPES[0];
  if (hours >= 14 && hours < 22) return SHIFT_TYPES[1];
  return SHIFT_TYPES[2];
};

function StaffListInput({
  control,
  name,
  label,
  error,
  styles,
  placeholderTextColor,
}: StaffListInputProps) {
  const { fields, append, remove } = useFieldArray({
    control: control as any,
    name: name as any,
  });

  return (
    <View style={styles.field}>
      <Text allowFontScaling style={styles.label}>{label}</Text>
      {fields.map((field, index) => (
        <View key={field.id} style={[styles.row, { marginBottom: 8 }]}>
          <View style={styles.flex}>
            <Controller
              control={control}
              name={`${name}.${index}` as const}
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  style={styles.input}
                  placeholder={t('shiftDetails.staffPlaceholder', { index: index + 1 })}
                  placeholderTextColor={placeholderTextColor}
                  accessibilityLabel={label}
                  accessibilityHint={t('shiftDetails.staffHint')}
                  allowFontScaling
                  onBlur={onBlur}
                  value={value ?? ''}
                  onChangeText={onChange}
                />
              )}
            />
          </View>
          <View style={styles.spacer} />
          <SecondaryButton
            label={t('common.remove')}
            onPress={() => remove(index)}
            accessibilityHint={t('shiftDetails.removeStaffHint', { index: index + 1 })}
          />
        </View>
      ))}
      <View style={styles.inlineActions}>
        <SecondaryButton
          label={t('common.add')}
          onPress={() => append('')}
          accessibilityHint={t('shiftDetails.addStaffHint')}
        />
      </View>
      {error ? <Text allowFontScaling style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function IncidentListInput({
  control,
  name,
  label,
  helper,
  error,
  styles,
  placeholderTextColor,
}: IncidentListInputProps) {
  const { fields, append, remove } = useFieldArray({
    control: control as any,
    name: name as any,
  });

  return (
    <View style={styles.field}>
      <Text allowFontScaling style={styles.label}>{label}</Text>
      {fields.map((field, index) => (
        <View key={field.id} style={[styles.row, { marginBottom: 8 }]}>
          <View style={styles.flex}>
            <Controller
              control={control}
              name={`${name}.${index}` as const}
              render={({ field: { onChange, onBlur, value } }) => (
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder={t('shiftDetails.incidentsPlaceholder', { index: index + 1 })}
                  placeholderTextColor={placeholderTextColor}
                  accessibilityLabel={label}
                  accessibilityHint={t('shiftDetails.incidentsHint')}
                  allowFontScaling
                  onBlur={onBlur}
                  multiline
                  value={value ?? ''}
                  onChangeText={onChange}
                />
              )}
            />
          </View>
          <View style={styles.spacer} />
          <SecondaryButton
            label={t('common.remove')}
            onPress={() => remove(index)}
            accessibilityHint={t('shiftDetails.removeIncidentHint', { index: index + 1 })}
          />
        </View>
      ))}
      <View style={styles.inlineActions}>
        <SecondaryButton
          label={t('common.add')}
          onPress={() => append('')}
          accessibilityHint={t('shiftDetails.addIncidentHint')}
        />
      </View>
      {helper ? <Text allowFontScaling style={styles.helper}>{helper}</Text> : null}
      {error ? <Text allowFontScaling style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function buildInitialAdministrativeData(
  params: Props['route']['params'],
  selectedUnitId: string,
): AdministrativeData {
  const provided = params?.administrativeData;
  const shiftStartDefault = provided?.shiftStart ?? new Date().toISOString();
  const shiftEndDefault = provided?.shiftEnd ?? new Date(Date.now() + 4 * 3600 * 1000).toISOString();
  return {
    unit: provided?.unit ?? selectedUnitId ?? '',
    census: provided?.census ?? 0,
    staffIn: provided?.staffIn ?? [],
    staffOut: provided?.staffOut ?? [],
    shiftStart: shiftStartDefault,
    shiftEnd: shiftEndDefault,
    shiftType: provided?.shiftType ?? deriveShiftType(shiftStartDefault),
    generalNotes: provided?.generalNotes ?? undefined,
    incidents: provided?.incidents ?? [],
  };
}

export default function ShiftDetailsScreen({ navigation, route }: Props) {
  const themeTokens = useThemeTokens();
  const styles = useMemo(() => createStyles(themeTokens), [themeTokens]);
  const selectedUnitId = useSelectedUnitId();
  const initialAdministrativeData = useMemo(
    () => buildInitialAdministrativeData(route.params, selectedUnitId),
    [route.params, selectedUnitId],
  );

  const form = useZodForm(zAdministrativeData, initialAdministrativeData);
  const { control, formState } = form;
  const errors: ShiftDetailsErrors = formState.errors;

  const unitError = errors.unit?.message as string | undefined;
  const censusError = errors.census?.message as string | undefined;
  const startError = errors.shiftStart?.message as string | undefined;
  const endError = errors.shiftEnd?.message as string | undefined;
  const staffInError = errors.staffIn?.message as string | undefined;
  const staffOutError = errors.staffOut?.message as string | undefined;
  const shiftTypeError = errors.shiftType?.message as string | undefined;
  const generalNotesError = errors.generalNotes?.message as string | undefined;
  const incidentsError = errors.incidents?.message as string | undefined;

  const parseNumericInput = (value: string) => {
    if (value === '') return undefined;
    const normalized = value.replace(',', '.');
    const parsed = Number(normalized);
    return Number.isNaN(parsed) ? undefined : parsed;
  };

  const shiftTypeLabels: Record<(typeof SHIFT_TYPES)[number], string> = {
    Mañana: t('shiftDetails.shiftType.morning'),
    Tarde: t('shiftDetails.shiftType.afternoon'),
    Noche: t('shiftDetails.shiftType.night'),
  };

  const onSubmit = form.handleSubmit((values) => {
    const target = route.params?.returnTo ?? 'HandoverForm';
    if (target === 'PatientList') {
      navigation.navigate('PatientList');
      return;
    }
    navigation.navigate(target, { administrativeData: values });
  });

  const onCancel = () => {
    navigation.goBack();
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <SectionCard title={t('shiftDetails.unitSectionTitle')}>
        <View style={styles.field}>
          <Text allowFontScaling style={styles.label}>{t('shiftDetails.unitLabel')}</Text>
          <Controller
            control={control}
            name="unit"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={styles.input}
                placeholder={t('shiftDetails.unitPlaceholder')}
                placeholderTextColor={themeTokens.colors.muted}
                accessibilityLabel={t('shiftDetails.unitLabel')}
                accessibilityHint={t('shiftDetails.unitHint')}
                allowFontScaling
                onBlur={onBlur}
                value={value ?? ''}
                onChangeText={onChange}
              />
            )}
          />
          {unitError ? <Text allowFontScaling style={styles.error}>{unitError}</Text> : null}
        </View>
        <View style={styles.field}>
          <Text allowFontScaling style={styles.label}>{t('shiftDetails.censusLabel')}</Text>
          <Controller
            control={control}
            name="census"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={styles.input}
                placeholder={t('shiftDetails.censusPlaceholder')}
                placeholderTextColor={themeTokens.colors.muted}
                accessibilityLabel={t('shiftDetails.censusLabel')}
                accessibilityHint={t('shiftDetails.censusHint')}
                allowFontScaling
                keyboardType="numeric"
                onBlur={onBlur}
                value={value == null ? '' : String(value)}
                onChangeText={(text) => onChange(parseNumericInput(text))}
              />
            )}
          />
          {censusError ? <Text allowFontScaling style={styles.error}>{censusError}</Text> : null}
        </View>
      </SectionCard>

      <SectionCard title={t('shiftDetails.scheduleSectionTitle')}>
        <View style={styles.field}>
          <Text allowFontScaling style={styles.label}>{t('shiftDetails.shiftStartLabel')}</Text>
          <Controller
            control={control}
            name="shiftStart"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={styles.input}
                placeholder={t('shiftDetails.shiftStartPlaceholder')}
                placeholderTextColor={themeTokens.colors.muted}
                accessibilityLabel={t('shiftDetails.shiftStartLabel')}
                accessibilityHint={t('shiftDetails.shiftStartHint')}
                allowFontScaling
                onBlur={onBlur}
                value={value ?? ''}
                onChangeText={onChange}
              />
            )}
          />
          {startError ? <Text allowFontScaling style={styles.error}>{startError}</Text> : null}
        </View>
        <View style={styles.field}>
          <Text allowFontScaling style={styles.label}>{t('shiftDetails.shiftEndLabel')}</Text>
          <Controller
            control={control}
            name="shiftEnd"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={styles.input}
                placeholder={t('shiftDetails.shiftEndPlaceholder')}
                placeholderTextColor={themeTokens.colors.muted}
                accessibilityLabel={t('shiftDetails.shiftEndLabel')}
                accessibilityHint={t('shiftDetails.shiftEndHint')}
                allowFontScaling
                onBlur={onBlur}
                value={value ?? ''}
                onChangeText={onChange}
              />
            )}
          />
          {endError ? <Text allowFontScaling style={styles.error}>{endError}</Text> : null}
        </View>
        <View style={styles.field}>
          <Text allowFontScaling style={styles.label}>{t('shiftDetails.shiftTypeLabel')}</Text>
          <Controller
            control={control}
            name="shiftType"
            render={({ field: { onChange, value } }) => (
              <View style={styles.optionRow}>
                {SHIFT_TYPES.map((option) => {
                  const selected = value === option;
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      accessibilityLabel={shiftTypeLabels[option]}
                      accessibilityState={{ selected }}
                      accessibilityHint={t('shiftDetails.shiftTypeHint')}
                      style={[styles.optionButton, selected && styles.optionButtonSelected]}
                      onPress={() => onChange(option)}
                    >
                      <Text allowFontScaling style={[styles.optionText, selected && styles.optionTextSelected]}>
                        {shiftTypeLabels[option]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          />
          {shiftTypeError ? <Text allowFontScaling style={styles.error}>{shiftTypeError}</Text> : null}
        </View>
      </SectionCard>

      <SectionCard title={t('shiftDetails.staffSectionTitle')}>
        <StaffListInput
          control={control}
          name="staffIn"
          label={t('shiftDetails.staffInLabel')}
          error={staffInError}
          styles={styles}
          placeholderTextColor={themeTokens.colors.muted}
        />
        <StaffListInput
          control={control}
          name="staffOut"
          label={t('shiftDetails.staffOutLabel')}
          error={staffOutError}
          styles={styles}
          placeholderTextColor={themeTokens.colors.muted}
        />
      </SectionCard>

      <SectionCard title={t('shiftDetails.observationsSectionTitle')}>
        <View style={styles.field}>
          <Text allowFontScaling style={styles.label}>{t('shiftDetails.generalNotesLabel')}</Text>
          <Controller
            control={control}
            name="generalNotes"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder={t('shiftDetails.generalNotesPlaceholder')}
                placeholderTextColor={themeTokens.colors.muted}
                accessibilityLabel={t('shiftDetails.generalNotesLabel')}
                accessibilityHint={t('shiftDetails.generalNotesHint')}
                allowFontScaling
                onBlur={onBlur}
                multiline
                value={value ?? ''}
                onChangeText={onChange}
              />
            )}
          />
          {generalNotesError ? <Text allowFontScaling style={styles.error}>{generalNotesError}</Text> : null}
        </View>
        <IncidentListInput
          control={control}
          name="incidents"
          label={t('shiftDetails.incidentsLabel')}
          helper={t('shiftDetails.incidentsHelper')}
          error={incidentsError}
          styles={styles}
          placeholderTextColor={themeTokens.colors.muted}
        />
      </SectionCard>

      <View style={styles.buttonRow}>
        <View style={styles.flex}>
          <PrimaryButton
            label={t('common.save')}
            onPress={onSubmit}
            accessibilityHint={t('shiftDetails.saveHint')}
          />
        </View>
        <View style={styles.flex}>
          <SecondaryButton
            label={t('common.cancel')}
            onPress={onCancel}
            accessibilityHint={t('shiftDetails.cancelHint')}
          />
        </View>
      </View>
    </ScrollView>
  );
}
