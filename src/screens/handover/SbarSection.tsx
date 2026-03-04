import React from 'react';
import { ActivityIndicator, Button, Text, TextInput, View } from 'react-native';
import { Controller, useFormContext } from 'react-hook-form';
import { type HandoverValues as HandoverFormValues } from '@/src/validation/schemas';
import { t } from '@/src/i18n';

export type SbarSectionProps = {
  styles: Record<string, any>;
  aiSbarAvailable: boolean;
  isRefiningSbarWithAI: boolean;
  aiSbarGenerationAvailable: boolean;
  isGeneratingSbarWithAI: boolean;
  handleGenerateSbarWithAi: () => void;
  handleGenerateSbarSuggestion: () => void;
  handleRefineSbarWithAi: () => void;
  sbarHelperMessage: string | null;
  sbarAiError: string | null;
  sbarSituationError?: string;
  sbarBackgroundError?: string;
  sbarAssessmentError?: string;
  sbarRecommendationError?: string;
  sbarFullTextError?: string;
  hideLegacyFields?: boolean;
};

export const SbarSection: React.FC<SbarSectionProps> = ({
  styles,
  aiSbarAvailable,
  isRefiningSbarWithAI,
  aiSbarGenerationAvailable,
  isGeneratingSbarWithAI,
  handleGenerateSbarWithAi,
  handleGenerateSbarSuggestion,
  handleRefineSbarWithAi,
  sbarHelperMessage,
  sbarAiError,
  sbarSituationError,
  sbarBackgroundError,
  sbarAssessmentError,
  sbarRecommendationError,
  sbarFullTextError,
  hideLegacyFields,
}) => {
  const { control } = useFormContext<HandoverFormValues>();
  const aiUnavailableMessage =
    !aiSbarAvailable || !aiSbarGenerationAvailable ? t('handover.sbarAiDisabled') : null;

  return (
    <>
      <View style={styles.inlineActions}>
        <Button
          title={
            aiSbarGenerationAvailable
              ? isGeneratingSbarWithAI
                ? t('handover.sbarGenerating')
                : t('handover.sbarGenerate')
              : t('handover.aiNotAvailable')
          }
          onPress={handleGenerateSbarWithAi}
          disabled={!aiSbarGenerationAvailable || isGeneratingSbarWithAI}
        />
        <View style={styles.secondaryButton}>
          <Button title={t('handover.sbarSuggested')} onPress={handleGenerateSbarSuggestion} />
        </View>
        <View style={styles.secondaryButton}>
          <Button
            title={
              aiSbarAvailable
                ? isRefiningSbarWithAI
                  ? t('handover.sbarRefining')
                  : t('handover.sbarRefine')
                : t('handover.aiNotAvailable')
            }
            onPress={handleRefineSbarWithAi}
            disabled={!aiSbarAvailable || isRefiningSbarWithAI}
          />
        </View>
        {isGeneratingSbarWithAI || isRefiningSbarWithAI ? (
          <ActivityIndicator style={{ marginLeft: 12 }} />
        ) : null}
      </View>
      {aiUnavailableMessage ? <Text style={styles.helperText}>{aiUnavailableMessage}</Text> : null}
      {sbarHelperMessage ? <Text style={styles.helperText}>{sbarHelperMessage}</Text> : null}
      {sbarAiError ? <Text style={styles.dictationError}>{sbarAiError}</Text> : null}
      <View style={styles.field}>
        <Text style={styles.label}>{t('handover.sbarSituationLabel')}</Text>
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
        <Text style={styles.label}>{t('handover.sbarBackgroundLabel')}</Text>
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
        <Text style={styles.label}>{t('handover.sbarAssessmentLabel')}</Text>
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
        <Text style={styles.label}>{t('handover.sbarRecommendationLabel')}</Text>
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
      {!hideLegacyFields ? (
        <View style={styles.field}>
          <Text style={styles.label}>{t('handover.sbarFullTextLabel')}</Text>
          <Controller
            control={control}
            name="sbarFullText"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={[styles.input, styles.textArea]}
                multiline
                onBlur={onBlur}
                value={value ?? ''}
                onChangeText={onChange}
                placeholder={t('handover.sbarFullTextPlaceholder')}
              />
            )}
          />
          {sbarFullTextError ? <Text style={styles.error}>{sbarFullTextError}</Text> : null}
        </View>
      ) : null}
    </>
  );
};
