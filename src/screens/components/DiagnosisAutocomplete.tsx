import React, { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Controller, useFieldArray, useFormContext } from 'react-hook-form';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  DIAGNOSIS_CODES,
  filterDiagnosisCodes,
  type DiagnosisCode,
  type DiagnosisSystem,
} from '../../catalogs/diagnosisCodes';
import {
  getNandaPlaceholderCatalog,
  loadNandaCatalog,
  NANDA_LICENSE_WARNING,
  searchDiagnosisIndex,
  type NandaCatalogPayload,
} from '../../catalogs/nandaCodes';
import { normalizeTerm, SNOMED_SYSTEM, snomedTerms } from '../../data/snomed-dict';
import type { HandoverStructuredDiagnosis } from '../../types/handover';
import type { HandoverValues } from '../../validation/schemas';
import { validateSnomed } from '../../lib/terminology-validation';

const SEARCH_DEBOUNCE_MS = 180;
const MAX_SUGGESTIONS = 40;
const SUGGESTION_ROW_HEIGHT = 52;
const NON_NANDA_SYSTEMS: DiagnosisSystem[] = ['SNOMED', 'ICD10', 'OTHER'];

const styles = StyleSheet.create({
  container: { gap: 8 },
  label: { fontSize: 16, fontWeight: '500' },
  input: {
    borderColor: '#CBD5F5',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  suggestions: {
    borderWidth: 1,
    borderColor: '#CBD5F5',
    borderRadius: 8,
    backgroundColor: '#fff',
    maxHeight: 280,
  },
  suggestionItem: {
    minHeight: SUGGESTION_ROW_HEIGHT,
    paddingVertical: 10,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  suggestionText: { fontSize: 15 },
  selectedList: { gap: 8 },
  selectedItem: {
    borderWidth: 1,
    borderColor: '#CBD5F5',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#F8FAFF',
    gap: 6,
  },
  selectedHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  selectedTitle: { fontSize: 15, fontWeight: '600' },
  pill: {
    backgroundColor: '#E0E7FF',
    color: '#1E1B4B',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontWeight: '600',
  },
  noteInput: {
    borderColor: '#CBD5F5',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: '#fff',
  },
  removeButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
  },
  removeButtonText: { color: '#B91C1C', fontWeight: '600' },
  helperText: { color: '#4B5563', fontSize: 13 },
  errorText: { color: '#DC2626' },
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
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});

type DiagnosisArrayName = 'dxMedicalStructured' | 'dxNursingStructured';

interface DiagnosisAutocompleteProps {
  name: DiagnosisArrayName;
  label: string;
  systemsAllowed?: DiagnosisSystem[];
  enabled?: boolean;
  disabledMessage?: string;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedValue(value), delayMs);
    return () => clearTimeout(timeout);
  }, [delayMs, value]);

  return debouncedValue;
}

function dedupeDiagnosisCodes(codes: DiagnosisCode[]): DiagnosisCode[] {
  const seen = new Set<string>();
  return codes.filter((code) => {
    const key = `${code.system}:${code.code}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function buildSuggestions(
  query: string,
  systemsAllowed: DiagnosisSystem[] | undefined,
  nandaCatalog: NandaCatalogPayload,
): DiagnosisCode[] {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [];
  }

  const baseSystemsAllowed = systemsAllowed?.length
    ? systemsAllowed.filter((system) => system !== 'NANDA' && system !== 'SNOMED')
    : NON_NANDA_SYSTEMS.filter((system) => system !== 'SNOMED');
  const baseSuggestions = baseSystemsAllowed.length
    ? filterDiagnosisCodes(trimmedQuery, baseSystemsAllowed)
    : [];

  const shouldSearchSnomed = !systemsAllowed || systemsAllowed.includes('SNOMED');
  const normalizedQuery = normalizeTerm(trimmedQuery);
  const snomedSuggestions: DiagnosisCode[] = shouldSearchSnomed
    ? snomedTerms
        .filter((term) => normalizeTerm(term.display).includes(normalizedQuery))
        .map((term) => ({ ...term, system: 'SNOMED' as const }))
    : [];

  const shouldSearchNanda = !systemsAllowed || systemsAllowed.includes('NANDA');
  const nandaSuggestions = shouldSearchNanda
    ? searchDiagnosisIndex(nandaCatalog.index, trimmedQuery, MAX_SUGGESTIONS)
    : [];

  return dedupeDiagnosisCodes([...nandaSuggestions, ...snomedSuggestions, ...baseSuggestions]).slice(
    0,
    MAX_SUGGESTIONS,
  );
}

export const DiagnosisAutocomplete: React.FC<DiagnosisAutocompleteProps> = ({
  name,
  label,
  systemsAllowed,
  enabled = true,
  disabledMessage,
}) => {
  const {
    control,
    setError,
    clearErrors,
    getValues,
    setValue,
    watch,
    formState: { errors },
  } = useFormContext<HandoverValues>();

  const { fields, append, remove } = useFieldArray<
    HandoverValues,
    DiagnosisArrayName,
    'id'
  >({
    control,
    name,
  });

  const placeholderNandaCatalog = useMemo(() => getNandaPlaceholderCatalog(), []);
  const supportsNandaCatalog = !systemsAllowed || systemsAllowed.includes('NANDA');
  const nonNandaCatalogSize = useMemo(
    () => DIAGNOSIS_CODES.filter((code) => code.system !== 'NANDA').length,
    [],
  );

  const [query, setQuery] = useState('');
  const [validatingCode, setValidatingCode] = useState<string | null>(null);
  const [nandaCatalog, setNandaCatalog] = useState<NandaCatalogPayload>(placeholderNandaCatalog);
  const [fullNandaCatalogEnabled, setFullNandaCatalogEnabled] = useState(false);
  const [nandaCatalogLoading, setNandaCatalogLoading] = useState(false);
  const [nandaCatalogError, setNandaCatalogError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<DiagnosisCode[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const canonicalMedicalDiagnosis = name === 'dxMedicalStructured' ? watch('dxMedical') : null;

  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const deferredQuery = useDeferredValue(debouncedQuery);

  useEffect(() => {
    const trimmedQuery = deferredQuery.trim();
    if (!trimmedQuery) {
      setSuggestions([]);
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    setIsSearching(true);
    const nextSuggestions = buildSuggestions(trimmedQuery, systemsAllowed, nandaCatalog);
    startTransition(() => {
      if (cancelled) {
        return;
      }
      setSuggestions(nextSuggestions);
      setIsSearching(false);
    });

    return () => {
      cancelled = true;
    };
  }, [deferredQuery, nandaCatalog, systemsAllowed]);

  const fieldError =
    (errors?.[name] as unknown as { message?: string } | undefined)?.message ?? undefined;

  const handleEnableFullCatalog = async () => {
    if (!supportsNandaCatalog || nandaCatalogLoading || fullNandaCatalogEnabled) {
      return;
    }

    setNandaCatalogLoading(true);
    setNandaCatalogError(null);
    try {
      const loadedCatalog = await loadNandaCatalog();
      if (!loadedCatalog.licensed) {
        setNandaCatalogError('No hay un catálogo NANDA licenciado configurado; se mantiene el catálogo local.');
        return;
      }

      startTransition(() => {
        setNandaCatalog(loadedCatalog);
        setFullNandaCatalogEnabled(true);
      });
    } catch {
      setNandaCatalogError('No se pudo cargar el catálogo NANDA completo.');
    } finally {
      setNandaCatalogLoading(false);
    }
  };

  const handleSelect = async (code: DiagnosisCode) => {
    const alreadySelected =
      name === 'dxMedicalStructured' && code.system === 'SNOMED'
        ? canonicalMedicalDiagnosis?.code === code.code
        : fields.some((field) => field.code === code.code && field.system === code.system);
    if (alreadySelected) {
      setQuery('');
      setSuggestions([]);
      return;
    }

    if (code.system === 'SNOMED') {
      setValidatingCode(code.code);
      const result = await validateSnomed(code.code, code.display);
      setValidatingCode(null);
      if (!result.valid) {
        setError(name, { type: 'validate', message: result.message });
        return;
      }
    }

    clearErrors(name);
    if (name === 'dxMedicalStructured' && code.system === 'SNOMED') {
      setValue(
        'dxMedical',
        {
          system: SNOMED_SYSTEM,
          code: code.code,
          display: code.display,
        },
        {
          shouldDirty: true,
          shouldTouch: true,
          shouldValidate: true,
        },
      );
      setQuery('');
      setSuggestions([]);
      return;
    }

    const nextItem: HandoverStructuredDiagnosis = {
      system: code.system,
      code: code.code,
      display: code.display,
      freeTextNote: '',
    };
    append(nextItem);

    if (name === 'dxNursingStructured') {
      const rawLegacyValue = getValues('dxNursing');
      const currentLegacyText =
        typeof rawLegacyValue === 'string'
          ? rawLegacyValue.trim()
          : rawLegacyValue && typeof rawLegacyValue === 'object' && 'display' in rawLegacyValue
            ? String((rawLegacyValue as { display?: unknown }).display ?? '').trim()
            : '';
      const shouldAutofill =
        fields.length === 0 && code.system === 'NANDA' && currentLegacyText.length === 0;
      if (shouldAutofill) {
        setValue('dxNursing', code.display, {
          shouldDirty: true,
          shouldTouch: true,
          shouldValidate: true,
        });
      }
    }

    setQuery('');
    setSuggestions([]);
  };

  const helperCount = supportsNandaCatalog ? nandaCatalog.codes.length : nonNandaCatalogSize;
  const helperText = supportsNandaCatalog
    ? fullNandaCatalogEnabled
      ? `Catálogo NANDA licenciado cargado (${helperCount} códigos)`
      : `Sugerencias limitadas al catálogo local (${helperCount} códigos)`
    : `Sugerencias limitadas al catálogo demo (${helperCount} códigos)`;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>

      {!enabled ? (
        <View style={styles.warningCard} testID="diagnosis-governance-disabled">
          <Text style={styles.warningTitle}>Diagnóstico estructurado gobernado no disponible</Text>
          <Text style={styles.helperText}>
            {disabledMessage ?? 'Mantén el registro clínico base con texto libre mientras este bloque permanece desactivado.'}
          </Text>
        </View>
      ) : null}

      {enabled && supportsNandaCatalog && !fullNandaCatalogEnabled ? (
        <View style={styles.warningCard} testID="nanda-license-warning">
          <Text style={styles.warningTitle}>{NANDA_LICENSE_WARNING}</Text>
          <Text style={styles.helperText}>
            El catálogo completo solo se habilita bajo demanda desde una fuente licenciada configurada por entorno o backend.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Habilitar catálogo NANDA completo"
            onPress={() => void handleEnableFullCatalog()}
            style={({ pressed }) => [styles.warningButton, pressed ? { opacity: 0.85 } : null]}
            testID="enable-full-nanda-button"
          >
            <Text style={styles.warningButtonText}>
              {nandaCatalogLoading ? 'Cargando catálogo completo...' : 'Habilitar catálogo completo'}
            </Text>
          </Pressable>
          {nandaCatalogLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color="#1E3A8A" />
              <Text style={styles.helperText}>Preparando índice de búsqueda...</Text>
            </View>
          ) : null}
          {nandaCatalogError ? <Text style={[styles.helperText, styles.errorText]}>{nandaCatalogError}</Text> : null}
        </View>
      ) : null}

      {enabled ? (
        <TextInput
          accessibilityLabel={`Buscar ${label}`}
          testID={`diagnosis-search-${name}`}
          placeholder="Buscar diagnóstico..."
          value={query}
          onChangeText={(text) => {
            setQuery(text);
            if (nandaCatalogError) {
              setNandaCatalogError(null);
            }
          }}
          style={styles.input}
        />
      ) : null}

      {enabled && query.trim() ? (
        <View>
          <Text style={styles.helperText}>{helperText}</Text>
        </View>
      ) : null}

      {enabled && isSearching && query.trim() ? <Text style={styles.helperText}>Buscando en el catálogo...</Text> : null}
      {enabled && validatingCode ? <Text style={styles.helperText}>Validando código SNOMED...</Text> : null}
      {fieldError ? <Text style={[styles.helperText, styles.errorText]}>{fieldError}</Text> : null}

      {enabled && suggestions.length > 0 ? (
        <FlatList
          data={suggestions}
          keyExtractor={(item) => `${item.system}-${item.code}`}
          style={styles.suggestions}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          removeClippedSubviews
          initialNumToRender={12}
          maxToRenderPerBatch={20}
          windowSize={6}
          testID="diagnosis-suggestions-list"
          getItemLayout={(_data, index) => ({
            length: SUGGESTION_ROW_HEIGHT,
            offset: SUGGESTION_ROW_HEIGHT * index,
            index,
          })}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => void handleSelect(item)}
              style={({ pressed }) => [styles.suggestionItem, pressed ? { opacity: 0.75 } : null]}
              accessibilityRole="button"
              testID={`diagnosis-suggestion-${item.system}-${item.code}`}
            >
              <Text style={styles.suggestionText}>
                {item.display} ({item.code}) · {item.system}
              </Text>
            </Pressable>
          )}
        />
      ) : null}

      <View style={styles.selectedList}>
        {name === 'dxMedicalStructured' && canonicalMedicalDiagnosis?.code ? (
          <View style={styles.selectedItem} testID="diagnosis-primary-snomed">
            <View style={styles.selectedHeader}>
              <Text style={styles.selectedTitle}>{canonicalMedicalDiagnosis.display}</Text>
              <Text style={styles.pill}>SNOMED · {canonicalMedicalDiagnosis.code}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Pressable
                accessibilityRole="button"
                testID="diagnosis-primary-snomed-remove"
                onPress={() =>
                  setValue('dxMedical', null, {
                    shouldDirty: true,
                    shouldTouch: true,
                    shouldValidate: true,
                  })
                }
                style={({ pressed }) => [styles.removeButton, pressed ? { opacity: 0.85 } : null]}
              >
                <Text style={styles.removeButtonText}>Eliminar</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        {fields.map((field, index) => {
          const noteName = `${name}.${index}.freeTextNote` as const;

          return (
            <View key={field.id} style={styles.selectedItem}>
              <View style={styles.selectedHeader}>
                <Text style={styles.selectedTitle}>{field.display}</Text>
                <Text style={styles.pill}>
                  {field.system} · {field.code}
                </Text>
              </View>

              <Controller
                control={control}
                name={noteName}
                defaultValue={field.freeTextNote ?? ''}
                render={({ field: { onChange, onBlur, value } }) => (
                  <TextInput
                    style={styles.noteInput}
                    placeholder="Nota libre (opcional)"
                    multiline
                    value={typeof value === 'string' ? value : ''}
                    onBlur={onBlur}
                    onChangeText={onChange}
                  />
                )}
              />

              <View style={{ alignItems: 'flex-end' }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => remove(index)}
                  style={({ pressed }) => [styles.removeButton, pressed ? { opacity: 0.85 } : null]}
                >
                  <Text style={styles.removeButtonText}>Eliminar</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
};

export default DiagnosisAutocomplete;

