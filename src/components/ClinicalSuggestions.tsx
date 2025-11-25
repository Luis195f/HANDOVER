import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View, Button } from 'react-native';

import type { SuggestionsResult } from '@/src/lib/ai-suggestions';

interface ClinicalSuggestionsProps {
  suggestions: SuggestionsResult | null;
  isLoading: boolean;
  onRefresh?: () => void;
  errorMessage?: string | null;
}

export function ClinicalSuggestions({ suggestions, isLoading, onRefresh, errorMessage }: ClinicalSuggestionsProps) {
  return (
    <View style={styles.card} accessibilityRole="summary">
      <View style={styles.header}>
        <Text style={styles.title}>Sugerencias de intervenciones (IA – apoyo a la decisión)</Text>
        {onRefresh ? (
          <Button title="Actualizar" onPress={onRefresh} disabled={isLoading} accessibilityLabel="Refrescar sugerencias IA" />
        ) : null}
      </View>
      {isLoading ? <ActivityIndicator size="small" /> : null}
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      {suggestions ? (
        <View style={styles.content}>
          <View style={styles.list}>
            {suggestions.interventions.map((item) => (
              <Text key={item} style={styles.item}>
                • {item}
              </Text>
            ))}
          </View>
          {suggestions.rationale ? <Text style={styles.rationale}>{suggestions.rationale}</Text> : null}
        </View>
      ) : null}
      <Text style={styles.helper}>
        Revisa y adapta estas sugerencias según tu criterio profesional. No sustituyen el juicio clínico.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5F5',
    backgroundColor: '#F8FAFF',
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {
    flex: 1,
    fontWeight: '700',
    fontSize: 15,
    color: '#111827',
  },
  content: {
    gap: 6,
  },
  list: {
    gap: 4,
  },
  item: {
    color: '#1F2937',
    fontSize: 14,
  },
  rationale: {
    color: '#374151',
    fontSize: 14,
  },
  helper: {
    color: '#4B5563',
    fontSize: 12,
  },
  error: {
    color: '#B45309',
    fontSize: 13,
  },
});

export default ClinicalSuggestions;
