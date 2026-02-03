import React, { useEffect, useState } from 'react';
import { Alert, Button, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFormContext } from 'react-hook-form';

import type { HandoverValues } from '@/src/validation/schemas';
import type { BedsideChecklistItem } from '@/src/config/bedsideChecklist';
import { BedsideChecklistSection } from './BedsideChecklistSection';
import { isBedsideChecklistComplete } from '@/src/lib/bedsideChecklist';
import { t } from '@/src/i18n';
import { useThemeTokens } from '@/src/theme';

type Props = {
  visible: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  highlightMissing?: boolean;
  items: BedsideChecklistItem[];
};

export function BedsideChecklistModal({
  visible,
  onCancel,
  onConfirm,
  highlightMissing = false,
  items,
}: Props) {
  const form = useFormContext<HandoverValues>();
  const { colors } = useThemeTokens();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attemptedConfirm, setAttemptedConfirm] = useState(false);

  useEffect(() => {
    if (!visible) {
      setErrorMessage(null);
      setAttemptedConfirm(false);
    }
  }, [visible]);

  const handleConfirm = () => {
    const checklist = form.getValues('bedsideChecklist');
    if (!isBedsideChecklistComplete(checklist, items)) {
      const message = t('bedsideChecklist.incompleteMessage');
      setErrorMessage(message);
      setAttemptedConfirm(true);
      Alert.alert(t('bedsideChecklist.incompleteTitle'), message, [
        { text: t('common.understood') },
      ]);
      return;
    }

    setErrorMessage(null);
    setAttemptedConfirm(false);
    onConfirm();
  };

  const handleCancel = () => {
    setErrorMessage(null);
    setAttemptedConfirm(false);
    onCancel();
  };

  return (
    <Modal
      animationType="slide"
      transparent
      visible={visible}
      onRequestClose={() => {}}
    >
      <View style={styles.overlay}>
        <View style={styles.card} testID="bedsideChecklistModal">
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.title}>{t('bedsideChecklist.title')}</Text>
            <Text style={styles.helperText}>{t('bedsideChecklist.helperPrimary')}</Text>
            <Text style={styles.helperText}>
              {t('bedsideChecklist.helperSecondary')}
            </Text>

            <BedsideChecklistSection
              items={items}
              highlightMissing={highlightMissing || attemptedConfirm}
            />

            {errorMessage ? (
              <Text style={[styles.error, { color: colors.danger }]}>{errorMessage}</Text>
            ) : null}

            <View style={styles.actions}>
              <View style={styles.actionButton}>
                <Button title={t('bedsideChecklist.backToForm')} onPress={handleCancel} />
              </View>
              <View style={styles.actionButton}>
                <Button title={t('bedsideChecklist.confirmFinish')} onPress={handleConfirm} />
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    maxHeight: '90%',
    width: '100%',
  },
  content: {
    padding: 20,
    gap: 12,
  },
  title: { fontSize: 20, fontWeight: '700' },
  helperText: { color: '#374151', fontSize: 14, lineHeight: 20 },
  actions: {
    marginTop: 12,
    gap: 8,
  },
  actionButton: {},
  error: { fontWeight: '600' },
});
