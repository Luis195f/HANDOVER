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

const PRIORITY_LABELS: Record<NonNullable<ExamItem['priority']>, string> = {
  routine: 'Rutina',
  urgent: 'Urgente',
  critical: 'Crítico',
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
  segmentedRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
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
  hintText: {
    color: '#6B7280',
    fontSize: 13,
    fontStyle: 'italic',
    marginTop: 12,
  },
  subsectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  flex: { flex: 1 },
  spacer: { width: 12 },
  metaText: { marginTop: 6, color: '#4B5563' },
});

const defaultExam: ExamItem = {
  type: 'laboratory',
  state: 'result',
  description: '',
  priority: 'routine',
  dueBy: undefined,
  responsible: undefined,
};

const defaultProcedure: ProcedureItem = {
  description: '',
  done: false,
  priority: 'routine',
  scheduledFor: undefined,
  responsible: undefined,
  escalationCriteria: undefined,
};

export function ExamsProceduresSection() {
  const { control } = useFormContext<HandoverFormValues>();
  const { fields: examFields, append: appendExam, remove: removeExam } = useFieldArray<
    HandoverFormValues,
    'exams'
  >({ control, name: 'exams' });
  const {
    fields: procedureFields,
    append: appendProcedure,
    remove: removeProcedure,
  } = useFieldArray<HandoverFormValues, 'procedures'>({ control, name: 'procedures' });

  const [nextExam, setNextExam] = useState<ExamItem>(defaultExam);
  const [nextProcedure, setNextProcedure] = useState<ProcedureItem>(defaultProcedure);

  const canAddExam = useMemo(() => nextExam.description.trim().length > 0, [nextExam.description]);
  const canAddProcedure = useMemo(
    () => nextProcedure.description.trim().length > 0,
    [nextProcedure.description],
  );

  const handleAddExam = () => {
    if (!canAddExam) return;
    appendExam({
      ...nextExam,
      description: nextExam.description.trim(),
      dueBy: nextExam.dueBy?.trim() || undefined,
      responsible: nextExam.responsible?.trim() || undefined,
    });
    setNextExam(defaultExam);
  };

  const handleAddProcedure = () => {
    if (!canAddProcedure) return;
    appendProcedure({
      ...nextProcedure,
      description: nextProcedure.description.trim(),
      scheduledFor: nextProcedure.scheduledFor?.trim() || undefined,
      responsible: nextProcedure.responsible?.trim() || undefined,
      escalationCriteria: nextProcedure.escalationCriteria?.trim() || undefined,
    });
    setNextProcedure(defaultProcedure);
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
          <Text style={styles.label}>Prioridad</Text>
          <View style={styles.segmentedRow}>
            {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
              <Pressable
                key={value}
                accessibilityLabel={`Prioridad examen ${label}`}
                style={[styles.chip, nextExam.priority === value ? styles.chipActive : null]}
                onPress={() => setNextExam((prev) => ({ ...prev, priority: value as ExamItem['priority'] }))}
              >
                <Text style={[styles.chipText, nextExam.priority === value ? styles.chipTextActive : null]}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
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

        <View style={styles.row}>
          <View style={[styles.field, styles.flex]}>
            <Text style={styles.label}>Hora objetivo</Text>
            <TextInput
              accessibilityLabel="Hora objetivo de examen"
              style={styles.input}
              placeholder="2026-03-19T11:00:00Z"
              value={nextExam.dueBy ?? ''}
              onChangeText={(text) => setNextExam((prev) => ({ ...prev, dueBy: text }))}
            />
          </View>
          <View style={styles.spacer} />
          <View style={[styles.field, styles.flex]}>
            <Text style={styles.label}>Responsable</Text>
            <TextInput
              accessibilityLabel="Responsable de examen"
              style={styles.input}
              placeholder="Laboratorio / imagen / enfermería"
              value={nextExam.responsible ?? ''}
              onChangeText={(text) => setNextExam((prev) => ({ ...prev, responsible: text }))}
            />
          </View>
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
              const item: ExamItem = {
                type: field.type ?? 'laboratory',
                state: field.state ?? 'result',
                description: field.description ?? '',
                priority: field.priority,
                dueBy: field.dueBy,
                responsible: field.responsible,
              };
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
                    {item.priority ? <Text style={styles.badge}>{PRIORITY_LABELS[item.priority]}</Text> : null}
                  </View>
                  {item.dueBy ? <Text style={styles.metaText}>Hora objetivo: {item.dueBy}</Text> : null}
                  {item.responsible ? <Text style={styles.metaText}>Responsable: {item.responsible}</Text> : null}
                </View>
              );
            })}
          </View>
        ) : null}
        <Text style={styles.hintText}>
          Registra estudios relevantes y marca prioridad si condicionan la continuidad del turno.
        </Text>
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

        <View style={styles.field}>
          <Text style={styles.label}>Prioridad</Text>
          <View style={styles.segmentedRow}>
            {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
              <Pressable
                key={value}
                accessibilityLabel={`Prioridad procedimiento ${label}`}
                style={[styles.chip, nextProcedure.priority === value ? styles.chipActive : null]}
                onPress={() => setNextProcedure((prev) => ({ ...prev, priority: value as ProcedureItem['priority'] }))}
              >
                <Text
                  style={[
                    styles.chipText,
                    nextProcedure.priority === value ? styles.chipTextActive : null,
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.row}>
          <View style={[styles.field, styles.flex]}>
            <Text style={styles.label}>Programado para</Text>
            <TextInput
              accessibilityLabel="Hora de procedimiento"
              style={styles.input}
              placeholder="2026-03-19T12:00:00Z"
              value={nextProcedure.scheduledFor ?? ''}
              onChangeText={(text) => setNextProcedure((prev) => ({ ...prev, scheduledFor: text }))}
            />
          </View>
          <View style={styles.spacer} />
          <View style={[styles.field, styles.flex]}>
            <Text style={styles.label}>Responsable</Text>
            <TextInput
              accessibilityLabel="Responsable de procedimiento"
              style={styles.input}
              placeholder="Enfermería / médico"
              value={nextProcedure.responsible ?? ''}
              onChangeText={(text) => setNextProcedure((prev) => ({ ...prev, responsible: text }))}
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Criterio de escalado</Text>
          <TextInput
            accessibilityLabel="Criterio de escalado de procedimiento"
            style={styles.input}
            placeholder="Ej: avisar si sangrado activo o mala tolerancia"
            value={nextProcedure.escalationCriteria ?? ''}
            onChangeText={(text) => setNextProcedure((prev) => ({ ...prev, escalationCriteria: text }))}
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
              const item: ProcedureItem = {
                description: field.description ?? '',
                done: field.done ?? false,
                priority: field.priority,
                scheduledFor: field.scheduledFor,
                responsible: field.responsible,
                escalationCriteria: field.escalationCriteria,
              };
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
                    {item.priority ? <Text style={styles.badge}>{PRIORITY_LABELS[item.priority]}</Text> : null}
                  </View>
                  {item.scheduledFor ? <Text style={styles.metaText}>Programado: {item.scheduledFor}</Text> : null}
                  {item.responsible ? <Text style={styles.metaText}>Responsable: {item.responsible}</Text> : null}
                  {item.escalationCriteria ? (
                    <Text style={styles.metaText}>Escalado: {item.escalationCriteria}</Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}
        <Text style={styles.hintText}>
          Marca si quedó hecho, quién lo asume y cuándo debe resolverse si sigue pendiente.
        </Text>
      </View>
    </View>
  );
}

export default ExamsProceduresSection;
