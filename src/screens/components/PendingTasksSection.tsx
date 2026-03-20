import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFieldArray, useFormContext } from 'react-hook-form';

import type { PendingTask } from '@/src/types/handover';
import { zPendingTask, type HandoverValues as HandoverFormValues } from '@/src/validation/schemas';

type Option<TValue extends string> = {
  label: string;
  value: TValue;
};

type PendingTaskCategory = PendingTask['category'];
type PendingTaskPriority = PendingTask['priority'];
type PendingTaskStatus = PendingTask['status'];

const CATEGORY_OPTIONS: Array<Option<PendingTaskCategory>> = [
  { label: 'Pendiente crítico', value: 'critical-task' },
  { label: 'Reevaluación', value: 'reevaluation' },
  { label: 'Examen', value: 'exam-followup' },
  { label: 'Procedimiento', value: 'procedure-followup' },
  { label: 'Escalado', value: 'escalation' },
  { label: 'Otro', value: 'other' },
];

const PRIORITY_OPTIONS: Array<Option<PendingTaskPriority>> = [
  { label: 'Rutina', value: 'routine' },
  { label: 'Urgente', value: 'urgent' },
  { label: 'Crítico', value: 'critical' },
];

const STATUS_OPTIONS: Array<Option<PendingTaskStatus>> = [
  { label: 'Pendiente', value: 'pending' },
  { label: 'En curso', value: 'in_progress' },
  { label: 'Resuelto', value: 'done' },
];

const createTaskDraft = (): PendingTask => ({
  id: '',
  category: 'critical-task',
  title: '',
  status: 'pending',
  priority: 'urgent',
  dueBy: undefined,
  owner: undefined,
  escalationCriteria: undefined,
  notes: undefined,
});

const buildTaskId = () => `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function renderChips<TValue extends string>({
  label,
  options,
  selected,
  onSelect,
  accessibilityPrefix,
}: {
  label: string;
  options: Array<Option<TValue>>;
  selected: TValue;
  onSelect: (value: TValue) => void;
  accessibilityPrefix: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.segmentedRow}>
        {options.map((option) => {
          const isActive = selected === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityLabel={`${accessibilityPrefix} ${option.label}`}
              style={[styles.chip, isActive ? styles.chipActive : null]}
              onPress={() => onSelect(option.value)}
            >
              <Text style={[styles.chipText, isActive ? styles.chipTextActive : null]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function PendingTasksSection() {
  const { control } = useFormContext<HandoverFormValues>();
  const { fields, append, remove } = useFieldArray<HandoverFormValues, 'pendingTasks'>({
    control,
    name: 'pendingTasks',
  });
  const [draft, setDraft] = useState<PendingTask>(createTaskDraft);
  const [draftError, setDraftError] = useState<string | null>(null);
  const requiresEscalationCriteria =
    draft.category === 'escalation' && (draft.escalationCriteria?.trim().length ?? 0) === 0;
  const canAddTask = useMemo(
    () => draft.title.trim().length > 0 && !requiresEscalationCriteria,
    [draft.title, requiresEscalationCriteria],
  );

  const updateDraft = (updater: (current: PendingTask) => PendingTask) => {
    setDraftError(null);
    setDraft(updater);
  };

  const handleAddTask = () => {
    if (!canAddTask) return;
    const nextTask = {
      ...draft,
      id: buildTaskId(),
      title: draft.title.trim(),
      owner: draft.owner?.trim() || undefined,
      escalationCriteria: draft.escalationCriteria?.trim() || undefined,
      notes: draft.notes?.trim() || undefined,
      dueBy: draft.dueBy?.trim() || undefined,
    };
    const parsedTask = zPendingTask.safeParse(nextTask);
    if (!parsedTask.success) {
      setDraftError(parsedTask.error.issues[0]?.message ?? 'No se pudo añadir el pendiente.');
      return;
    }
    append(parsedTask.data);
    setDraft(createTaskDraft());
    setDraftError(null);
  };

  return (
    <View style={{ gap: 20 }}>
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Pendientes críticos y reevaluaciones</Text>

        {renderChips({
          label: 'Tipo',
          options: CATEGORY_OPTIONS,
          selected: draft.category,
          onSelect: (value) => updateDraft((current) => ({ ...current, category: value })),
          accessibilityPrefix: 'Tipo pendiente',
        })}

        {renderChips({
          label: 'Prioridad',
          options: PRIORITY_OPTIONS,
          selected: draft.priority,
          onSelect: (value) => updateDraft((current) => ({ ...current, priority: value })),
          accessibilityPrefix: 'Prioridad pendiente',
        })}

        {renderChips({
          label: 'Estado',
          options: STATUS_OPTIONS,
          selected: draft.status,
          onSelect: (value) => updateDraft((current) => ({ ...current, status: value })),
          accessibilityPrefix: 'Estado pendiente',
        })}

        <View style={styles.field}>
          <Text style={styles.label}>Detalle</Text>
          <TextInput
            accessibilityLabel="Detalle de pendiente"
            style={styles.input}
            placeholder="Ej: reevaluar SatO2 en 30 min"
            value={draft.title}
            onChangeText={(text) => updateDraft((current) => ({ ...current, title: text }))}
          />
        </View>

        <View style={styles.row}>
          <View style={[styles.field, styles.flex]}>
            <Text style={styles.label}>Hora objetivo</Text>
            <TextInput
              accessibilityLabel="Hora objetivo del pendiente"
              style={styles.input}
              placeholder="2026-03-19T10:30:00Z"
              value={draft.dueBy ?? ''}
              onChangeText={(text) => updateDraft((current) => ({ ...current, dueBy: text }))}
            />
          </View>
          <View style={styles.spacer} />
          <View style={[styles.field, styles.flex]}>
            <Text style={styles.label}>Responsable</Text>
            <TextInput
              accessibilityLabel="Responsable del pendiente"
              style={styles.input}
              placeholder="Enfermera entrante / médico guardia"
              value={draft.owner ?? ''}
              onChangeText={(text) => updateDraft((current) => ({ ...current, owner: text }))}
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Criterio de aviso o escalado</Text>
          <TextInput
            accessibilityLabel="Criterio de escalado del pendiente"
            style={styles.input}
            placeholder="Ej: avisar si SatO2 < 92% o dolor no controlado"
            value={draft.escalationCriteria ?? ''}
            onChangeText={(text) => updateDraft((current) => ({ ...current, escalationCriteria: text }))}
          />
          {requiresEscalationCriteria ? (
            <Text style={styles.errorText}>
              Define el criterio de escalado antes de añadir un pendiente de tipo Escalado.
            </Text>
          ) : null}
          {!requiresEscalationCriteria && draftError ? (
            <Text style={styles.errorText}>{draftError}</Text>
          ) : null}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Notas</Text>
          <TextInput
            accessibilityLabel="Notas del pendiente"
            style={[styles.input, styles.textArea]}
            multiline
            placeholder="Contexto breve para el equipo entrante"
            value={draft.notes ?? ''}
            onChangeText={(text) => updateDraft((current) => ({ ...current, notes: text }))}
          />
        </View>

        <Pressable
          accessibilityLabel="Añadir pendiente"
          accessibilityState={{ disabled: !canAddTask }}
          style={[styles.addButton, !canAddTask ? styles.addButtonDisabled : null]}
          onPress={handleAddTask}
        >
          <Text style={styles.addButtonText}>Añadir pendiente</Text>
        </Pressable>

        {fields.length > 0 ? (
          <View style={styles.list}>
            {fields.map((field, index) => (
              <View key={field.id} style={styles.listItem}>
                <View style={styles.listHeader}>
                  <Text style={styles.listTitle}>{field.title}</Text>
                  <Pressable
                    accessibilityLabel={`Eliminar pendiente ${field.title}`}
                    onPress={() => remove(index)}
                  >
                    <Text style={styles.deleteButtonText}>Eliminar</Text>
                  </Pressable>
                </View>
                <View style={styles.badgeRow}>
                  <Text style={styles.badge}>{CATEGORY_OPTIONS.find((option) => option.value === field.category)?.label ?? field.category}</Text>
                  <Text style={styles.badge}>{PRIORITY_OPTIONS.find((option) => option.value === field.priority)?.label ?? field.priority}</Text>
                  <Text style={styles.badge}>{STATUS_OPTIONS.find((option) => option.value === field.status)?.label ?? field.status}</Text>
                </View>
                {field.dueBy ? <Text style={styles.metaText}>Hora objetivo: {field.dueBy}</Text> : null}
                {field.owner ? <Text style={styles.metaText}>Responsable: {field.owner}</Text> : null}
                {field.escalationCriteria ? (
                  <Text style={styles.metaText}>Escalado: {field.escalationCriteria}</Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default PendingTasksSection;

const styles = StyleSheet.create({
  card: {
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    backgroundColor: '#fff',
  },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12 },
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
  errorText: { color: '#B91C1C', marginTop: 6 },
  textArea: { minHeight: 72, textAlignVertical: 'top' },
  segmentedRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
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
  list: { gap: 10, marginTop: 12 },
  listItem: {
    borderColor: '#E5E7EB',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#fff',
  },
  listHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  listTitle: { flex: 1, fontWeight: '700' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  badge: {
    backgroundColor: '#EEF2FF',
    color: '#312E81',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    fontSize: 12,
    fontWeight: '700',
  },
  metaText: { marginTop: 6, color: '#4B5563' },
  deleteButtonText: { color: '#DC2626', fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  flex: { flex: 1 },
  spacer: { width: 12 },
});
