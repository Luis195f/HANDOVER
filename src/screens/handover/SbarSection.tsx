import React from 'react';
import { ActivityIndicator, Button, Text, TextInput, View } from 'react-native';
import { Controller, useFormContext } from 'react-hook-form';
import { sha256 } from 'js-sha256';
import { type HandoverValues as HandoverFormValues, type SbarProvenance, type SbarProvenanceField } from '@/src/validation/schemas';
import { t } from '@/src/i18n';

export type SbarSectionProps = {
  styles: Record<string, any>;
  aiSbarAvailable: boolean;
  isRefiningSbarWithAI: boolean;
  aiSbarGenerationAvailable: boolean;
  isGeneratingSbarWithAI: boolean;
  canUseAiSbarAssist: boolean;
  handleGenerateSbarWithAi: () => void;
  handleGenerateSbarSuggestion: () => void;
  handleRefineSbarWithAi: () => void;
  pendingSbarSuggestionPreview: string | null;
  onAcceptPendingSbarSuggestion: () => void;
  onRejectPendingSbarSuggestion: () => void;
  sbarHelperMessage: string | null;
  sbarAiError: string | null;
  sbarAiTraceabilityMessage: string | null;
  sbarSituationError?: string;
  sbarBackgroundError?: string;
  sbarAssessmentError?: string;
  sbarRecommendationError?: string;
  sbarFullTextError?: string;
  hideLegacyFields?: boolean;
  isDemo?: boolean;
  provenance?: SbarProvenance;
  onHumanEdit?: (field: SbarProvenanceField, text: string) => void;
};

export const SbarSection: React.FC<SbarSectionProps> = ({
  styles,
  aiSbarAvailable,
  isRefiningSbarWithAI,
  aiSbarGenerationAvailable,
  isGeneratingSbarWithAI,
  canUseAiSbarAssist,
  handleGenerateSbarWithAi,
  handleGenerateSbarSuggestion,
  handleRefineSbarWithAi,
  pendingSbarSuggestionPreview,
  onAcceptPendingSbarSuggestion,
  onRejectPendingSbarSuggestion,
  sbarHelperMessage,
  sbarAiError,
  sbarAiTraceabilityMessage,
  sbarSituationError,
  sbarBackgroundError,
  sbarAssessmentError,
  sbarRecommendationError,
  sbarFullTextError,
  hideLegacyFields,
  isDemo = false,
  provenance,
  onHumanEdit,
}) => {
  const { control, formState, getValues } = useFormContext<HandoverFormValues>();
  const sourceFor = (field: SbarProvenanceField) => {
    const record = provenance?.[field];
    const text = getValues(field);
    return record && typeof text === 'string' && sha256(text.trim()) === record.contentHash ? record.source : undefined;
  };
  const labelFor = (field: SbarProvenanceField) => {
    switch (sourceFor(field)) {
      case 'clinician-authored': return t('handover.sbarClinicianProvenance');
      case 'local-deterministic': return t(isDemo ? 'handover.sbarSyntheticProvenance' : 'handover.sbarLocalProvenance');
      case 'external-ai': return t('handover.sbarExternalProvenance');
      case 'ai-edited-by-human': return t('handover.sbarAiEditedProvenance');
      default: return t('handover.sbarUnknownProvenance');
    }
  };
  const primarySource = sourceFor('closingSummary');
  const differingLabel = (field: SbarProvenanceField) => sourceFor(field) !== primarySource
    ? <Text style={styles.helperText}>{labelFor(field)}</Text> : null;
  const aiUnavailableMessage =
    !aiSbarAvailable || !aiSbarGenerationAvailable ? t('handover.sbarAiDisabled') : null;

  return (
    <>
      <Text style={styles.helperText}>
        {labelFor('closingSummary')}
      </Text>
      {formState.isDirty ? (
        <View style={styles.inlineActions}>
          <Button title={t('handover.sbarRegenerate')} onPress={handleGenerateSbarSuggestion} />
        </View>
      ) : null}
      {!isDemo ? <View style={styles.inlineActions}>
        <Button
          title={
            aiSbarGenerationAvailable
              ? isGeneratingSbarWithAI
                ? t('handover.sbarGenerating')
                : t('handover.sbarGenerate')
              : t('handover.aiNotAvailable')
          }
          onPress={handleGenerateSbarWithAi}
          disabled={!aiSbarGenerationAvailable || !canUseAiSbarAssist || isGeneratingSbarWithAI}
        />
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
            disabled={!aiSbarAvailable || !canUseAiSbarAssist || isRefiningSbarWithAI}
          />
        </View>
        {isGeneratingSbarWithAI || isRefiningSbarWithAI ? (
          <ActivityIndicator style={{ marginLeft: 12 }} />
        ) : null}
      </View> : null}
      {!isDemo && aiUnavailableMessage ? <Text style={styles.helperText}>{aiUnavailableMessage}</Text> : null}
      {!isDemo && sbarAiTraceabilityMessage ? <Text style={styles.helperText}>{sbarAiTraceabilityMessage}</Text> : null}
      {sbarHelperMessage ? <Text style={styles.helperText}>{sbarHelperMessage}</Text> : null}
      {!isDemo && sbarAiError ? <Text style={styles.dictationError}>{sbarAiError}</Text> : null}
      {pendingSbarSuggestionPreview ? (
        <View style={styles.sbarPreview}>
          <Text style={styles.sbarTitle}>{t('handover.sbarPendingReviewTitle')}</Text>
          <Text style={styles.sbarText}>{pendingSbarSuggestionPreview}</Text>
          <Text style={styles.helperText}>{t('handover.sbarPendingReviewHelper')}</Text>
          <View style={styles.inlineActions}>
            <Button title={t('handover.sbarAcceptSuggestion')} onPress={onAcceptPendingSbarSuggestion} />
            <View style={styles.secondaryButton}>
              <Button title={t('handover.sbarRejectSuggestion')} onPress={onRejectPendingSbarSuggestion} />
            </View>
          </View>
        </View>
      ) : null}
      <View style={styles.field}>
        <Text style={styles.label}>{t('handover.sbarSituationLabel')}</Text>
        <Controller
          control={control}
          name="sbarSituation"
          render={({ field: { onChange, onBlur, value } }) => (
            <TextInput
              style={[styles.input, styles.textArea]}
              multiline
              testID="handover-sbar-situation"
              onBlur={onBlur}
              value={value ?? ''}
              onChangeText={(text) => { onHumanEdit?.('sbarSituation', text); onChange(text); }}
            />
          )}
        />
        {differingLabel('sbarSituation')}
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
              testID="handover-sbar-background"
              onBlur={onBlur}
              value={value ?? ''}
              onChangeText={(text) => { onHumanEdit?.('sbarBackground', text); onChange(text); }}
            />
          )}
        />
        {differingLabel('sbarBackground')}
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
              testID="handover-sbar-assessment"
              onBlur={onBlur}
              value={value ?? ''}
              onChangeText={(text) => { onHumanEdit?.('sbarAssessment', text); onChange(text); }}
            />
          )}
        />
        {differingLabel('sbarAssessment')}
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
              testID="handover-sbar-recommendation"
              onBlur={onBlur}
              value={value ?? ''}
              onChangeText={(text) => { onHumanEdit?.('sbarRecommendation', text); onChange(text); }}
            />
          )}
        />
        {differingLabel('sbarRecommendation')}
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
                onChangeText={(text) => { onHumanEdit?.('sbarFullText', text); onChange(text); }}
                placeholder={t('handover.sbarFullTextPlaceholder')}
              />
            )}
          />
          {differingLabel('sbarFullText')}
          {sbarFullTextError ? <Text style={styles.error}>{sbarFullTextError}</Text> : null}
        </View>
      ) : null}
    </>
  );
};
