import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Controller, useFieldArray, useFormContext, useWatch, type Control } from 'react-hook-form';

import {
  fetchInterventionsSuggestions,
  type ClinicalContext,
  type NocOutcomeSuggestion,
} from '@/src/lib/ai-suggestions';
import type { HandoverStructuredDiagnosis } from '@/src/types/handover';
import type { HandoverValues as HandoverFormValues } from '@/src/validation/schemas';

const MAX_OUTCOMES = 3;
const DEFAULT_BASELINE = 2;
const DEFAULT_TARGET = 4;
const SCORE_OPTIONS = [1, 2, 3, 4, 5] as const;

type Props = {
  control: Control<HandoverFormValues>;
  name?: 'outcomes';
  enableAiSuggestions?: boolean;
  suggestInterventions?: typeof fetchInterventionsSuggestions;
};

type OutcomeItem = NonNullable<HandoverFormValues['outcomes']>[number];

type ScoreField = 'baseline' | 'target' | 'current';

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  helperText: { color: '#4B5563', marginBottom: 12 },
  card: {
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    backgroundColor: '#fff',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  field: { marginTop: 10 },
  label: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  input: {
    borderColor: '#CBD5E1',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scoreButton: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: '#fff',
    minWidth: 36,
    alignItems: 'center',
  },
  scoreButtonDisabled: { opacity: 0.5 },
  scorePills: { flexDirection: 'row', gap: 6 },
  scorePill: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 999,
    minWidth: 30,
    paddingVertical: 6,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  scorePillActive: { borderColor: '#2563EB', backgroundColor: '#EFF6FF' },
  scorePillText: { color: '#374151', fontWeight: '600' },
  scorePillTextActive: { color: '#1D4ED8' },
  currentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  valueHint: { color: '#6B7280', fontSize: 12 },
  actionsRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  button: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  buttonText: { color: '#fff', fontWeight: '600' },
  secondaryButton: {
    backgroundColor: '#E5E7EB',
  },
  secondaryButtonText: { color: '#111827', fontWeight: '600' },
  errorText: { color: '#B91C1C', marginTop: 8 },
  mutedText: { color: '#6B7280' },
});

const clampScore = (value: number): number => Math.min(5, Math.max(1, Math.round(value)));

const normalizeSuggestionText = (value: string): string => value.replace(/^[-*\u2022]\s*/, '').trim();

const parseFallbackOutcomes = (interventions: string[]): OutcomeItem[] =>
  interventions
    .map((raw, index) => {
      const normalized = normalizeSuggestionText(raw);
      if (!normalized) return null;
      const match = normalized.match(/\bNOC\s*[-:#]?\s*([A-Za-z0-9.]+)\s*[:\-]?\s*(.+)$/i);
      const nocCode = (match?.[1] ?? `NOC-${index + 1}`).trim();
      const nocDisplay = (match?.[2] ?? normalized).trim();
      if (!nocDisplay) return null;
      return {
        nocCode,
        nocDisplay,
        baseline: DEFAULT_BASELINE,
        target: DEFAULT_TARGET,
      } satisfies OutcomeItem;
    })
    .filter((item): item is OutcomeItem => item !== null);

const dedupeAndLimitOutcomes = (items: OutcomeItem[]): OutcomeItem[] => {
  const seen = new Set<string>();
  const unique: OutcomeItem[] = [];

  for (const item of items) {
    const key = `${item.nocCode.toLowerCase()}::${item.nocDisplay.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
    if (unique.length >= MAX_OUTCOMES) break;
  }

  return unique;
};

const toOutcomeItem = (item: NocOutcomeSuggestion): OutcomeItem => ({
  nocCode: item.nocCode,
  nocDisplay: item.nocDisplay,
  baseline: clampScore(item.baseline),
  target: clampScore(item.target),
  ...(item.current != null ? { current: clampScore(item.current) } : {}),
});

const buildOutcomesContext = (values: HandoverFormValues): ClinicalContext => {
  const diagnoses: string[] = [];

  (values.dxMedicalStructured ?? []).forEach((dx: HandoverStructuredDiagnosis) => {
    if (dx?.display?.trim()) diagnoses.push(dx.display.trim());
  });

  (values.dxNursingStructured ?? []).forEach((dx: HandoverStructuredDiagnosis) => {
    if (dx?.display?.trim()) diagnoses.push(dx.display.trim());
  });

  const dxMedicalDisplay = values.dxMedical?.display?.trim();
  if (dxMedicalDisplay) diagnoses.push(dxMedicalDisplay);

  const dxNursingText = typeof values.dxNursing === 'string' ? values.dxNursing.trim() : '';
  if (dxNursingText) diagnoses.push(dxNursingText);

  const notesCandidates = [values.evolution, values.closingSummary, values.sbarRecommendation];
  const notes = notesCandidates.find((item) => typeof item === 'string' && item.trim().length > 0)?.trim();

  return {
    language: 'es',
    section: 'outcomes',
    diagnoses: diagnoses.length ? Array.from(new Set(diagnoses)) : undefined,
    notes,
  };
};

function ScoreSelector({
  value,
  onChange,
  testID,
}: {
  value: number | undefined;
  onChange: (value: number) => void;
  testID: string;
}) {
  const safeValue = clampScore(value ?? DEFAULT_BASELINE);

  return (
    <View style={styles.scoreRow}>
      <Pressable
        accessibilityRole="button"
        testID={`${testID}-decrement`}
        style={[styles.scoreButton, safeValue <= 1 ? styles.scoreButtonDisabled : null]}
        onPress={() => onChange(clampScore(safeValue - 1))}
      >
        <Text>-</Text>
      </Pressable>

      <View style={styles.scorePills}>
        {SCORE_OPTIONS.map((score) => {
          const active = safeValue === score;
          return (
            <Pressable
              key={`${testID}-${score}`}
              accessibilityRole="button"
              testID={`${testID}-value-${score}`}
              style={[styles.scorePill, active ? styles.scorePillActive : null]}
              onPress={() => onChange(score)}
            >
              <Text style={[styles.scorePillText, active ? styles.scorePillTextActive : null]}>{score}</Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        accessibilityRole="button"
        testID={`${testID}-increment`}
        style={[styles.scoreButton, safeValue >= 5 ? styles.scoreButtonDisabled : null]}
        onPress={() => onChange(clampScore(safeValue + 1))}
      >
        <Text>+</Text>
      </Pressable>
    </View>
  );
}

export function OutcomesSection({
  control,
  name = 'outcomes',
  enableAiSuggestions = true,
  suggestInterventions = fetchInterventionsSuggestions,
}: Props) {
  const { getValues } = useFormContext<HandoverFormValues>();
  const { fields, append, remove, replace } = useFieldArray({ control, name });
  const outcomes = useWatch({ control, name }) as HandoverFormValues['outcomes'];
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);

  const canAddMore = fields.length < MAX_OUTCOMES;

  const helperLabel = useMemo(() => {
    const count = outcomes?.length ?? 0;
    return `${count}/${MAX_OUTCOMES} resultados capturados`;
  }, [outcomes]);

  const addOutcome = () => {
    if (!canAddMore) return;
    append({
      nocCode: '',
      nocDisplay: '',
      baseline: DEFAULT_BASELINE,
      target: DEFAULT_TARGET,
    });
  };

  const suggestOutcomes = async () => {
    if (!enableAiSuggestions || suggestionsLoading) return;

    setSuggestionsError(null);
    setSuggestionsLoading(true);

    try {
      const response = await suggestInterventions(buildOutcomesContext(getValues()));
      const normalized = dedupeAndLimitOutcomes(
        response.outcomes && response.outcomes.length > 0
          ? response.outcomes.map(toOutcomeItem)
          : parseFallbackOutcomes(response.interventions),
      );

      if (normalized.length === 0) {
        setSuggestionsError('No se pudieron generar resultados NOC para este contexto.');
        return;
      }

      replace(normalized);
    } catch {
      setSuggestionsError('No se pudieron obtener sugerencias NOC en este momento.');
    } finally {
      setSuggestionsLoading(false);
    }
  };

  return (
    <View testID="noc-outcomes-section">
      <Text style={styles.sectionTitle}>Resultados esperados (NOC)</Text>
      <Text style={styles.helperText}>Opcional. Registra de 1 a 3 resultados con escala rápida 1-5.</Text>
      <Text style={styles.helperText}>{helperLabel}</Text>

      {enableAiSuggestions ? (
        <View style={styles.actionsRow}>
          <Pressable
            accessibilityRole="button"
            testID="noc-outcomes-suggest-button"
            style={styles.button}
            onPress={() => void suggestOutcomes()}
          >
            <Text style={styles.buttonText}>
              {suggestionsLoading ? 'Generando resultados NOC...' : 'Sugerir NOC (IA)'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {suggestionsError ? <Text style={styles.errorText}>{suggestionsError}</Text> : null}

      {fields.map((field, index) => (
        <View key={field.id} style={styles.card} testID={`noc-outcome-card-${index}`}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Resultado NOC #{index + 1}</Text>
            <Pressable
              accessibilityRole="button"
              testID={`noc-outcome-${index}-remove`}
              style={[styles.button, styles.secondaryButton]}
              onPress={() => remove(index)}
            >
              <Text style={styles.secondaryButtonText}>Quitar</Text>
            </Pressable>
          </View>

          <Controller
            control={control}
            name={`${name}.${index}.nocDisplay` as const}
            render={({ field: { onChange, onBlur, value } }) => (
              <View style={styles.field}>
                <Text style={styles.label}>Resultado esperado</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Ej: Estado respiratorio: permeabilidad de vías"
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value ?? ''}
                  testID={`noc-outcome-${index}-display`}
                />
              </View>
            )}
          />

          <Controller
            control={control}
            name={`${name}.${index}.nocCode` as const}
            render={({ field: { onChange, onBlur, value } }) => (
              <View style={styles.field}>
                <Text style={styles.label}>Código NOC</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Ej: 0402"
                  onBlur={onBlur}
                  onChangeText={onChange}
                  value={value ?? ''}
                  testID={`noc-outcome-${index}-code`}
                />
              </View>
            )}
          />

          <Controller
            control={control}
            name={`${name}.${index}.baseline` as const}
            render={({ field: { value, onChange } }) => (
              <View style={styles.field}>
                <Text style={styles.label}>Línea base (1-5)</Text>
                <ScoreSelector
                  value={value}
                  onChange={(nextValue) => onChange(clampScore(nextValue))}
                  testID={`noc-outcome-${index}-baseline`}
                />
              </View>
            )}
          />

          <Controller
            control={control}
            name={`${name}.${index}.target` as const}
            render={({ field: { value, onChange } }) => (
              <View style={styles.field}>
                <Text style={styles.label}>Meta (1-5)</Text>
                <ScoreSelector
                  value={value}
                  onChange={(nextValue) => onChange(clampScore(nextValue))}
                  testID={`noc-outcome-${index}-target`}
                />
              </View>
            )}
          />

          <Controller
            control={control}
            name={`${name}.${index}.current` as const}
            render={({ field: { value, onChange } }) => (
              <View style={styles.field}>
                <View style={styles.currentRow}>
                  <Text style={styles.label}>Valor actual (opcional, 1-5)</Text>
                  <Pressable
                    accessibilityRole="button"
                    style={[styles.button, styles.secondaryButton]}
                    onPress={() => onChange(undefined)}
                    testID={`noc-outcome-${index}-current-clear`}
                  >
                    <Text style={styles.secondaryButtonText}>Limpiar</Text>
                  </Pressable>
                </View>
                <Text style={styles.valueHint}>{value == null ? 'Sin registrar' : `Actual: ${value}`}</Text>
                <ScoreSelector
                  value={value}
                  onChange={(nextValue) => onChange(clampScore(nextValue))}
                  testID={`noc-outcome-${index}-current`}
                />
              </View>
            )}
          />
        </View>
      ))}

      <Pressable
        accessibilityRole="button"
        testID="noc-outcomes-add-button"
        style={[styles.button, !canAddMore ? styles.secondaryButton : null]}
        onPress={addOutcome}
        disabled={!canAddMore}
      >
        <Text style={canAddMore ? styles.buttonText : styles.secondaryButtonText}>Añadir resultado NOC</Text>
      </Pressable>

      {!canAddMore ? <Text style={[styles.helperText, styles.mutedText]}>Máximo 3 resultados.</Text> : null}
    </View>
  );
}

export default OutcomesSection;

