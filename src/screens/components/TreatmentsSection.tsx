import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import {
  Controller,
  useFieldArray,
  useFormContext,
  useWatch,
  type Control,
  type FieldErrors,
} from 'react-hook-form';
import { v4 as uuidv4 } from 'uuid';

import { isOn } from '@/src/config/flags';
import { fetchInterventionsSuggestions, type ClinicalContext } from '@/src/lib/ai-suggestions';
import {
  getNicPlaceholderCatalog,
  loadNicCatalog,
  NIC_LICENSE_WARNING,
  searchNicIndex,
  type NicCode,
  type NicCatalogPayload,
} from '@/src/catalogs/nicCodes';
import type { HandoverStructuredDiagnosis, TreatmentItem } from '@/src/types/handover';
import type { ProfileRuntimeTreatmentQuickPick } from '@/src/types/profile';
import type { HandoverValues as HandoverFormValues } from '@/src/validation/schemas';

const TREATMENT_LABELS: Record<TreatmentItem['type'], string> = {
  woundCare: 'Curación de heridas',
  respiratory: 'Respiratorio',
  mobilization: 'Movilización',
  education: 'Educación',
  other: 'Otro',
};

const MAX_NIC_SUGGESTIONS = 6;
const MAX_NIC_CATALOG_SUGGESTIONS = 8;
const DEFAULT_PRESELECTED_SUGGESTIONS = 3;

const treatmentOptions = Object.entries(TREATMENT_LABELS).map(([value, label]) => ({ value, label })) as Array<{
  value: TreatmentItem['type'];
  label: string;
}>;

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12 },
  card: {
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    backgroundColor: '#fff',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 16, fontWeight: '700', flexShrink: 1 },
  cardMeta: { color: '#4B5563', marginTop: 6 },
  helperText: { color: '#4B5563', marginTop: 8 },
  errorText: { color: '#B91C1C' },
  buttonRow: { flexDirection: 'row', gap: 12, marginTop: 12 },
  button: {
    backgroundColor: '#2563EB',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
  },
  buttonText: { color: '#fff', fontWeight: '600' },
  secondaryButton: {
    backgroundColor: '#E5E7EB',
  },
  secondaryButtonText: { color: '#111827', fontWeight: '600' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
  field: { marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 6 },
  input: {
    borderColor: '#CBD5E1',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  select: {
    borderColor: '#CBD5E1',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 12,
    backgroundColor: '#fff',
  },
  selectText: { color: '#111827' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  suggestionsCard: {
    borderColor: '#CBD5F5',
    borderWidth: 1,
    borderRadius: 12,
    backgroundColor: '#F8FAFF',
    padding: 12,
    marginBottom: 12,
    gap: 10,
  },
  suggestionOption: {
    borderColor: '#CBD5E1',
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  suggestionOptionSelected: {
    borderColor: '#2563EB',
    backgroundColor: '#EFF6FF',
  },
  suggestionText: { color: '#1F2937', fontSize: 14 },
  warningCard: {
    borderWidth: 1,
    borderColor: '#F59E0B',
    borderRadius: 8,
    backgroundColor: '#FFF7ED',
    padding: 12,
    gap: 8,
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
});

type Props = {
  control: Control<HandoverFormValues>;
  name?: 'treatments';
  enableNicCoding?: boolean;
  suggestInterventions?: typeof fetchInterventionsSuggestions;
  quickPicks?: readonly ProfileRuntimeTreatmentQuickPick[];
};

type EditingState = { index: number; isNew?: boolean } | null;

type TreatmentField = keyof Pick<TreatmentItem, 'description' | 'scheduledAt' | 'type'>;

const normalizeSuggestion = (value: string): string =>
  value
    .replace(/^[-*\u2022]\s*/, '')
    .trim();

const normalizeForDedup = (value: string): string => value.trim().toLowerCase();

const extractNicCoding = (rawSuggestion: string): TreatmentItem['code'] | undefined => {
  const suggestion = normalizeSuggestion(rawSuggestion);
  if (!suggestion) return undefined;

  const nicPattern = /\bNIC\s*[-:#]?\s*(\d{3,6})\b\s*[:\-]?\s*(.*)$/i;
  const match = suggestion.match(nicPattern);
  if (!match) return undefined;

  const code = (match[1] ?? '').trim();
  const display = (match[2] ?? '').trim() || suggestion;

  if (!code || !display) return undefined;
  return { system: 'NIC', code, display };
};

const buildSuggestionsContext = (values: HandoverFormValues): ClinicalContext => {
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
    section: 'other',
    diagnoses: diagnoses.length ? Array.from(new Set(diagnoses)) : undefined,
    notes,
  };
};

export function TreatmentsSection({
  control,
  name = 'treatments',
  enableNicCoding,
  suggestInterventions = fetchInterventionsSuggestions,
  quickPicks = [],
}: Props) {
  const { trigger, formState, getValues, setValue } = useFormContext<HandoverFormValues>();
  const { fields, append, remove } = useFieldArray({ control, name });
  const treatments = useWatch({ control, name }) as TreatmentItem[] | undefined;
  const [editing, setEditing] = useState<EditingState>(null);
  const [suggestedInterventions, setSuggestedInterventions] = useState<string[]>([]);
  const [selectedInterventions, setSelectedInterventions] = useState<string[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  const [nicCatalogQuery, setNicCatalogQuery] = useState('');
  const placeholderNicCatalog = useMemo(() => getNicPlaceholderCatalog(), []);
  const [nicCatalog, setNicCatalog] = useState<NicCatalogPayload>(placeholderNicCatalog);
  const [fullNicCatalogEnabled, setFullNicCatalogEnabled] = useState(false);
  const [nicCatalogLoading, setNicCatalogLoading] = useState(false);
  const [nicCatalogError, setNicCatalogError] = useState<string | null>(null);

  const errorBag = formState.errors[name] as FieldErrors<TreatmentItem>[] | undefined;
  const nicCodingEnabled = enableNicCoding ?? isOn('SHOW_NIC_CODING');

  const canAddSelectedSuggestions = selectedInterventions.length > 0;
  const selectedInterventionSet = useMemo(() => new Set(selectedInterventions), [selectedInterventions]);
  const nicCatalogSuggestions = useMemo(
    () =>
      nicCatalogQuery.trim()
        ? searchNicIndex(nicCatalog.index, nicCatalogQuery.trim(), MAX_NIC_CATALOG_SUGGESTIONS)
        : [],
    [nicCatalog, nicCatalogQuery],
  );
  const nicCatalogHelperText = fullNicCatalogEnabled
    ? `Catálogo NIC licenciado cargado (${nicCatalog.codes.length} intervenciones)`
    : `Sugerencias limitadas al catálogo local (${nicCatalog.codes.length} intervenciones)`;

  const quickPickDescriptions = useMemo(
    () => new Set((treatments ?? []).map((item) => normalizeForDedup(item.description))),
    [treatments],
  );
  const openEditor = (index: number) => setEditing({ index });

  const handleAdd = () => {
    const nextIndex = fields.length;
    append({ id: uuidv4(), type: 'other', description: '', done: false });
    setEditing({ index: nextIndex, isNew: true });
  };

  const handleCancel = () => {
    if (editing?.isNew) remove(editing.index);
    setEditing(null);
  };

  const handleSave = async () => {
    if (editing == null) return;
    const basePath = `${name}.${editing.index}` as const;
    const ok = await trigger([`${basePath}.description`, `${basePath}.type`]);
    if (!ok) return;
    setEditing(null);
  };

  const getErrorForField = (index: number, field: TreatmentField) => {
    const fieldErrors = errorBag?.[index];
    if (!fieldErrors) return undefined;
    const maybeError = fieldErrors?.[field]?.message;
    return typeof maybeError === 'string' ? maybeError : undefined;
  };

  const handleEnableFullNicCatalog = async () => {
    if (!nicCodingEnabled || nicCatalogLoading || fullNicCatalogEnabled) {
      return;
    }

    setNicCatalogLoading(true);
    setNicCatalogError(null);
    try {
      const loadedCatalog = await loadNicCatalog();
      if (!loadedCatalog.licensed) {
        setNicCatalogError('No hay un catálogo NIC licenciado configurado; se mantiene el catálogo local.');
        return;
      }

      setNicCatalog(loadedCatalog);
      setFullNicCatalogEnabled(true);
    } catch {
      setNicCatalogError('No se pudo cargar el catálogo NIC completo.');
    } finally {
      setNicCatalogLoading(false);
    }
  };

  const addQuickPickTreatment = (quickPick: ProfileRuntimeTreatmentQuickPick) => {
    const quickPickSignature = normalizeForDedup(quickPick.description);
    const existsByDescription = quickPickDescriptions.has(quickPickSignature);
    const existsByCode =
      quickPick.code &&
      (treatments ?? []).some(
        (item) => item.code?.system === quickPick.code?.system && item.code?.code === quickPick.code?.code,
      );

    if (existsByDescription || existsByCode) {
      setSuggestionsError('El quick-pick seleccionado ya existe en tratamientos.');
      return;
    }

    append({
      id: uuidv4(),
      type: quickPick.type,
      description: quickPick.description,
      done: false,
      ...(quickPick.code ? { code: quickPick.code } : {}),
    });
    setSuggestionsError(null);
  };

  const addCatalogIntervention = (entry: NicCode) => {
    const currentTreatments = treatments ?? [];
    const alreadyExists = currentTreatments.some(
      (item) =>
        (item.code?.system === 'NIC' && item.code.code === entry.code) ||
        normalizeForDedup(item.description) === normalizeForDedup(entry.display),
    );

    if (alreadyExists) {
      setNicCatalogError('La intervención NIC seleccionada ya existe en tratamientos.');
      return;
    }

    append({
      id: uuidv4(),
      type: 'other',
      description: entry.display,
      done: false,
      code: {
        system: 'NIC',
        code: entry.code,
        display: entry.display,
      },
    });
    setNicCatalogQuery('');
    setNicCatalogError(null);
  };

  const handleSuggestNic = async () => {
    if (!nicCodingEnabled || suggestionsLoading) return;

    setSuggestionsError(null);
    setSuggestionsLoading(true);

    try {
      const context = buildSuggestionsContext(getValues());
      const response = await suggestInterventions(context);
      const normalized = response.interventions
        .map((item) => normalizeSuggestion(item))
        .filter((item) => item.length > 0);
      const unique = Array.from(new Set(normalized)).slice(0, MAX_NIC_SUGGESTIONS);

      if (unique.length === 0) {
        setSuggestedInterventions([]);
        setSelectedInterventions([]);
        setSuggestionsError('No se encontraron sugerencias NIC para este contexto.');
        return;
      }

      setSuggestedInterventions(unique);
      setSelectedInterventions(unique.slice(0, Math.min(DEFAULT_PRESELECTED_SUGGESTIONS, unique.length)));
    } catch {
      setSuggestionsError('No se pudieron obtener sugerencias NIC en este momento.');
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const toggleInterventionSelection = (intervention: string) => {
    setSelectedInterventions((previous) => {
      if (previous.includes(intervention)) {
        return previous.filter((value) => value !== intervention);
      }
      return [...previous, intervention];
    });
  };

  const clearTreatmentNicCode = (index: number) => {
    const current = treatments ?? [];
    if (!current[index]?.code) return;

    const nextTreatments = current.map((item, itemIndex) =>
      itemIndex === index ? { ...item, code: undefined } : item,
    );

    setValue(name, nextTreatments, {
      shouldDirty: true,
      shouldTouch: true,
    });
  };

  const applySelectedSuggestions = () => {
    if (!selectedInterventions.length) return;

    const existingDescriptions = new Set(
      (treatments ?? []).map((item) => normalizeForDedup(item.description)),
    );

    const additions: TreatmentItem[] = selectedInterventions
      .map((suggestion) => {
        const nicCoding = extractNicCoding(suggestion);
        const description = nicCoding?.display ?? normalizeSuggestion(suggestion);
        const nextTreatment: TreatmentItem = {
          id: uuidv4(),
          type: 'other',
          description,
          done: false,
          ...(nicCoding ? { code: nicCoding } : {}),
        };

        return nextTreatment;
      })
      .filter((item) => {
        const signature = normalizeForDedup(item.description);
        if (existingDescriptions.has(signature)) return false;
        existingDescriptions.add(signature);
        return true;
      });

    if (!additions.length) {
      setSuggestionsError('Las sugerencias seleccionadas ya existen en tratamientos.');
      return;
    }

    append(additions);
    setSuggestionsError(null);
    setSelectedInterventions([]);
    setSuggestedInterventions([]);
  };

  const renderModal = () => {
    if (editing == null) return null;
    const index = editing.index;
    const currentTreatment = treatments?.[index];

    return (
      <Modal transparent animationType="fade" visible onRequestClose={handleCancel}>
        <Pressable style={styles.modalBackdrop} onPress={handleCancel}>
          <Pressable style={styles.modalContent} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.sectionTitle}>Tratamiento no farmacológico</Text>
            <Controller
              control={control}
              name={`${name}.${index}.type` as const}
              defaultValue={currentTreatment?.type ?? 'other'}
              render={({ field: { onChange, value } }) => (
                <View style={styles.field}>
                  <Text style={styles.label}>Tipo</Text>
                  <Pressable style={styles.select}>
                    <Text style={styles.selectText}>
                      {treatmentOptions.find((opt) => opt.value === value)?.label ?? 'Seleccionar'}
                    </Text>
                  </Pressable>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {treatmentOptions.map((option) => (
                      <Pressable
                        key={option.value}
                        style={[styles.button, value === option.value ? null : styles.secondaryButton]}
                        onPress={() => onChange(option.value)}
                      >
                        <Text style={value === option.value ? styles.buttonText : styles.secondaryButtonText}>
                          {option.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  {getErrorForField(index, 'type') ? (
                    <Text style={[styles.cardMeta, styles.errorText]}>{getErrorForField(index, 'type')}</Text>
                  ) : null}
                </View>
              )}
            />
            <Controller
              control={control}
              name={`${name}.${index}.description` as const}
              defaultValue={currentTreatment?.description ?? ''}
              render={({ field: { onChange, onBlur, value } }) => (
                <View style={styles.field}>
                  <Text style={styles.label}>Descripción</Text>
                  <TextInput
                    style={[styles.input, { minHeight: 72, textAlignVertical: 'top' }]}
                    multiline
                    placeholder="Ej: Cura de úlcera sacra"
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value ?? ''}
                  />
                  {getErrorForField(index, 'description') ? (
                    <Text style={[styles.cardMeta, styles.errorText]}>{getErrorForField(index, 'description')}</Text>
                  ) : null}
                </View>
              )}
            />
            {currentTreatment?.code ? (
              <View style={styles.field}>
                <Text style={styles.label}>Código NIC (opcional)</Text>
                <Text style={styles.cardMeta}>{`${currentTreatment.code.display} (${currentTreatment.code.code})`}</Text>
                <Pressable
                  style={[styles.button, styles.secondaryButton, { alignSelf: 'flex-start', marginTop: 8 }]}
                  onPress={() => clearTreatmentNicCode(index)}
                  testID="remove-nic-code-button"
                >
                  <Text style={styles.secondaryButtonText}>Quitar código NIC</Text>
                </Pressable>
              </View>
            ) : null}
            <Controller
              control={control}
              name={`${name}.${index}.scheduledAt` as const}
              defaultValue={currentTreatment?.scheduledAt ?? ''}
              render={({ field: { onChange, onBlur, value } }) => (
                <View style={styles.field}>
                  <Text style={styles.label}>Programado para</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="2024-05-01T10:00"
                    onBlur={onBlur}
                    onChangeText={onChange}
                    value={value ?? ''}
                  />
                </View>
              )}
            />
            <Controller
              control={control}
              name={`${name}.${index}.done` as const}
              defaultValue={currentTreatment?.done ?? false}
              render={({ field: { value, onChange } }) => (
                <View style={[styles.field, styles.switchRow]}>
                  <Text style={styles.label}>Completado</Text>
                  <Switch value={!!value} onValueChange={onChange} />
                </View>
              )}
            />
            <View style={styles.buttonRow}>
              <Pressable style={[styles.button, styles.secondaryButton]} onPress={handleCancel}>
                <Text style={styles.secondaryButtonText}>Cancelar</Text>
              </Pressable>
              <Pressable style={styles.button} onPress={handleSave}>
                <Text style={styles.buttonText}>Guardar</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    );
  };

  const renderTreatment = (treatment: TreatmentItem, index: number) => (
    <View key={treatment.id} style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{TREATMENT_LABELS[treatment.type]}</Text>
      </View>
      <Text style={styles.cardMeta}>{treatment.description}</Text>
      {treatment.code ? (
        <Text style={styles.cardMeta}>{`NIC: ${treatment.code.display} (${treatment.code.code})`}</Text>
      ) : null}
      {treatment.scheduledAt ? <Text style={styles.cardMeta}>Programado: {treatment.scheduledAt}</Text> : null}
      <Text style={styles.cardMeta}>Estado: {treatment.done ? 'Completado' : 'En progreso'}</Text>
      <View style={styles.buttonRow}>
        <Pressable style={[styles.button, styles.secondaryButton]} onPress={() => openEditor(index)}>
          <Text style={styles.secondaryButtonText}>Editar</Text>
        </Pressable>
        <Pressable style={styles.button} onPress={() => remove(index)}>
          <Text style={styles.buttonText}>Eliminar</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <View>
      <Text style={styles.sectionTitle}>Tratamientos no farmacológicos</Text>

      {quickPicks.length > 0 ? (
        <View style={styles.suggestionsCard}>
          <Text style={styles.helperText}>Quick-picks del perfil activo.</Text>
          <View style={{ gap: 8 }}>
            {quickPicks.map((quickPick) => (
              <Pressable
                key={quickPick.id}
                style={styles.suggestionOption}
                onPress={() => addQuickPickTreatment(quickPick)}
                accessibilityRole="button"
              >
                <Text style={styles.suggestionText}>{quickPick.description}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {nicCodingEnabled ? (
        <View style={styles.suggestionsCard}>
          <Text style={styles.helperText}>Texto libre primero; codificación NIC opcional.</Text>

          {!fullNicCatalogEnabled ? (
            <View style={styles.warningCard} testID="nic-license-warning">
              <Text style={styles.warningTitle}>{NIC_LICENSE_WARNING}</Text>
              <Text style={styles.helperText}>
                El catálogo NIC completo solo se habilita bajo demanda desde una fuente licenciada configurada por entorno o backend.
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Habilitar catálogo NIC completo"
                onPress={() => void handleEnableFullNicCatalog()}
                style={({ pressed }) => [styles.warningButton, pressed ? { opacity: 0.85 } : null]}
                testID="enable-full-nic-button"
              >
                <Text style={styles.warningButtonText}>
                  {nicCatalogLoading ? 'Cargando catálogo completo...' : 'Habilitar catálogo completo'}
                </Text>
              </Pressable>
            </View>
          ) : null}

          <TextInput
            style={styles.input}
            placeholder="Buscar intervención NIC..."
            value={nicCatalogQuery}
            onChangeText={(text) => {
              setNicCatalogQuery(text);
              if (nicCatalogError) {
                setNicCatalogError(null);
              }
            }}
            testID="nic-catalog-search-input"
          />

          {nicCatalogQuery.trim() ? <Text style={styles.helperText}>{nicCatalogHelperText}</Text> : null}
          {nicCatalogError ? <Text style={[styles.helperText, styles.errorText]}>{nicCatalogError}</Text> : null}

          {nicCatalogSuggestions.length > 0 ? (
            <View style={{ gap: 8 }} testID="nic-catalog-suggestions-list">
              {nicCatalogSuggestions.map((entry) => (
                <Pressable
                  key={`${entry.system}-${entry.code}`}
                  style={styles.suggestionOption}
                  onPress={() => addCatalogIntervention(entry)}
                  accessibilityRole="button"
                  testID={`nic-catalog-suggestion-${entry.system}-${entry.code}`}
                >
                  <Text style={styles.suggestionText}>{`${entry.display} (${entry.code}) · ${entry.system}`}</Text>
                </Pressable>
              ))}
            </View>
          ) : nicCatalogQuery.trim() ? (
            <Text style={styles.helperText}>No se encontraron intervenciones NIC en el catálogo activo.</Text>
          ) : null}

          <Pressable
            style={styles.button}
            onPress={() => void handleSuggestNic()}
            accessibilityRole="button"
            testID="nic-suggest-button"
          >
            <Text style={styles.buttonText}>{suggestionsLoading ? 'Generando sugerencias...' : 'Sugerir NIC'}</Text>
          </Pressable>

          {suggestionsError ? <Text style={[styles.helperText, styles.errorText]}>{suggestionsError}</Text> : null}

          {suggestedInterventions.length > 0 ? (
            <View style={{ gap: 8 }} testID="nic-suggestions-list">
              {suggestedInterventions.map((intervention, index) => {
                const selected = selectedInterventionSet.has(intervention);
                return (
                  <Pressable
                    key={`${intervention}-${index}`}
                    style={[styles.suggestionOption, selected ? styles.suggestionOptionSelected : null]}
                    onPress={() => toggleInterventionSelection(intervention)}
                    accessibilityRole="button"
                    testID={`nic-suggestion-${index}`}
                  >
                    <Text style={styles.suggestionText}>{`${selected ? 'Seleccionada' : 'Seleccionar'}: ${intervention}`}</Text>
                  </Pressable>
                );
              })}

              <Pressable
                style={[styles.button, !canAddSelectedSuggestions ? styles.secondaryButton : null]}
                onPress={applySelectedSuggestions}
                disabled={!canAddSelectedSuggestions}
                accessibilityRole="button"
                testID="nic-apply-suggestions"
              >
                <Text style={canAddSelectedSuggestions ? styles.buttonText : styles.secondaryButtonText}>
                  Añadir sugerencias seleccionadas
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      {treatments?.map(renderTreatment)}

      <Pressable style={styles.button} onPress={handleAdd} accessibilityRole="button">
        <Text style={styles.buttonText}>Añadir tratamiento no farmacológico</Text>
      </Pressable>

      {renderModal()}
    </View>
  );
}

export default TreatmentsSection;

