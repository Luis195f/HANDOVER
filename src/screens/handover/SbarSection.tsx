import React from 'react';
import { ActivityIndicator, Button, Text, TextInput, View } from 'react-native';
import { Controller, useFormContext } from 'react-hook-form';
import { type HandoverValues as HandoverFormValues } from '@/src/validation/schemas';

export type SbarSectionProps = {
  styles: Record<string, any>;
  aiSbarAvailable: boolean;
  isRefiningSbarWithAI: boolean;
  handleGenerateSbarSuggestion: () => void;
  handleRefineSbarWithAi: () => void;
  sbarHelperMessage: string | null;
  sbarAiError: string | null;
  sbarSituationError?: string;
  sbarBackgroundError?: string;
  sbarAssessmentError?: string;
  sbarRecommendationError?: string;
};

export const SbarSection: React.FC<SbarSectionProps> = ({
  styles,
  aiSbarAvailable,
  isRefiningSbarWithAI,
  handleGenerateSbarSuggestion,
  handleRefineSbarWithAi,
  sbarHelperMessage,
  sbarAiError,
  sbarSituationError,
  sbarBackgroundError,
  sbarAssessmentError,
  sbarRecommendationError,
}) => {
  const { control } = useFormContext<HandoverFormValues>();

  return (
    <>
      <View style={styles.inlineActions}>
        <Button title="Generar SBAR sugerida" onPress={handleGenerateSbarSuggestion} />
        <View style={styles.secondaryButton}>
          <Button
            title={
              aiSbarAvailable
                ? isRefiningSbarWithAI
                  ? 'Refinando SBAR con IA…'
                  : 'Refinar SBAR con IA'
                : 'IA no disponible'
            }
            onPress={handleRefineSbarWithAi}
            disabled={!aiSbarAvailable || isRefiningSbarWithAI}
          />
        </View>
        {isRefiningSbarWithAI ? <ActivityIndicator style={{ marginLeft: 12 }} /> : null}
      </View>
      {sbarHelperMessage ? <Text style={styles.helperText}>{sbarHelperMessage}</Text> : null}
      {sbarAiError ? <Text style={styles.dictationError}>{sbarAiError}</Text> : null}
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
    </>
  );
};
