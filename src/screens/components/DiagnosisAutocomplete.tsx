import React, { useMemo, useState } from 'react';
import { Controller, useFieldArray, useFormContext } from 'react-hook-form';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  DIAGNOSIS_CODES,
  filterDiagnosisCodes,
  type DiagnosisCode,
  type DiagnosisSystem,
} from '../../catalogs/diagnosisCodes';
import type { HandoverStructuredDiagnosis } from '../../types/handover';
import type { HandoverValues } from '../../validation/schemas';
import { validateSnomed } from '../../lib/terminology-validation';

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
    overflow: 'hidden',
  },
  suggestionItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
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
});

/**
 * IMPORTANTE:
 * - Limitamos el `name` SOLO a los dos arrays estructurados.
 * - Tipamos `useFieldArray` con el item real: HandoverStructuredDiagnosis.
 */
type DiagnosisArrayName = 'dxMedicalStructured' | 'dxNursingStructured';

interface DiagnosisAutocompleteProps {
  name: DiagnosisArrayName;
  label: string;
  systemsAllowed?: DiagnosisSystem[];
}

// BEGIN HANDOVER D3 – DiagnosisAutocomplete component
export const DiagnosisAutocomplete: React.FC<DiagnosisAutocompleteProps> = ({
  name,
  label,
  systemsAllowed,
}) => {
  const {
    control,
    setError,
    clearErrors,
    getValues,
    setValue,
    formState: { errors },
  } = useFormContext<HandoverValues>();

  // Tipado explícito para que `fields` sea HandoverStructuredDiagnosis + {id}
  const { fields, append, remove } = useFieldArray<
    HandoverValues,
    DiagnosisArrayName,
    'id'
  >({
    control,
    name,
  });

  const [query, setQuery] = useState('');
  const [validatingCode, setValidatingCode] = useState<string | null>(null);

  const suggestions = useMemo(
    () => filterDiagnosisCodes(query, systemsAllowed),
    [query, systemsAllowed],
  );

  // Error en arrays en RHF puede venir como objeto complejo; aquí mantenemos UX simple.
  const fieldError =
    (errors?.[name] as unknown as { message?: string } | undefined)?.message ?? undefined;

  const handleSelect = async (code: DiagnosisCode) => {
    const alreadySelected = fields.some(
      (field) => field.code === code.code && field.system === code.system,
    );
    if (alreadySelected) {
      setQuery('');
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
      const shouldAutofill = fields.length === 0 && code.system === 'NANDA' && currentLegacyText.length === 0;
      if (shouldAutofill) {
        setValue('dxNursing', code.display, {
          shouldDirty: true,
          shouldTouch: true,
          shouldValidate: true,
        });
      }
    }

    setQuery('');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>

      <TextInput
        placeholder="Buscar diagnóstico..."
        value={query}
        onChangeText={setQuery}
        style={styles.input}
      />

      {query.trim() ? (
        <View>
          <Text style={styles.helperText}>
            Sugerencias limitadas al catálogo demo ({DIAGNOSIS_CODES.length} códigos)
          </Text>
        </View>
      ) : null}

      {validatingCode ? <Text style={styles.helperText}>Validando código SNOMED...</Text> : null}

      {fieldError ? <Text style={[styles.helperText, styles.errorText]}>{fieldError}</Text> : null}

      {suggestions.length > 0 ? (
        <View style={styles.suggestions}>
          {suggestions.map((code) => (
            <Pressable
              key={`${code.system}-${code.code}`}
              onPress={() => void handleSelect(code)}
              style={({ pressed }) => [styles.suggestionItem, pressed ? { opacity: 0.75 } : null]}
              accessibilityRole="button"
            >
              <Text style={styles.suggestionText}>
                {code.display} ({code.code}) · {code.system}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.selectedList}>
        {fields.map((field, index) => {
          // `field` ya está tipado como HandoverStructuredDiagnosis + id
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
// END HANDOVER D3 – DiagnosisAutocomplete component

export default DiagnosisAutocomplete;
