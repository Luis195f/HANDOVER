import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Fuse from '@/src/lib/fuse';
import { useController, type Control, type FieldPath } from 'react-hook-form';

import {
  SNOMED_SYSTEM,
  resolveSnomedCoding,
  snomedTerms,
  type SnomedCoding,
  type SnomedTerm,
} from '@/src/data/snomed-dict';

type SnomedFormValues = {
  dxMedical: SnomedCoding | null;
  dxNursing: SnomedCoding | null;
};

type SnomedFieldName = keyof SnomedFormValues;

type SnomedFieldPath<TFieldValues extends SnomedFormValues> = Extract<
  FieldPath<TFieldValues>,
  SnomedFieldName
>;

interface AutocompleteSnomedCodingProps<TFieldValues extends SnomedFormValues> {
  name: SnomedFieldPath<TFieldValues>;
  control: Control<TFieldValues>;
  label: string;
  placeholder?: string;
  minChars?: number;
  limit?: number;
}

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
  helperText: { color: '#4B5563', fontSize: 13 },
  errorText: { color: '#DC2626' },
});

export const AutocompleteSnomedCoding = <TFieldValues extends SnomedFormValues>({
  name,
  control,
  label,
  placeholder,
  minChars = 2,
  limit = 10,
}: AutocompleteSnomedCodingProps<TFieldValues>) => {
  const {
    field,
    fieldState: { error },
  } = useController<TFieldValues, SnomedFieldPath<TFieldValues>>({ name, control });
  const [query, setQuery] = useState('');
  const [isFocused, setIsFocused] = useState(false);

  const fuse = useMemo(
    () =>
      new Fuse(snomedTerms, {
        keys: ['display'],
        threshold: 0.35,
        ignoreLocation: true,
      }),
    [],
  );

  useEffect(() => {
    setQuery(field.value?.display ?? '');
  }, [field.value?.display]);

  const results = useMemo(() => {
    const trimmed = query.trim();
    if (trimmed.length < minChars) return [];
    return fuse.search(trimmed).map((result) => result.item).slice(0, limit);
  }, [fuse, limit, minChars, query]);

  const handleChangeText = (text: string) => {
    setQuery(text);
    setIsFocused(true);
    const resolved = resolveSnomedCoding(text);
    field.onChange(
      resolved ?? {
        system: SNOMED_SYSTEM,
        code: '',
        display: text,
      },
    );
  };

  const handleSelect = (item: SnomedTerm) => {
    field.onChange({
      system: SNOMED_SYSTEM,
      code: item.code,
      display: item.display,
    });
    setQuery(item.display);
    setIsFocused(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholder={placeholder}
        value={query}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          const resolved = resolveSnomedCoding(query);
          if (resolved) {
            field.onChange(resolved);
            setQuery(resolved.display);
          }
          field.onBlur();
          setIsFocused(false);
        }}
        onChangeText={handleChangeText}
        style={styles.input}
      />
      {error?.message ? (
        <Text style={[styles.helperText, styles.errorText]}>{error.message}</Text>
      ) : null}
      {isFocused && results.length > 0 ? (
        <FlatList
          data={results}
          keyExtractor={(item) => `${item.code}-${item.display}`}
          style={styles.suggestions}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => handleSelect(item)}
              style={({ pressed }) => [styles.suggestionItem, pressed ? { opacity: 0.75 } : null]}
              accessibilityRole="button"
            >
              <Text style={styles.suggestionText}>
                {item.display} ({item.code})
              </Text>
            </Pressable>
          )}
        />
      ) : null}
    </View>
  );
};

export default AutocompleteSnomedCoding;
