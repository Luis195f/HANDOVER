import React from 'react';
import { Button, Text, TextInput, View } from 'react-native';
import { Controller, useFormContext } from 'react-hook-form';
import { type HandoverValues as HandoverFormValues } from '@/src/validation/schemas';
import TtsButton from '@/src/components/TtsButton';
import type { SttConfig, SttStatus } from '@/src/lib/stt';
import type { DictationField } from '@/src/screens/HandoverForm';

export type SummarySectionProps = {
  styles: Record<string, any>;
  dictationState: {
    activeDictationField: DictationField | null;
    sttStatus: SttStatus | null;
    dictationUnavailable: boolean;
    renderDictationStatus: (field: DictationField) => React.ReactNode;
    handleDictationPress: (field: DictationField, config: SttConfig) => void;
  };
  DictationMicButton: React.ComponentType<{ active: boolean; disabled?: boolean; label: string; onPress: () => void }>;
  sbarPreview: string | null;
  onGenerateSbar: () => void;
  onInsertSbar: () => void;
  onCloseSbarPreview: () => void;
};

export const SummarySection: React.FC<SummarySectionProps> = ({
  styles,
  dictationState,
  DictationMicButton,
  sbarPreview,
  onGenerateSbar,
  onInsertSbar,
  onCloseSbarPreview,
}) => {
  const { control, formState, watch } = useFormContext<HandoverFormValues>();
  const errors = formState.errors ?? {};
  const closingSummaryError = errors.closingSummary?.message as string | undefined;
  const { activeDictationField, sttStatus, dictationUnavailable, handleDictationPress, renderDictationStatus } =
    dictationState;

  return (
    <View style={styles.field}>
      <Text style={styles.label}>Resumen / cierre de turno</Text>
      <View style={styles.dictationRow}>
        <View style={styles.flex}>
          <Controller
            control={control}
            name="closingSummary"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                style={[styles.input, styles.textArea]}
                multiline
                placeholder="Resumen breve para el equipo entrante"
                onBlur={onBlur}
                value={value ?? ''}
                onChangeText={onChange}
              />
            )}
          />
        </View>
        <DictationMicButton
          active={activeDictationField === 'closingSummary' && sttStatus === 'listening'}
          disabled={dictationUnavailable}
          label="Dictar cierre"
          onPress={() =>
            handleDictationPress('closingSummary', {
              locale: 'es-ES',
              interimResults: true,
              maxSeconds: 60,
            })
          }
        />
      </View>
      {renderDictationStatus('closingSummary')}
      {closingSummaryError ? <Text style={styles.error}>{closingSummaryError}</Text> : null}
      <View style={styles.inlineActions}>
        <TtsButton text={watch('closingSummary') ?? ''} label="Escuchar resumen" />
        <View style={styles.secondaryButton}>
          <Button title="Generar SBAR" onPress={onGenerateSbar} />
        </View>
      </View>
      {sbarPreview ? (
        <View style={styles.sbarPreview}>
          <Text style={styles.sbarTitle}>Resumen SBAR sugerido</Text>
          <Text style={styles.sbarText}>{sbarPreview}</Text>
          <Text style={styles.helperText}>Revisa y ajusta el contenido según tu criterio clínico.</Text>
          <View style={styles.inlineActions}>
            <TtsButton text={sbarPreview ?? ''} label="Escuchar SBAR" />
            <View style={styles.secondaryButton}>
              <Button title="Insertar en resumen" onPress={onInsertSbar} />
            </View>
            <View style={styles.secondaryButton}>
              <Button title="Cerrar" onPress={onCloseSbarPreview} />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
};
