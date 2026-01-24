import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Controller, type Control, type UseFormWatch } from 'react-hook-form';

import { RISK_ACTIONS_BY_TYPE } from '@/src/config/risks';
import type { RiskItem, RiskType } from '@/src/types/handover';
import type { HandoverValues } from '@/src/validation/schemas';
import { useThemeTokens } from '../../theme';

interface SafetySectionProps {
  control: Control<HandoverValues>;
  watch: UseFormWatch<HandoverValues>;
}

const RISK_LABELS: Record<RiskType, string> = {
  fall: 'Paciente con riesgo de caídas',
  pressureUlcer: 'Riesgo de úlceras por presión',
  isolation: 'Aislamiento / precauciones',
  seizure: 'Riesgo de convulsiones',
  suicide: 'Riesgo de suicidio',
  deviceDisconnection: 'Riesgo de desconexión de dispositivos',
  infection: 'Riesgo de infección / brote',
  other: 'Otro riesgo',
};

const EMPTY_RISK: RiskItem = { type: 'other', present: false, notes: undefined, actions: [] };

function getRiskItem(values: RiskItem[] | undefined, type: RiskType): RiskItem {
  if (!Array.isArray(values)) return { ...EMPTY_RISK, type };
  const existing = values.find(item => item.type === type);
  if (existing) return existing;
  return { ...EMPTY_RISK, type };
}

export default function SafetySection({ control, watch }: SafetySectionProps) {
  const { colors, fontSizes, spacing, radius } = useThemeTokens();
  const riskTypes = useMemo(() => Object.keys(RISK_LABELS) as RiskType[], []);
  const watchedRisks = watch('risksStructured');
  const normalizeRisks = (items: HandoverValues['risksStructured'] | undefined): RiskItem[] =>
    Array.isArray(items)
      ? items.map((item) => ({ ...EMPTY_RISK, ...item, actions: item.actions ?? [] }))
      : [];

  return (
    <Controller
      control={control}
      name="risksStructured"
      defaultValue={[]}
      render={({ field: { value, onChange } }) => {
        const currentRisks = normalizeRisks(watchedRisks ?? value);

        const updateRisk = (type: RiskType, updater: (item: RiskItem) => RiskItem) => {
          const next = updater(getRiskItem(currentRisks, type));
          const filtered = (currentRisks ?? []).filter(item => item.type !== type);
          onChange([...filtered, next]);
        };

        const togglePresent = (type: RiskType, present: boolean) => {
          updateRisk(type, (item) => ({ ...item, present, actions: item.actions ?? [] }));
        };

        const toggleAction = (type: RiskType, actionId: string) => {
          updateRisk(type, (item) => {
            const currentActions = item.actions ?? [];
            const hasAction = currentActions.includes(actionId);
            const nextActions = hasAction
              ? currentActions.filter(action => action !== actionId)
              : [...currentActions, actionId];
            return { ...item, present: item.present || nextActions.length > 0, actions: nextActions };
          });
        };

        const updateNotes = (type: RiskType, notes: string) => {
          updateRisk(type, (item) => ({ ...item, notes }));
        };

        return (
          <View style={styles.container}>
            {riskTypes.map((type) => {
              const riskItem = getRiskItem(currentRisks, type);
              const actions = RISK_ACTIONS_BY_TYPE[type];
              return (
                <View
                  key={type}
                  style={[
                    styles.riskCard,
                    {
                      borderRadius: radius.md,
                      borderColor: colors.border,
                      backgroundColor: colors.background,
                    },
                    riskItem.present && {
                      borderColor: colors.danger,
                      backgroundColor: '#FEE2E2',
                    },
                  ]}
                >
                  <View style={styles.riskHeader}>
                    <View style={styles.headerText}>
                      <Text
                        style={[
                          styles.riskTitle,
                          {
                            color: riskItem.present ? colors.danger : colors.text,
                            fontSize: fontSizes.base,
                          },
                        ]}
                      >
                        {RISK_LABELS[type]}
                      </Text>
                      <Text style={[styles.riskHint, { color: colors.muted }]}>
                        Marca y documenta medidas preventivas.
                      </Text>
                    </View>
                    <Switch
                      accessibilityRole="switch"
                      accessibilityLabel={RISK_LABELS[type]}
                      value={Boolean(riskItem.present)}
                      onValueChange={(next) => togglePresent(type, next)}
                    />
                  </View>
                  {riskItem.present ? (
                    <View style={styles.actionsBlock}>
                      {actions.length > 0 ? (
                        <View style={styles.actionsList}>
                          {actions.map((action) => {
                            const checked = (riskItem.actions ?? []).includes(action.id);
                            return (
                              <Pressable
                                key={action.id}
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked }}
                                style={[
                                  styles.checkbox,
                                  {
                                    borderColor: colors.border,
                                    backgroundColor: colors.background,
                                    borderRadius: radius.sm,
                                    minHeight: 44,
                                    paddingVertical: spacing.sm,
                                    paddingHorizontal: spacing.md,
                                  },
                                  checked && {
                                    backgroundColor: '#EEF2FF',
                                    borderColor: colors.info,
                                  },
                                ]}
                                onPress={() => toggleAction(type, action.id)}
                              >
                                <View
                                  style={[
                                    styles.checkboxIcon,
                                    { borderColor: colors.border },
                                    checked && { backgroundColor: colors.info, borderColor: colors.info },
                                  ]}
                                />
                                <Text style={[styles.checkboxLabel, { color: colors.text }]}>
                                  {action.label}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                      ) : (
                        <Text style={[styles.mutedText, { color: colors.muted }]}>
                          Registra las medidas aplicadas en notas.
                        </Text>
                      )}
                      <TextInput
                        style={[
                          styles.notesInput,
                          styles.input,
                          {
                            borderColor: colors.border,
                            borderRadius: radius.sm,
                            paddingVertical: spacing.sm,
                            paddingHorizontal: spacing.md,
                            backgroundColor: colors.background,
                            color: colors.text,
                            fontSize: fontSizes.sm,
                          },
                        ]}
                        placeholder="Notas o medidas adicionales"
                        placeholderTextColor={colors.muted}
                        value={riskItem.notes ?? ''}
                        onChangeText={(text) => updateNotes(type, text)}
                        multiline
                      />
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  riskCard: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 12,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  riskHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerText: {
    flex: 1,
    marginRight: 12,
  },
  riskTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  riskHint: {
    color: '#6B7280',
    marginTop: 2,
  },
  actionsBlock: {
    marginTop: 10,
    gap: 8,
  },
  actionsList: {
    gap: 8,
  },
  checkbox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  checkboxChecked: {
    backgroundColor: '#EEF2FF',
    borderColor: '#C7D2FE',
  },
  checkboxIcon: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#CBD5F5',
    marginRight: 8,
    backgroundColor: '#FFF',
  },
  checkboxIconChecked: {
    backgroundColor: '#2563EB',
    borderColor: '#2563EB',
  },
  checkboxLabel: {
    color: '#111827',
    fontWeight: '500',
  },
  notesInput: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  input: {
    borderColor: '#CBD5F5',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    backgroundColor: '#fff',
  },
  mutedText: {
    color: '#6B7280',
  },
});
