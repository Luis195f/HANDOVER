import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import {
  getDemoActorIdentity,
  type DemoExceptionHandoverPatient,
} from '@/src/demo/fixtures';
import {
  buildExceptionSbar,
  createExceptionReviewEvent,
  formatExceptionDateTime,
  groupExceptionHandoverPatients,
  type ExceptionReviewEvent,
} from '@/src/lib/exception-handover';

type Colors = {
  background: string;
  border: string;
  danger: string;
  info: string;
  muted: string;
  primary: string;
  success: string;
  surface: string;
  text: string;
  warning: string;
};

type BriefDraft = Pick<
  DemoExceptionHandoverPatient,
  'change' | 'currentRisk' | 'nextAction' | 'owner'
> & {
  contingency: string;
};

type Props = {
  patients: readonly DemoExceptionHandoverPatient[];
  sessionUserId?: string;
  colors: Colors;
  onOpenFullHandover: (patientId: string) => void;
  now?: () => string;
};

function makeBriefDraft(patient: DemoExceptionHandoverPatient): BriefDraft {
  return {
    change: patient.change,
    currentRisk: patient.currentRisk,
    nextAction: patient.nextAction,
    owner: patient.owner,
    contingency: `Si ${patient.contingency.trigger}, ${patient.contingency.response}.`,
  };
}

export function UnitExceptionHandover({
  patients,
  sessionUserId,
  colors,
  onOpenFullHandover,
  now = () => new Date().toISOString(),
}: Props) {
  const groups = useMemo(() => groupExceptionHandoverPatients(patients), [patients]);
  const actor = sessionUserId ? getDemoActorIdentity(sessionUserId) : null;
  const [expandedUnchanged, setExpandedUnchanged] = useState(false);
  const [activePatientId, setActivePatientId] = useState<string | null>(null);
  const [briefDrafts, setBriefDrafts] = useState<Record<string, BriefDraft>>({});
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean[]>>({});
  const [events, setEvents] = useState<ExceptionReviewEvent[]>([]);
  const [interactionCounts, setInteractionCounts] = useState<Record<string, number>>({});

  const activePatient = patients.find((patient) => patient.patientId === activePatientId) ?? null;
  const activeDraft = activePatient ? briefDrafts[activePatient.patientId] ?? makeBriefDraft(activePatient) : null;
  const activeCheckItems = activePatient ? checkedItems[activePatient.patientId] ?? [] : [];
  const outgoingTransfer = events.find((event) => event.kind === 'outgoing_transfer');
  const incomingAttestation = events.find((event) => event.kind === 'incoming_attestation');
  const collectiveReview = events.find((event) => event.kind === 'unchanged_group_review');

  const incrementInteractions = (key: string) => {
    setInteractionCounts((current) => ({ ...current, [key]: (current[key] ?? 0) + 1 }));
  };

  const appendEvent = (kind: ExceptionReviewEvent['kind'], patientId?: string) => {
    if (!actor) return;
    setEvents((current) => [
      ...current,
      createExceptionReviewEvent(kind, actor, now(), patientId),
    ]);
  };

  const openPatient = (patient: DemoExceptionHandoverPatient) => {
    setActivePatientId(patient.patientId);
    setBriefDrafts((current) =>
      current[patient.patientId]
        ? current
        : { ...current, [patient.patientId]: makeBriefDraft(patient) },
    );
    incrementInteractions(patient.patientId);
  };

  const updateActiveDraft = (field: keyof BriefDraft, value: string) => {
    if (!activePatient || !activeDraft) return;
    setBriefDrafts((current) => ({
      ...current,
      [activePatient.patientId]: { ...activeDraft, [field]: value },
    }));
  };

  const recordBriefReview = () => {
    if (!activePatient) return;
    appendEvent('brief_review', activePatient.patientId);
    incrementInteractions(activePatient.patientId);
  };

  const toggleCriticalItem = (index: number) => {
    if (!activePatient) return;
    const next = [...activeCheckItems];
    next[index] = !next[index];
    setCheckedItems((current) => ({ ...current, [activePatient.patientId]: next }));
    incrementInteractions(activePatient.patientId);
  };

  const recordCheckBack = (needsClarification: boolean) => {
    if (!activePatient || actor?.kind !== 'incoming') return;
    appendEvent(needsClarification ? 'critical_clarification' : 'critical_check_back', activePatient.patientId);
    incrementInteractions(activePatient.patientId);
  };

  const renderProvenance = (patient: DemoExceptionHandoverPatient) => {
    const patientEvents = events.filter((event) => event.patientId === patient.patientId);
    return (
      <View style={styles.provenanceBlock} testID={`exception-provenance-${patient.patientId}`}>
        <Text style={[styles.provenanceText, { color: colors.muted }]}>Importado del contexto clínico sintético · {formatExceptionDateTime(patient.lastSummaryAt)}</Text>
        {patientEvents.map((event) => (
          <Text key={`${event.kind}-${event.recordedAt}`} testID={`exception-event-${event.kind}-${patient.patientId}`} style={[styles.provenanceText, { color: colors.muted }]}>
            {event.kind === 'critical_check_back'
              ? 'Check-back de profesional entrante'
              : event.kind === 'critical_clarification'
                ? 'Check-back: necesita aclaración'
                : 'Registrado durante el relevo'}{' '}
            · {event.actorName} · {formatExceptionDateTime(event.recordedAt)}
          </Text>
        ))}
      </View>
    );
  };

  const renderPatientCard = (patient: DemoExceptionHandoverPatient) => {
    const isCritical = patient.status === 'critical';
    const buttonLabel = isCritical ? 'Relevo prioritario' : patient.status === 'changed' ? 'Relevo breve' : 'Ver detalles';
    return (
      <View
        key={patient.patientId}
        style={[styles.patientCard, { backgroundColor: colors.background, borderColor: colors.border }]}
        testID={`exception-patient-${patient.patientId}`}
      >
        <View style={styles.patientHeader}>
          <View style={styles.flex}>
            <Text style={[styles.patientName, { color: colors.text }]}>{patient.name}</Text>
            <Text style={[styles.patientMeta, { color: colors.muted }]}>Cama {patient.bedLabel}</Text>
          </View>
          {patient.status !== 'unchanged' ? (
            <Text style={[styles.statusPill, { color: isCritical ? colors.danger : colors.warning }]}>
              {isCritical ? 'Inestable · Prioridad alta' : 'Con novedades'}
            </Text>
          ) : null}
        </View>
        {patient.status === 'unchanged' ? (
          <>
            <Text style={[styles.cardLine, { color: colors.text }]}>Sin novedades registradas para este relevo</Text>
            <Text style={[styles.cardMeta, { color: colors.muted }]}>{patient.lastSummarySource} · {formatExceptionDateTime(patient.lastSummaryAt)}</Text>
          </>
        ) : (
          <>
            <Text style={[styles.cardLine, { color: colors.text }]}>{patient.change}</Text>
            {isCritical ? <Text style={[styles.cardLine, { color: colors.danger }]}>{patient.currentRisk}</Text> : null}
            <Text style={[styles.cardMeta, { color: colors.muted }]}>{patient.nextAction}</Text>
            <Text style={[styles.cardMeta, { color: colors.muted }]}>Responsable: {patient.owner} · {formatExceptionDateTime(patient.dueAt)}</Text>
          </>
        )}
        <Pressable
          accessibilityRole="button"
          onPress={() => openPatient(patient)}
          style={[styles.secondaryButton, { borderColor: isCritical ? colors.danger : colors.info }]}
          testID={`open-exception-${patient.patientId}`}
        >
          <Text style={[styles.secondaryButtonText, { color: isCritical ? colors.danger : colors.info }]}>{buttonLabel}</Text>
        </Pressable>
      </View>
    );
  };

  const renderActivePatient = () => {
    if (!activePatient || !activeDraft) return null;
    const sbar = buildExceptionSbar(activePatient);
    const reviewEvent = events.find(
      (event) => event.patientId === activePatient.patientId && event.kind === 'brief_review',
    );
    const checkBackEvent = events.find(
      (event) =>
        event.patientId === activePatient.patientId &&
        (event.kind === 'critical_check_back' || event.kind === 'critical_clarification'),
    );

    return (
      <View style={[styles.detailPanel, { borderColor: colors.primary, backgroundColor: colors.background }]} testID={`exception-detail-${activePatient.patientId}`}>
        <View style={styles.detailHeader}>
          <View style={styles.flex}>
            <Text style={[styles.detailTitle, { color: colors.text }]}>{activePatient.status === 'critical' ? 'Relevo prioritario' : activePatient.status === 'changed' ? 'Relevo breve' : 'Detalle del resumen'}</Text>
            <Text style={[styles.patientMeta, { color: colors.muted }]}>{activePatient.name} · Cama {activePatient.bedLabel}</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => setActivePatientId(null)}>
            <Text style={{ color: colors.info }}>Cerrar</Text>
          </Pressable>
        </View>

        {activePatient.status === 'critical' ? (
          <View style={[styles.sbarCard, { backgroundColor: colors.surface }]} testID={`exception-sbar-${activePatient.patientId}`}>
            <Text style={[styles.sectionLabel, { color: colors.text }]}>SBAR automático local</Text>
            <Text style={[styles.cardLine, { color: colors.text }]}>S · Situación: {sbar.situation}</Text>
            <Text style={[styles.cardLine, { color: colors.text }]}>B · Antecedentes: {sbar.background}</Text>
            <Text style={[styles.cardLine, { color: colors.text }]}>A · Valoración: {sbar.assessment}</Text>
            <Text style={[styles.cardLine, { color: colors.text }]}>R · Recomendación: {sbar.recommendation}</Text>
            <Text style={[styles.provenanceText, { color: colors.muted }]}>Resumen determinista local; no ha sido generado por IA y no constituye validación clínica.</Text>
          </View>
        ) : null}

        {activePatient.status !== 'unchanged' ? (
          <>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>Qué cambió</Text>
            <TextInput style={[styles.input, { borderColor: colors.border, color: colors.text }]} multiline value={activeDraft.change} onChangeText={(value) => updateActiveDraft('change', value)} />
            <Text style={[styles.fieldLabel, { color: colors.text }]}>Situación o riesgo actual</Text>
            <TextInput style={[styles.input, { borderColor: colors.border, color: colors.text }]} multiline value={activeDraft.currentRisk} onChangeText={(value) => updateActiveDraft('currentRisk', value)} />
            <Text style={[styles.fieldLabel, { color: colors.text }]}>Acción pendiente</Text>
            <TextInput style={[styles.input, { borderColor: colors.border, color: colors.text }]} multiline value={activeDraft.nextAction} onChangeText={(value) => updateActiveDraft('nextAction', value)} />
            <Text style={[styles.fieldLabel, { color: colors.text }]}>Responsable</Text>
            <TextInput style={[styles.input, { borderColor: colors.border, color: colors.text }]} value={activeDraft.owner} onChangeText={(value) => updateActiveDraft('owner', value)} />
            <Text style={[styles.fieldLabel, { color: colors.text }]}>Momento objetivo</Text>
            <Text style={[styles.readOnlyValue, { color: colors.text }]}>{formatExceptionDateTime(activePatient.dueAt)}</Text>
            <Text style={[styles.fieldLabel, { color: colors.text }]}>Contingencia</Text>
            <TextInput style={[styles.input, { borderColor: colors.border, color: colors.text }]} multiline value={activeDraft.contingency} onChangeText={(value) => updateActiveDraft('contingency', value)} />
          </>
        ) : null}

        {activePatient.status === 'changed' ? (
          <Pressable accessibilityRole="button" onPress={recordBriefReview} style={[styles.primaryButton, { backgroundColor: colors.primary }]} testID={`accept-brief-${activePatient.patientId}`}>
            <Text style={styles.primaryButtonText}>{reviewEvent ? 'Relevo breve revisado' : 'Aceptar relevo breve'}</Text>
          </Pressable>
        ) : null}

        {activePatient.status === 'critical' ? (
          <View style={[styles.checkBackCard, { borderColor: colors.warning }]}>
            <Text style={[styles.sectionLabel, { color: colors.text }]}>Check-back de comunicación cerrada</Text>
            <Text style={[styles.cardMeta, { color: colors.muted }]}>La profesional entrante confirma un máximo de tres puntos críticos. Es un comportamiento de demo, separado de la firma.</Text>
            {activePatient.criticalItems.slice(0, 3).map((item, index) => (
              <View key={item} style={styles.checkRow}>
                <Switch accessibilityLabel={item} value={activeCheckItems[index] === true} onValueChange={() => toggleCriticalItem(index)} />
                <Text style={[styles.checkLabel, { color: colors.text }]}>{item}</Text>
              </View>
            ))}
            <View style={styles.actionRow}>
              <Pressable
                accessibilityRole="button"
                disabled={actor?.kind !== 'incoming' || activePatient.criticalItems.some((_, index) => activeCheckItems[index] !== true)}
                onPress={() => recordCheckBack(false)}
                style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: actor?.kind === 'incoming' ? 1 : 0.5 }]}
                testID={`confirm-checkback-${activePatient.patientId}`}
              >
                <Text style={styles.primaryButtonText}>{checkBackEvent?.kind === 'critical_check_back' ? 'Check-back registrado' : 'Confirmar puntos críticos'}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={actor?.kind !== 'incoming'} onPress={() => recordCheckBack(true)} style={[styles.secondaryButton, { borderColor: colors.warning }]}>
                <Text style={[styles.secondaryButtonText, { color: colors.warning }]}>Necesita aclaración</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {renderProvenance(activePatient)}
        <Text testID={`quick-interactions-${activePatient.patientId}`} style={[styles.interactionText, { color: colors.muted }]}>Interacciones relevantes de esta ruta: {interactionCounts[activePatient.patientId] ?? 0}</Text>
        <Pressable accessibilityRole="button" onPress={() => onOpenFullHandover(activePatient.patientId)} style={[styles.fullDetailButton, { borderColor: colors.border }]}>
          <Text style={[styles.secondaryButtonText, { color: colors.text }]}>Ver detalle completo</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={[styles.board, { borderColor: colors.border, backgroundColor: colors.surface }]} testID="unit-exception-handover">
      <Text style={[styles.eyebrow, { color: colors.info }]}>DEMO SINTÉTICA · RELEVO POR EXCEPCIONES</Text>
      <Text style={[styles.title, { color: colors.text }]}>{patients[0]?.unitName ?? 'Unidad sintética de salud mental'}</Text>
      <Text style={[styles.subtitle, { color: colors.muted }]}>40 pacientes clasificados únicamente por un atributo sintético explícito. La ausencia de evolución no genera una clasificación.</Text>
      <View style={styles.countRow}>
        <Text style={[styles.countCritical, { color: colors.danger }]}>{groups.critical.length} prioridad alta</Text>
        <Text style={[styles.countChanged, { color: colors.warning }]}>{groups.changed.length} con novedades</Text>
        <Text style={[styles.countUnchanged, { color: colors.success }]}>{groups.unchanged.length} sin novedades</Text>
      </View>

      {renderActivePatient()}

      <Text style={[styles.groupTitle, { color: colors.danger }]}>A. PRIORIDAD ALTA · {groups.critical.length}</Text>
      {groups.critical.map(renderPatientCard)}

      <Text style={[styles.groupTitle, { color: colors.warning }]}>B. CON NOVEDADES · {groups.changed.length}</Text>
      {groups.changed.map(renderPatientCard)}

      <View style={[styles.unchangedHeader, { borderColor: colors.success }]}>
        <Text style={[styles.groupTitle, { color: colors.success }]}>C. SIN NOVEDADES · {groups.unchanged.length}</Text>
        <Text style={[styles.cardMeta, { color: colors.muted }]}>Revisión colectiva del resumen, no validación individual de valores clínicos ni transferencia formal de responsabilidad.</Text>
        <View style={styles.actionRow}>
          <Pressable accessibilityRole="button" onPress={() => { setExpandedUnchanged((value) => !value); incrementInteractions('unchanged-group'); }} style={[styles.secondaryButton, { borderColor: colors.success }]} testID="expand-unchanged-list">
            <Text style={[styles.secondaryButtonText, { color: colors.success }]}>{expandedUnchanged ? 'Contraer lista' : `Expandir lista de ${groups.unchanged.length}`}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => { appendEvent('unchanged_group_review'); incrementInteractions('unchanged-group'); }} style={[styles.primaryButton, { backgroundColor: colors.success }]} testID="confirm-unchanged-review">
            <Text style={styles.primaryButtonText}>Confirmar revisión de {groups.unchanged.length} pacientes sin novedades</Text>
          </Pressable>
        </View>
        <Text testID="unchanged-interaction-count" style={[styles.interactionText, { color: colors.muted }]}>Interacciones relevantes: {interactionCounts['unchanged-group'] ?? 0} · No sustituye la transferencia formal.</Text>
        {collectiveReview ? (
          <Text testID="unchanged-review-event" style={[styles.provenanceText, { color: colors.muted }]}>Revisión colectiva registrada · {collectiveReview.actorName} · {formatExceptionDateTime(collectiveReview.recordedAt)}</Text>
        ) : null}
      </View>
      {expandedUnchanged ? groups.unchanged.map(renderPatientCard) : null}

      <View style={[styles.transferCard, { borderColor: colors.primary }]} testID="exception-transfer">
        <Text style={[styles.sectionLabel, { color: colors.text }]}>Transferencia y atestación de responsabilidad</Text>
        <Text style={[styles.cardMeta, { color: colors.muted }]}>La revisión colectiva y el check-back son eventos separados de estas atestaciones.</Text>
        <View style={styles.actionRow}>
          <Pressable accessibilityRole="button" disabled={actor?.kind !== 'outgoing'} onPress={() => appendEvent('outgoing_transfer')} style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: actor?.kind === 'outgoing' ? 1 : 0.5 }]}>
            <Text style={styles.primaryButtonText}>Confirmar transferencia saliente</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={actor?.kind !== 'incoming' || !outgoingTransfer} onPress={() => appendEvent('incoming_attestation')} style={[styles.secondaryButton, { borderColor: colors.primary }]}>
            <Text style={[styles.secondaryButtonText, { color: colors.primary }]}>Atestar recepción entrante</Text>
          </Pressable>
        </View>
        {outgoingTransfer ? <Text testID="outgoing-transfer-event" style={[styles.provenanceText, { color: colors.muted }]}>Confirmado por profesional saliente · {outgoingTransfer.actorName} · {formatExceptionDateTime(outgoingTransfer.recordedAt)}</Text> : null}
        {incomingAttestation ? <Text testID="incoming-attestation-event" style={[styles.provenanceText, { color: colors.muted }]}>Atestado por profesional entrante · {incomingAttestation.actorName} · {formatExceptionDateTime(incomingAttestation.recordedAt)}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  board: { borderRadius: 18, borderWidth: 1, gap: 12, marginTop: 16, padding: 16 },
  cardLine: { fontSize: 14, lineHeight: 20, marginTop: 5 },
  cardMeta: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  checkBackCard: { borderRadius: 12, borderWidth: 1, marginTop: 12, padding: 12 },
  checkLabel: { flex: 1, fontSize: 13, lineHeight: 18 },
  checkRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 8 },
  countChanged: { fontSize: 13, fontWeight: '700' },
  countCritical: { fontSize: 13, fontWeight: '700' },
  countRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  countUnchanged: { fontSize: 13, fontWeight: '700' },
  detailHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 10 },
  detailPanel: { borderRadius: 16, borderWidth: 2, marginVertical: 6, padding: 14 },
  detailTitle: { fontSize: 18, fontWeight: '800' },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  fieldLabel: { fontSize: 12, fontWeight: '700', marginTop: 10 },
  flex: { flex: 1 },
  fullDetailButton: { alignItems: 'center', borderRadius: 10, borderWidth: 1, marginTop: 10, padding: 10 },
  groupTitle: { fontSize: 14, fontWeight: '900', letterSpacing: 0.5, marginTop: 8 },
  input: { borderRadius: 9, borderWidth: 1, fontSize: 13, lineHeight: 18, marginTop: 4, minHeight: 40, padding: 9 },
  interactionText: { fontSize: 11, marginTop: 8 },
  patientCard: { borderRadius: 12, borderWidth: 1, padding: 12 },
  patientHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 8 },
  patientMeta: { fontSize: 12, marginTop: 2 },
  patientName: { fontSize: 15, fontWeight: '800' },
  primaryButton: { alignItems: 'center', borderRadius: 10, justifyContent: 'center', minHeight: 40, paddingHorizontal: 12, paddingVertical: 9 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800', textAlign: 'center' },
  provenanceBlock: { gap: 3, marginTop: 10 },
  provenanceText: { fontSize: 11, lineHeight: 16 },
  readOnlyValue: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  sbarCard: { borderRadius: 12, marginTop: 12, padding: 12 },
  secondaryButton: { alignItems: 'center', borderRadius: 10, borderWidth: 1, justifyContent: 'center', marginTop: 9, minHeight: 38, paddingHorizontal: 12, paddingVertical: 8 },
  secondaryButtonText: { fontSize: 12, fontWeight: '800', textAlign: 'center' },
  sectionLabel: { fontSize: 14, fontWeight: '800' },
  statusPill: { fontSize: 11, fontWeight: '900', textAlign: 'right' },
  subtitle: { fontSize: 13, lineHeight: 19 },
  title: { fontSize: 22, fontWeight: '900' },
  transferCard: { borderRadius: 14, borderWidth: 1, marginTop: 12, padding: 14 },
  unchangedHeader: { borderRadius: 14, borderWidth: 1, padding: 12 },
});
