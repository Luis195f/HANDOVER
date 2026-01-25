import React, { useEffect, useState } from 'react';
import { Alert, Button, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFormContext } from 'react-hook-form';

import type { HandoverValues } from '@/src/validation/schemas';
import type { BedsideChecklistItem } from '@/src/config/bedsideChecklist';
import { BedsideChecklistSection } from './BedsideChecklistSection';
import { isBedsideChecklistComplete } from './bedsideChecklist.constants';

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
      const message = 'Debes completar todos los elementos de seguridad antes de finalizar.';
      setErrorMessage(message);
      setAttemptedConfirm(true);
      Alert.alert('Checklist incompleto', message, [{ text: 'Entendido' }]);
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
            <Text style={styles.title}>Verificación al pie de cama</Text>
            <Text style={styles.helperText}>Confirme los siguientes puntos con el paciente presente.</Text>
            <Text style={styles.helperText}>
              Verifique visualmente pulsera/identidad y confirme con el paciente; no verbalice datos sensibles.
            </Text>

            <BedsideChecklistSection
              items={items}
              highlightMissing={highlightMissing || attemptedConfirm}
            />

            {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

            <View style={styles.actions}>
              <View style={styles.actionButton}>
                <Button title="Volver al formulario" onPress={handleCancel} />
              </View>
              <View style={styles.actionButton}>
                <Button title="Confirmar y finalizar" onPress={handleConfirm} />
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
  error: { color: '#DC2626', fontWeight: '600' },
});
