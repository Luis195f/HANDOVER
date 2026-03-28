import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Controller, useFieldArray, useFormContext, useWatch, type Control } from 'react-hook-form';

import {
  fetchInterventionsSuggestions,
  type ClinicalContext,
  type NocOutcomeSuggestion,
} from '@/src/lib/ai-suggestions';
import { logClinicalDecision } from '@/src/lib/clinical-decision-log';
import { hashHex } from '@/src/lib/crypto';
import {
  getNocPlaceholderCatalog,
  loadNocCatalog,
  NOC_LICENSE_WARNING,
  searchNocIndex,
  type NocCatalogPayload,
  type NocCode,
} from '@/src/catalogs/nocCodes';
import type { HandoverStructuredDiagnosis } from '@/src/types/handover';
import type { HandoverValues as HandoverFormValues } from '@/src/validation/schemas';

const MAX_OUTCOMES = 3;
const MAX_NOC_CATALOG_SUGGESTIONS = 8;
const DEFAULT_BASELINE = 2;
const DEFAULT_TARGET = 4;
const SCORE_OPTIONS = [1, 2, 3, 4, 5] as const;

type Props = {
  control: Control<HandoverFormValues>;
  name?: 'outcomes';
  enableAiSuggestions?: boolean;
  suggestInterventions?: typeof fetchInterventionsSuggestions;
  clinicalDecisionContext?: {
    patientId?: string;
    unitId?: string;
  };
};

type OutcomeItem = NonNullable<HandoverFormValues['outcomes']>[number];

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
  warningCard: {
    borderWidth: 1,
    borderColor: '#F59E0B',
    borderRadius: 8,
    backgroundColor: '#FFF7ED',
    padding: 12,
    gap: 8,
    marginBottom: 12,
  },
  warningTitle: { color: '#9A3412', fontSize: 14, fontWeight: '700' },
  warningButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#1E3A8A',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  warningButtonText: { color: '#fff', fontWeight: '600' },
  catalogSuggestions: { gap: 8, marginBottom: 12 },
  catalogSuggestion: {
    borderColor: '#CBD5E1',
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  catalogSuggestionText: { color: '#1F2937', fontSize: 14 },
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
  clinicalDecisionContext,
}: Props) {
  const { getValues } = useFormContext<HandoverFormValues>();
  const { fields, append, remove, replace } = useFieldArray({ control, name });
  const outcomes = useWatch({ control, name }) as HandoverFormValues['outcomes'];
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [pendingSuggestedOutcomes, setPendingSuggestedOutcomes] = useState<OutcomeItem[]>([]);
  const [nocCatalogQuery, setNocCatalogQuery] = useState('');
  const placeholderNocCatalog = useMemo(() => getNocPlaceholderCatalog(), []);
  const [nocCatalog, setNocCatalog] = useState<NocCatalogPayload>(placeholderNocCatalog);
  const [fullNocCatalogEnabled, setFullNocCatalogEnabled] = useState(false);
  const [nocCatalogLoading, setNocCatalogLoading] = useState(false);
  const [nocCatalogError, setNocCatalogError] = useState<string | null>(null);

  const canAddMore = fields.length < MAX_OUTCOMES;

  const helperLabel = useMemo(() => {
    const count = outcomes?.length ?? 0;
    return `${count}/${MAX_OUTCOMES} resultados capturados`;
  }, [outcomes]);
  const nocCatalogSuggestions = useMemo(
    () =>
      nocCatalogQuery.trim()
        ? searchNocIndex(nocCatalog.index, nocCatalogQuery.trim(), MAX_NOC_CATALOG_SUGGESTIONS)
        : [],
    [nocCatalog, nocCatalogQuery],
  );
  const nocCatalogHelperText = fullNocCatalogEnabled
    ? `Catálogo NOC licenciado cargado (${nocCatalog.codes.length} resultados)`
    : `Sugerencias limitadas al catálogo local (${nocCatalog.codes.length} resultados)`;
  const hasPendingSuggestions = pendingSuggestedOutcomes.length > 0;

  const logNocDecision = (input: {
    decision: 'applied' | 'dismissed';
    reasonCode: 'selection_applied' | 'user_discarded_batch' | 'replace_existing';
    suggestions: OutcomeItem[];
  }) => {
    const patientId = clinicalDecisionContext?.patientId?.trim();
    const unitId = clinicalDecisionContext?.unitId?.trim();
    if (!patientId || !unitId) return;

    void logClinicalDecision({
      patientId,
      unitId,
      suggestionSource: 'ai_noc_suggestions',
      decision: input.decision,
      reasonCode: input.reasonCode,
      metadata: {
        section: 'outcomes',
        suggestionCount: input.suggestions.length,
        selectedCount: input.suggestions.length,
        selectedCodes: input.suggestions.map((item) => item.nocCode).filter((code) => code.trim().length > 0),
        suggestionHashes: input.suggestions.map((item) => hashHex(`${item.nocCode}:${item.nocDisplay}`)),
        replaceExisting: Boolean((outcomes ?? []).length),
      },
    });
  };

  const addOutcome = () => {
    if (!canAddMore) return;
    append({
      nocCode: '',
      nocDisplay: '',
      baseline: DEFAULT_BASELINE,
      target: DEFAULT_TARGET,
    });
  };

  const handleEnableFullNocCatalog = async () => {
    if (nocCatalogLoading || fullNocCatalogEnabled) {
      return;
    }

    setNocCatalogLoading(true);
    setNocCatalogError(null);
    try {
      const loadedCatalog = await loadNocCatalog();
      if (!loadedCatalog.licensed) {
        setNocCatalogError('No hay un catálogo NOC licenciado configurado; se mantiene el catálogo local.');
        return;
      }

      setNocCatalog(loadedCatalog);
      setFullNocCatalogEnabled(true);
    } catch {
      setNocCatalogError('No se pudo cargar el catálogo NOC completo.');
    } finally {
      setNocCatalogLoading(false);
    }
  };

  const addCatalogOutcome = (entry: NocCode) => {
    const currentOutcomes = outcomes ?? [];
    if (currentOutcomes.length >= MAX_OUTCOMES) {
      setNocCatalogError('Máximo 3 resultados NOC.');
      return;
    }

    const alreadyExists = currentOutcomes.some(
      (item) => item.nocCode === entry.code || item.nocDisplay.trim().toLowerCase() === entry.display.trim().toLowerCase(),
    );
    if (alreadyExists) {
      setNocCatalogError('El resultado NOC seleccionado ya existe.');
      return;
    }

    append({
      nocCode: entry.code,
      nocDisplay: entry.display,
      baseline: DEFAULT_BASELINE,
      target: DEFAULT_TARGET,
    });
    setNocCatalogQuery('');
    setNocCatalogError(null);
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

      setPendingSuggestedOutcomes(normalized);
    } catch {
      setSuggestionsError('No se pudieron obtener sugerencias NOC en este momento.');
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const applySuggestedOutcomes = () => {
    if (!pendingSuggestedOutcomes.length) return;
    replace(pendingSuggestedOutcomes);
    logNocDecision({
      decision: 'applied',
      reasonCode: (outcomes ?? []).length > 0 ? 'replace_existing' : 'selection_applied',
      suggestions: pendingSuggestedOutcomes,
    });
    setPendingSuggestedOutcomes([]);
  };

  const dismissSuggestedOutcomes = () => {
    if (!pendingSuggestedOutcomes.length) return;
    logNocDecision({
      decision: 'dismissed',
      reasonCode: 'user_discarded_batch',
      suggestions: pendingSuggestedOutcomes,
    });
    setPendingSuggestedOutcomes([]);
  };

  return (
    <View testID="noc-outcomes-section">
      <Text style={styles.sectionTitle}>Resultados esperados (NOC)</Text>
      <Text style={styles.helperText}>Opcional. Registra de 1 a 3 resultados con escala rápida 1-5.</Text>
      <Text style={styles.helperText}>{helperLabel}</Text>

      {!fullNocCatalogEnabled ? (
        <View style={styles.warningCard} testID="noc-license-warning">
          <Text style={styles.warningTitle}>{NOC_LICENSE_WARNING}</Text>
          <Text style={styles.helperText}>
            El catálogo NOC completo solo se habilita bajo demanda desde una fuente licenciada configurada por entorno o backend.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Habilitar catálogo NOC completo"
            onPress={() => void handleEnableFullNocCatalog()}
            style={({ pressed }) => [styles.warningButton, pressed ? { opacity: 0.85 } : null]}
            testID="enable-full-noc-button"
          >
            <Text style={styles.warningButtonText}>
              {nocCatalogLoading ? 'Cargando catálogo completo...' : 'Habilitar catálogo completo'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      <TextInput
        style={styles.input}
        placeholder="Buscar resultado NOC..."
        value={nocCatalogQuery}
        onChangeText={(text) => {
          setNocCatalogQuery(text);
          if (nocCatalogError) {
            setNocCatalogError(null);
          }
        }}
        testID="noc-catalog-search-input"
      />

      {nocCatalogQuery.trim() ? <Text style={styles.helperText}>{nocCatalogHelperText}</Text> : null}
      {nocCatalogError ? <Text style={styles.errorText}>{nocCatalogError}</Text> : null}

      {nocCatalogSuggestions.length > 0 ? (
        <View style={styles.catalogSuggestions} testID="noc-catalog-suggestions-list">
          {nocCatalogSuggestions.map((entry) => (
            <Pressable
              key={`${entry.system}-${entry.code}`}
              style={styles.catalogSuggestion}
              onPress={() => addCatalogOutcome(entry)}
              accessibilityRole="button"
              testID={`noc-catalog-suggestion-${entry.system}-${entry.code}`}
            >
              <Text style={styles.catalogSuggestionText}>{`${entry.display} (${entry.code}) · ${entry.system}`}</Text>
            </Pressable>
          ))}
        </View>
      ) : nocCatalogQuery.trim() ? (
        <Text style={styles.helperText}>No se encontraron resultados NOC en el catálogo activo.</Text>
      ) : null}

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

      {hasPendingSuggestions ? (
        <View style={styles.warningCard} testID="noc-pending-suggestions">
          <Text style={styles.warningTitle}>Resultados sugeridos pendientes de revisión</Text>
          <View style={styles.catalogSuggestions}>
            {pendingSuggestedOutcomes.map((item, index) => (
              <View key={`${item.nocCode}-${index}`} style={styles.catalogSuggestion}>
                <Text style={styles.catalogSuggestionText}>{`${item.nocDisplay} (${item.nocCode})`}</Text>
              </View>
            ))}
          </View>
          <View style={styles.actionsRow}>
            <Pressable
              accessibilityRole="button"
              testID="noc-apply-suggestions"
              style={styles.button}
              onPress={applySuggestedOutcomes}
            >
              <Text style={styles.buttonText}>Aplicar resultados sugeridos</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              testID="noc-dismiss-suggestions"
              style={[styles.button, styles.secondaryButton]}
              onPress={dismissSuggestedOutcomes}
            >
              <Text style={styles.secondaryButtonText}>Descartar sugerencias</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

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
