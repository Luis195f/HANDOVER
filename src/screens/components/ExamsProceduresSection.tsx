import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useFieldArray, useFormContext } from 'react-hook-form';

import type { HandoverValues as HandoverFormValues } from '@/src/validation/schemas';
import type { ExamItem, ProcedureItem } from '@/src/types/handover';

const EXAM_TYPE_LABELS: Record<ExamItem['type'], string> = {
  laboratory: 'Laboratorio',
  imaging: 'Imagen',
  other: 'Otro',
};

const EXAM_STATE_LABELS: Record<ExamItem['state'], string> = {
  result: 'Resultado',
  pending: 'Pendiente',
};

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12 },
  card: {
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    backgroundColor: '#fff',
  },
  field: { marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 6 },
  input: {
    borderColor: '#CBD5E1',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  segmentedRow: { flexDirection: 'row', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
  },
  chipActive: {
    backgroundColor: '#2563EB',
    borderColor: '#1D4ED8',
  },
  chipText: { color: '#111827', fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  addButton: {
    backgroundColor: '#2563EB',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  addButtonDisabled: { opacity: 0.5 },
  addButtonText: { color: '#fff', fontWeight: '700' },
  list: { gap: 10 },
  listItem: {
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#fff',
  },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  listTitle: { fontWeight: '700', flex: 1 },
  badgeRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 6 },
  badge: {
    backgroundColor: '#EEF2FF',
    color: '#312E81',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: '700',
  },
  deleteButton: { marginLeft: 12 },
  deleteButtonText: { color: '#DC2626', fontWeight: '700' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  helper: { color: '#6B7280', marginTop: 4 },
  subsectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
});

export function ExamsProceduresSection() {
  const { control } = useFormContext<HandoverFormValues>();
  const { fields: examFields, append: appendExam, remove: removeExam } = useFieldArray({
    control,
    name: 'exams',
  });
  const {
    fields: procedureFields,
    append: appendProcedure,
    remove: removeProcedure,
  } = useFieldArray({
    control,
    name: 'procedures',
  });

  const [nextExam, setNextExam] = useState<ExamItem>({
    type: 'laboratory',
    state: 'result',
    description: '',
  });
  const [nextProcedure, setNextProcedure] = useState<ProcedureItem>({ description: '', done: false });

  const canAddExam = useMemo(() => nextExam.description.trim().length > 0, [nextExam.description]);
  const canAddProcedure = useMemo(
    () => nextProcedure.description.trim().length > 0,
    [nextProcedure.description],
  );

  const handleAddExam = () => {
    if (!canAddExam) {
      console.warn(
        { code: 'HANDOVER_UI_EXAMS_ADD_BLOCKED_EMPTY', field: 'exams.description', len: 0 },
        'UI blocked adding exam: empty description.',
      );
      return;
    }
    appendExam({ ...nextExam, description: nextExam.description.trim() });
    setNextExam((prev) => ({ ...prev, description: '' }));
  };

  const handleAddProcedure = () => {
    if (!canAddProcedure) {
      console.warn(
        { code: 'HANDOVER_UI_PROCEDURES_ADD_BLOCKED_EMPTY', field: 'procedures.description', len: 0 },
        'UI blocked adding procedure: empty description.',
      );
      return;
    }
    appendProcedure({ ...nextProcedure, description: nextProcedure.description.trim() });
    setNextProcedure((prev) => ({ ...prev, description: '' }));
  };

  return (
    <View style={{ gap: 20 }}>
      <View>
        <Text style={styles.sectionTitle}>Exámenes y procedimientos</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.subsectionTitle}>Exámenes diagnósticos</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Tipo</Text>
          <View style={styles.segmentedRow}>
            {Object.entries(EXAM_TYPE_LABELS).map(([value, label]) => (
              <Pressable
                key={value}
                accessibilityLabel={`Seleccionar tipo ${label}`}
                style={[styles.chip, nextExam.type === value ? styles.chipActive : null]}
                onPress={() => setNextExam((prev) => ({ ...prev, type: value as ExamItem['type'] }))}
              >
                <Text
                  style={[styles.chipText, nextExam.type === value ? styles.chipTextActive : null]}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Estado</Text>
          <View style={styles.segmentedRow}>
            {Object.entries(EXAM_STATE_LABELS).map(([value, label]) => (
              <Pressable
                key={value}
                accessibilityLabel={`Seleccionar estado ${label}`}
                style={[styles.chip, nextExam.state === value ? styles.chipActive : null]}
                onPress={() => setNextExam((prev) => ({ ...prev, state: value as ExamItem['state'] }))}
              >
                <Text
                  style={[styles.chipText, nextExam.state === value ? styles.chipTextActive : null]}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.helper}>Resultado / Pendiente</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Descripción</Text>
          <TextInput
            accessibilityLabel="Descripción de examen"
            style={styles.input}
            placeholder="Hemograma completo, Rx tórax, etc."
            value={nextExam.description}
            onChangeText={(text) => setNextExam((prev) => ({ ...prev, description: text }))}
          />
        </View>

        <Pressable
          accessibilityLabel="Añadir examen"
          onPress={handleAddExam}
          accessibilityState={{ disabled: !canAddExam }}
          style={[styles.addButton, !canAddExam ? styles.addButtonDisabled : null]}
        >
          <Text style={styles.addButtonText}>Añadir examen</Text>
        </Pressable>

        {examFields.length > 0 ? (
          <View style={[styles.list, { marginTop: 12 }]}>
            {examFields.map((field, index) => {
              const item = field as ExamItem;
              return (
                <View key={field.id} style={styles.listItem}>
                  <View style={styles.listHeader}>
                    <Text style={styles.listTitle}>{item.description}</Text>
                    <Pressable
                      accessibilityLabel={`Eliminar examen ${item.description}`}
                      style={styles.deleteButton}
                      onPress={() => removeExam(index)}
                    >
                      <Text style={styles.deleteButtonText}>Eliminar</Text>
                    </Pressable>
                  </View>
                  <View style={styles.badgeRow}>
                    <Text style={styles.badge}>{EXAM_TYPE_LABELS[item.type]}</Text>
                    <Text style={styles.badge}>{EXAM_STATE_LABELS[item.state]}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.subsectionTitle}>Procedimientos</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Descripción</Text>
          <TextInput
            accessibilityLabel="Descripción de procedimiento"
            style={styles.input}
            placeholder="Ej: Curación, sondaje, etc."
            value={nextProcedure.description}
            onChangeText={(text) => setNextProcedure((prev) => ({ ...prev, description: text }))}
          />
        </View>

        <View style={[styles.field, styles.switchRow]}>
          <Text style={styles.label}>Realizado</Text>
          <Switch
            accessibilityLabel="Marcar procedimiento realizado"
            value={nextProcedure.done}
            onValueChange={(value) => setNextProcedure((prev) => ({ ...prev, done: value }))}
          />
        </View>

        <Pressable
          accessibilityLabel="Añadir procedimiento"
          onPress={handleAddProcedure}
          accessibilityState={{ disabled: !canAddProcedure }}
          style={[styles.addButton, !canAddProcedure ? styles.addButtonDisabled : null]}
        >
          <Text style={styles.addButtonText}>Añadir procedimiento</Text>
        </Pressable>

        {procedureFields.length > 0 ? (
          <View style={[styles.list, { marginTop: 12 }]}>
            {procedureFields.map((field, index) => {
              const item = field as ProcedureItem;
              return (
                <View key={field.id} style={styles.listItem}>
                  <View style={styles.listHeader}>
                    <Text style={styles.listTitle}>{item.description}</Text>
                    <Pressable
                      accessibilityLabel={`Eliminar procedimiento ${item.description}`}
                      style={styles.deleteButton}
                      onPress={() => removeProcedure(index)}
                    >
                      <Text style={styles.deleteButtonText}>Eliminar</Text>
                    </Pressable>
                  </View>
                  <View style={styles.badgeRow}>
                    <Text style={styles.badge}>{item.done ? 'Realizado' : 'Pendiente'}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default ExamsProceduresSection;
