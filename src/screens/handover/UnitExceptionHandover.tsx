import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import {
  getDemoActorIdentity,
  type DemoExceptionHandoverPatient,
} from '@/src/demo/fixtures';
import {
  appendUniqueExceptionEvent,
  appendUniqueOverride,
  assessHandoffClosure,
  buildExceptionSbarForClassification,
  calculateCheckBackMetrics,
  calculateRMetrics,
  classifyExceptionHandoverUnit,
  COLLECTIVE_REVIEW_RESPONSIBILITY_COPY,
  createExceptionReviewEvent,
  createHandoffOverride,
  DEGRADED_HANDOFF_RESPONSIBILITY_COPY,
  formatExceptionDateTime,
  getPatientTransferStatus,
  groupExceptionHandoverPatients,
  isInteractionBudgetExceeded,
  validateDegradedUnitTransfer,
  type ClinicalSource,
  type ExceptionReviewEvent,
  type HandoffClassification,
  type HandoffLane,
  type UnitDataHealth,
  type UnitIntegrationState,
} from '@/src/lib/exception-handover';
import {
  createEmptyExceptionHandoverState,
  createExceptionHandoverStorage,
  mergeExceptionHandoverState,
  type ExceptionHandoverSessionState,
  type ExceptionHandoverStorage,
  type PersistedBriefDraft,
} from '@/src/lib/exception-handover-storage';

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

type Props = {
  patients: readonly DemoExceptionHandoverPatient[];
  sessionUserId?: string;
  colors: Colors;
  onOpenFullHandover: (patientId: string) => void;
  now?: () => string;
  shiftId?: string;
  integrationState?: UnitIntegrationState;
  storage?: ExceptionHandoverStorage | null;
};

const SOURCE_LABELS: Readonly<Record<ClinicalSource, string>> = {
  'direct-assessment': 'Valoración directa',
  'observation-record': 'Registro de observación',
  'medication-administration': 'Administración de medicación',
  'care-plan': 'Plan vigente',
  'incident-log': 'Incidencias y retornos',
};

function makeBriefDraft(patient: DemoExceptionHandoverPatient): PersistedBriefDraft {
  return {
    change: patient.change,
    currentRisk: patient.currentRisk,
    nextAction: patient.nextAction,
    owner: patient.owner,
    contingency: `Si ${patient.contingency.trigger}, ${patient.contingency.response}.`,
  };
}

function splitManualLines(value: string): string[] {
  return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
}

function formatMinutes(value: number): string {
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}

export function UnitExceptionHandover({
  patients,
  sessionUserId,
  colors,
  onOpenFullHandover,
  now = () => new Date().toISOString(),
  shiftId = patients[0]?.shiftId ?? 'demo-2026-08-27-morning',
  integrationState = { availability: 'available' },
  storage,
}: Props) {
  const [classifiedAt] = useState(() => now());
  const [storageInstance] = useState<ExceptionHandoverStorage | null>(() =>
    storage === null ? null : (storage ?? createExceptionHandoverStorage()));
  const [sessionState, setSessionState] = useState<ExceptionHandoverSessionState>(() =>
    createEmptyExceptionHandoverState(shiftId));
  const [hydrated, setHydrated] = useState(storageInstance === null);
  const [expandedUnchanged, setExpandedUnchanged] = useState(false);
  const [activePatientId, setActivePatientId] = useState<string | null>(null);
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean[]>>({});
  const [overrideReasons, setOverrideReasons] = useState<Record<string, string>>({});
  const [manualPriorities, setManualPriorities] = useState('');
  const [manualChanges, setManualChanges] = useState('');
  const [manualPendings, setManualPendings] = useState('');
  const [manualReceiver, setManualReceiver] = useState('');
  const [lastKnownClassifications, setLastKnownClassifications] = useState<HandoffClassification[]>([]);
  const [previousUnitDataHealth, setPreviousUnitDataHealth] = useState<UnitDataHealth>();

  const actor = sessionUserId ? getDemoActorIdentity(sessionUserId) : null;
  const patientsWithOverrides = useMemo(() => patients.map((patient) => ({
    ...patient,
    previousOverrides: [
      ...(patient.previousOverrides ?? []),
      ...sessionState.overrides.filter((override) => override.patientId === patient.patientId),
    ],
  })), [patients, sessionState.overrides]);
  const unitResult = useMemo(() => classifyExceptionHandoverUnit(patientsWithOverrides, {
    now: classifiedAt,
    shiftId,
    integration: integrationState,
    previousStatus: previousUnitDataHealth,
    lastKnownClassifications,
  }), [classifiedAt, integrationState, lastKnownClassifications, patientsWithOverrides, previousUnitDataHealth, shiftId]);
  const classifications = unitResult.classifications;
  const classificationByPatientId = useMemo(
    () => new Map(classifications.map((classification) => [classification.patientId, classification])),
    [classifications],
  );
  const groups = useMemo(
    () => groupExceptionHandoverPatients(patientsWithOverrides, classifications),
    [classifications, patientsWithOverrides],
  );
  const activePatient = patients.find((patient) => patient.patientId === activePatientId) ?? null;
  const activeClassification = activePatient
    ? classificationByPatientId.get(activePatient.patientId) ?? null
    : null;
  const activeDraft = activePatient
    ? sessionState.briefDrafts[activePatient.patientId] ?? makeBriefDraft(activePatient)
    : null;
  const activeCheckItems = activePatient ? checkedItems[activePatient.patientId] ?? [] : [];
  const events = sessionState.events;
  const outgoingTransfer = events.find((event) => event.kind === 'outgoing_transfer');
  const incomingAttestation = events.find((event) => event.kind === 'incoming_attestation');
  const collectiveReview = events.find((event) => event.kind === 'unchanged_group_review');
  const rMetrics = calculateRMetrics(classifications, events, classifiedAt);
  const checkBackMetrics = calculateCheckBackMetrics(classifications, events);
  const closure = assessHandoffClosure(classifications, events, unitResult.unitDataHealth.status);

  useEffect(() => {
    if (!storageInstance) return;
    let active = true;
    void storageInstance.load(shiftId).then((loaded) => {
      if (!active) return;
      setSessionState((current) => mergeExceptionHandoverState(current, loaded));
      setHydrated(true);
    });
    return () => { active = false; };
  }, [shiftId, storageInstance]);

  useEffect(() => {
    if (!hydrated || !storageInstance) return;
    void storageInstance.save(sessionState);
  }, [hydrated, sessionState, storageInstance]);

  useEffect(() => {
    if (unitResult.automaticClassificationSuspended || unitResult.classifications.length === 0) return;
    setLastKnownClassifications((current) => {
      const next = unitResult.classifications;
      const unchanged = current.length === next.length && current.every((classification, index) =>
        classification.patientId === next[index]?.patientId &&
        classification.handoffLane === next[index]?.handoffLane &&
        classification.classifiedAt === next[index]?.classifiedAt);
      if (unchanged) return current;
      return next;
    });
  }, [unitResult.automaticClassificationSuspended, unitResult.classifications]);

  useEffect(() => {
    setPreviousUnitDataHealth((current) =>
      current === unitResult.unitDataHealth.status ? current : unitResult.unitDataHealth.status);
  }, [unitResult.unitDataHealth.status]);

  useEffect(() => {
    const transfer = sessionState.degradedTransfer;
    if (!transfer) return;
    setManualPriorities(transfer.priorityPatientIds.join('\n'));
    setManualChanges(transfer.changedPatientIds.join('\n'));
    setManualPendings(transfer.criticalPendings.join('\n'));
    setManualReceiver(transfer.receiverId);
  }, [sessionState.degradedTransfer]);

  const updateSessionState = (updater: (current: ExceptionHandoverSessionState) => ExceptionHandoverSessionState) => {
    setSessionState((current) => updater(current));
  };

  const incrementInteractions = (key: string) => {
    updateSessionState((current) => ({
      ...current,
      interactionCounts: {
        ...current.interactionCounts,
        [key]: (current.interactionCounts[key] ?? 0) + 1,
      },
    }));
  };

  const appendEvent = (
    kind: ExceptionReviewEvent['kind'],
    patientId?: string,
    details?: Parameters<typeof createExceptionReviewEvent>[4],
  ) => {
    if (!actor) return;
    const event = createExceptionReviewEvent(kind, actor, now(), patientId, { shiftId, ...details });
    updateSessionState((current) => ({
      ...current,
      events: appendUniqueExceptionEvent(current.events, event),
    }));
  };

  const openPatient = (patient: DemoExceptionHandoverPatient) => {
    setActivePatientId(patient.patientId);
    updateSessionState((current) => ({
      ...current,
      briefDrafts: current.briefDrafts[patient.patientId]
        ? current.briefDrafts
        : { ...current.briefDrafts, [patient.patientId]: makeBriefDraft(patient) },
    }));
    incrementInteractions(patient.patientId);
  };

  const updateActiveDraft = (field: keyof PersistedBriefDraft, value: string) => {
    if (!activePatient || !activeDraft) return;
    updateSessionState((current) => ({
      ...current,
      briefDrafts: {
        ...current.briefDrafts,
        [activePatient.patientId]: { ...activeDraft, [field]: value },
      },
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
    const criticalPoints = activePatient.criticalItems
      .slice(0, 3)
      .filter((_, index) => activeCheckItems[index] === true);
    if (!needsClarification && criticalPoints.length === 0) return;
    appendEvent(
      needsClarification ? 'critical_clarification' : 'critical_check_back',
      activePatient.patientId,
      needsClarification ? undefined : { criticalPoints },
    );
    incrementInteractions(activePatient.patientId);
  };

  const recordEscalation = () => {
    if (!activePatient || actor?.kind !== 'incoming') return;
    appendEvent('critical_escalated', activePatient.patientId);
    incrementInteractions(activePatient.patientId);
  };

  const recordOverride = () => {
    if (!activePatient || !activeClassification || !actor) return;
    const reason = overrideReasons[activePatient.patientId] ?? '';
    if (!reason.trim()) return;
    const override = createHandoffOverride({
      patientId: activePatient.patientId,
      previousLane: activeClassification.handoffLane,
      newLane: 'B',
      reason,
      professional: actor,
      shiftId,
      recordedAt: now(),
      sourceStatuses: activeClassification.sourceStatuses,
    });
    updateSessionState((current) => ({
      ...current,
      overrides: appendUniqueOverride(current.overrides, override),
      events: appendUniqueExceptionEvent(
        appendUniqueExceptionEvent(
          current.events,
          createExceptionReviewEvent('r_resolved', actor, override.recordedAt, activePatient.patientId, {
            shiftId,
            reason: override.reason,
          }),
        ),
        createExceptionReviewEvent('override_recorded', actor, override.recordedAt, activePatient.patientId, {
          shiftId,
          reason: override.reason,
        }),
      ),
    }));
    incrementInteractions(activePatient.patientId);
  };

  const transferR = () => {
    if (!activePatient || !activeClassification || actor?.kind !== 'incoming') return;
    appendEvent('r_transferred', activePatient.patientId, {
      reason: activeClassification.reasons.join('. '),
      targetAt: activePatient.dueAt,
      receiverId: actor.userId,
    });
    incrementInteractions(activePatient.patientId);
  };

  const renderProvenance = (patient: DemoExceptionHandoverPatient) => {
    const patientEvents = events.filter((event) => event.patientId === patient.patientId);
    return (
      <View style={styles.provenanceBlock} testID={`exception-provenance-${patient.patientId}`}>
        <Text style={[styles.provenanceText, { color: colors.muted }]}>Importado del contexto clínico sintético · {formatExceptionDateTime(patient.lastSummaryAt)}</Text>
        {patientEvents.map((event) => (
          <Text key={event.idempotencyKey} testID={`exception-event-${event.kind}-${patient.patientId}`} style={[styles.provenanceText, { color: colors.muted }]}>
            {event.kind === 'critical_check_back'
              ? 'Check-back de profesional entrante'
              : event.kind === 'critical_clarification'
                ? 'Check-back: necesita aclaración'
                : event.kind === 'critical_escalated'
                  ? 'Comunicación escalada'
                  : event.kind === 'r_transferred'
                    ? 'Información incompleta transferida y reconocida'
                    : event.kind === 'override_recorded'
                      ? 'Override clínico registrado'
                       : 'Registrado durante el relevo'}{' '}
            · {event.actorName} · {formatExceptionDateTime(event.recordedAt)}
            {event.criticalPoints?.length ? ` · Puntos: ${event.criticalPoints.join(' · ')}` : ''}
          </Text>
        ))}
      </View>
    );
  };

  const laneLabel = (lane: HandoffLane) => {
    if (lane === 'A') return 'Inestable · Prioridad inmediata';
    if (lane === 'B') return 'Con novedades';
    if (lane === 'R') return 'Revisión requerida';
    return 'Sin novedades confirmadas';
  };

  const renderPatientCard = (patient: DemoExceptionHandoverPatient) => {
    const classification = classificationByPatientId.get(patient.patientId);
    if (!classification) return null;
    const lane = classification.handoffLane;
    const buttonLabel = lane === 'A' ? 'Relevo prioritario' : lane === 'B' ? 'Relevo breve' : lane === 'R' ? 'Revisar información' : 'Ver detalles';
    const laneColor = lane === 'A' ? colors.danger : lane === 'B' || lane === 'R' ? colors.warning : colors.success;
    return (
      <View key={patient.patientId} style={[styles.patientCard, { backgroundColor: colors.background, borderColor: colors.border }]} testID={`exception-patient-${patient.patientId}`}>
        <View style={styles.patientHeader}>
          <View style={styles.flex}>
            <Text style={[styles.patientName, { color: colors.text }]}>{patient.name}</Text>
            <Text style={[styles.patientMeta, { color: colors.muted }]}>Cama {patient.bedLabel}</Text>
          </View>
          <Text style={[styles.statusPill, { color: laneColor }]}>{laneLabel(lane)}</Text>
        </View>
        {lane === 'C' ? (
          <>
            <Text style={[styles.cardLine, { color: colors.text }]}>{classification.reasons[0]}</Text>
            <Text style={[styles.cardMeta, { color: colors.muted }]}>{patient.lastSummarySource} · {formatExceptionDateTime(patient.lastSummaryAt)}</Text>
          </>
        ) : lane === 'R' ? (
          <>
            {classification.reviewRequirements.map((requirement) => (
              <Text key={requirement.source} style={[styles.cardLine, { color: colors.warning }]}>{requirement.reason}</Text>
            ))}
            <Text style={[styles.cardMeta, { color: colors.muted }]}>Responsable: {classification.reviewRequirements[0]?.owner}</Text>
          </>
        ) : (
          <>
            <Text style={[styles.cardLine, { color: colors.text }]}>{patient.change}</Text>
            {lane === 'A' ? <Text style={[styles.cardLine, { color: colors.danger }]}>{patient.currentRisk}</Text> : null}
            <Text style={[styles.cardMeta, { color: colors.muted }]}>{patient.nextAction}</Text>
            <Text style={[styles.cardMeta, { color: colors.muted }]}>Responsable: {patient.owner} · {formatExceptionDateTime(patient.dueAt)}</Text>
          </>
        )}
        <Pressable accessibilityRole="button" onPress={() => openPatient(patient)} style={[styles.secondaryButton, { borderColor: laneColor }]} testID={`open-exception-${patient.patientId}`}>
          <Text style={[styles.secondaryButtonText, { color: laneColor }]}>{buttonLabel}</Text>
        </Pressable>
      </View>
    );
  };

  const renderActivePatient = () => {
    if (!activePatient || !activeDraft || !activeClassification) return null;
    const lane = activeClassification.handoffLane;
    const sbar = buildExceptionSbarForClassification(activePatient, activeClassification);
    const reviewEvent = events.find((event) => event.patientId === activePatient.patientId && event.kind === 'brief_review');
    const transferStatus = getPatientTransferStatus(activePatient.patientId, events);
    const interactionCount = sessionState.interactionCounts[activePatient.patientId] ?? 0;
    const transferredR = events.some((event) => event.patientId === activePatient.patientId && event.kind === 'r_transferred');
    const checkBackPoints = activePatient.criticalItems.slice(0, 3);
    const checkBackReady = checkBackPoints.length > 0 &&
      checkBackPoints.every((_, index) => activeCheckItems[index] === true);

    return (
      <View style={[styles.detailPanel, { borderColor: colors.primary, backgroundColor: colors.background }]} testID={`exception-detail-${activePatient.patientId}`}>
        <View style={styles.detailHeader}>
          <View style={styles.flex}>
            <Text style={[styles.detailTitle, { color: colors.text }]}>{lane === 'A' ? 'Relevo prioritario' : lane === 'B' ? 'Relevo breve' : lane === 'R' ? 'Revisión de información' : 'Detalle del resumen'}</Text>
            <Text style={[styles.patientMeta, { color: colors.muted }]}>{activePatient.name} · Cama {activePatient.bedLabel}</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => setActivePatientId(null)}><Text style={{ color: colors.info }}>Cerrar</Text></Pressable>
        </View>

        {sbar ? (
          <View style={[styles.sbarCard, { backgroundColor: colors.surface }]} testID={`exception-sbar-${activePatient.patientId}`}>
            <Text style={[styles.sectionLabel, { color: colors.text }]}>Borrador determinista</Text>
            <Text style={[styles.cardLine, { color: colors.text }]}>S · Situación: {sbar.situation}</Text>
            <Text style={[styles.cardLine, { color: colors.text }]}>B · Antecedentes: {sbar.background}</Text>
            <Text style={[styles.cardLine, { color: colors.text }]}>A · Valoración: {sbar.assessment}</Text>
            <Text style={[styles.cardLine, { color: colors.text }]}>R · Recomendación: {sbar.recommendation}</Text>
            <Text style={[styles.provenanceText, { color: colors.muted }]}>Borrador local basado en datos estructurados; requiere validación humana y no se sobrescribe tras editar el relevo breve.</Text>
          </View>
        ) : null}

        {lane === 'R' ? (
          <View testID={`r-information-${activePatient.patientId}`}>
            <Text style={[styles.sectionLabel, { color: colors.warning }]}>Información esperada insuficiente</Text>
            {activeClassification.reviewRequirements.map((requirement) => (
              <View key={requirement.source} style={[styles.requirementCard, { borderColor: colors.warning }]}>
                <Text style={[styles.cardLine, { color: colors.text }]}>{requirement.reason}</Text>
                <Text style={[styles.cardMeta, { color: colors.muted }]}>Fuente: {SOURCE_LABELS[requirement.source]}</Text>
                <Text style={[styles.cardMeta, { color: colors.muted }]}>Antigüedad: {requirement.ageMinutes == null ? 'No verificable' : formatMinutes(requirement.ageMinutes)}</Text>
                <Text style={[styles.cardMeta, { color: colors.muted }]}>Responsable: {requirement.owner} · Estado: {transferredR ? 'Transferido' : 'Pendiente'}</Text>
                <Text style={[styles.cardMeta, { color: colors.muted }]}>Tiempo acumulado en R: {formatMinutes(Math.max(0, Math.floor((Date.parse(classifiedAt) - Date.parse(requirement.enteredAt)) / 60_000)))}</Text>
              </View>
            ))}
            <TextInput
              accessibilityLabel="Motivo clínico del override"
              style={[styles.input, { borderColor: colors.border, color: colors.text }]}
              placeholder="Motivo clínico para reclasificar"
              value={overrideReasons[activePatient.patientId] ?? ''}
              onChangeText={(value) => setOverrideReasons((current) => ({ ...current, [activePatient.patientId]: value }))}
              testID={`override-reason-${activePatient.patientId}`}
            />
            <View style={styles.actionRow}>
              <Pressable accessibilityRole="button" disabled={!actor || !(overrideReasons[activePatient.patientId] ?? '').trim()} onPress={recordOverride} style={[styles.primaryButton, { backgroundColor: colors.primary }]} testID={`resolve-r-${activePatient.patientId}`}>
                <Text style={styles.primaryButtonText}>Resolver y reclasificar B</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={actor?.kind !== 'incoming' || transferredR} onPress={transferR} style={[styles.secondaryButton, { borderColor: colors.warning }]} testID={`transfer-r-${activePatient.patientId}`}>
                <Text style={[styles.secondaryButtonText, { color: colors.warning }]}>Transferir información incompleta</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {lane === 'A' || lane === 'B' ? (
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

        {lane === 'B' ? (
          <Pressable accessibilityRole="button" onPress={recordBriefReview} style={[styles.primaryButton, { backgroundColor: colors.primary }]} testID={`accept-brief-${activePatient.patientId}`}>
            <Text style={styles.primaryButtonText}>{reviewEvent ? 'Relevo breve revisado' : 'Validar borrador y aceptar relevo breve'}</Text>
          </Pressable>
        ) : null}

        {lane === 'A' ? (
          <View style={[styles.checkBackCard, { borderColor: colors.warning }]}>
            <Text style={[styles.sectionLabel, { color: colors.text }]}>Check-back de comunicación cerrada</Text>
            <Text style={[styles.cardMeta, { color: colors.muted }]}>La profesional entrante confirma entre uno y tres puntos críticos; no existe finalización ordinaria sin reconocimiento.</Text>
            {checkBackPoints.map((item, index) => (
              <View key={item} style={styles.checkRow}>
                <Switch accessibilityLabel={item} value={activeCheckItems[index] === true} onValueChange={() => toggleCriticalItem(index)} />
                <Text style={[styles.checkLabel, { color: colors.text }]}>{item}</Text>
              </View>
            ))}
            <Text testID={`transfer-status-${activePatient.patientId}`} style={[styles.cardMeta, { color: colors.muted }]}>Estado de transferencia: {transferStatus}</Text>
            <View style={styles.actionRow}>
              <Pressable accessibilityRole="button" disabled={actor?.kind !== 'incoming' || !checkBackReady} onPress={() => recordCheckBack(false)} style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: actor?.kind === 'incoming' ? 1 : 0.5 }]} testID={`confirm-checkback-${activePatient.patientId}`}>
                <Text style={styles.primaryButtonText}>{transferStatus === 'completed' ? 'Check-back registrado' : 'Confirmar puntos críticos'}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={actor?.kind !== 'incoming'} onPress={() => recordCheckBack(true)} style={[styles.secondaryButton, { borderColor: colors.warning }]}><Text style={[styles.secondaryButtonText, { color: colors.warning }]}>Necesita aclaración</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={actor?.kind !== 'incoming'} onPress={recordEscalation} style={[styles.secondaryButton, { borderColor: colors.danger }]}><Text style={[styles.secondaryButtonText, { color: colors.danger }]}>Registrar escalado</Text></Pressable>
            </View>
          </View>
        ) : null}

        {renderProvenance(activePatient)}
        <Text testID={`quick-interactions-${activePatient.patientId}`} style={[styles.interactionText, { color: isInteractionBudgetExceeded(lane, interactionCount) ? colors.danger : colors.muted }]}>Interacciones relevantes de esta ruta: {interactionCount}</Text>
        <Pressable accessibilityRole="button" onPress={() => onOpenFullHandover(activePatient.patientId)} style={[styles.fullDetailButton, { borderColor: colors.border }]}><Text style={[styles.secondaryButtonText, { color: colors.text }]}>Ver detalle completo</Text></Pressable>
      </View>
    );
  };

  const renderUnavailableMode = () => {
    const incidentAcknowledged = events.some(({ kind }) => kind === 'unit_incident_acknowledgement');
    const degradedOutgoing = events.some(({ kind }) => kind === 'degraded_outgoing_transfer');
    const degradedIncoming = events.some(({ kind }) => kind === 'degraded_incoming_acknowledgement');
    const degradedInteractions = sessionState.interactionCounts.degraded ?? 0;
    const degradedTransfer = {
      priorityPatientIds: splitManualLines(manualPriorities),
      changedPatientIds: splitManualLines(manualChanges),
      criticalPendings: splitManualLines(manualPendings),
      receiverId: manualReceiver,
      recordedAt: sessionState.degradedTransfer?.recordedAt ?? classifiedAt,
    };

    return (
      <View testID="degraded-unit-handoff">
        <View style={[styles.banner, { borderColor: colors.danger }]} testID="unit-data-health-banner">
          <Text style={[styles.sectionLabel, { color: colors.danger }]}>Clasificación automática suspendida: fuente clínica no disponible</Text>
          <Text style={[styles.cardMeta, { color: colors.text }]}>Última clasificación conocida · no vigente · {unitResult.lastKnownClassifiedAt ? formatExceptionDateTime(unitResult.lastKnownClassifiedAt) : 'sin fecha verificable'}</Text>
          <Text style={[styles.cardMeta, { color: colors.muted }]}>{DEGRADED_HANDOFF_RESPONSIBILITY_COPY}</Text>
        </View>
        <Text style={[styles.sectionLabel, { color: colors.text }]}>Relevo degradado mínimo de unidad</Text>
        <TextInput accessibilityLabel="Pacientes prioritarios" style={[styles.input, { borderColor: colors.border, color: colors.text }]} multiline placeholder="Pacientes prioritarios, separados por línea" value={manualPriorities} onChangeText={setManualPriorities} />
        <TextInput accessibilityLabel="Pacientes con novedades" style={[styles.input, { borderColor: colors.border, color: colors.text }]} multiline placeholder="Pacientes con novedades, separados por línea" value={manualChanges} onChangeText={setManualChanges} />
        <TextInput accessibilityLabel="Pendientes críticos" style={[styles.input, { borderColor: colors.border, color: colors.text }]} multiline placeholder="Pendientes críticos, separados por línea" value={manualPendings} onChangeText={setManualPendings} />
        <TextInput accessibilityLabel="Responsable receptor" style={[styles.input, { borderColor: colors.border, color: colors.text }]} placeholder="Identificador del responsable receptor" value={manualReceiver} onChangeText={setManualReceiver} />
        <Text style={[styles.cardMeta, { color: colors.muted }]}>Hora del registro: {formatExceptionDateTime(degradedTransfer.recordedAt)}</Text>
        <View style={styles.actionRow}>
          <Pressable accessibilityRole="button" disabled={actor?.kind !== 'outgoing' || incidentAcknowledged} onPress={() => { appendEvent('unit_incident_acknowledgement'); incrementInteractions('degraded'); }} style={[styles.primaryButton, { backgroundColor: colors.warning }]} testID="acknowledge-unit-incident"><Text style={styles.primaryButtonText}>{incidentAcknowledged ? 'Incidencia reconocida' : 'Reconocer incidencia de unidad'}</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={actor?.kind !== 'outgoing' || !incidentAcknowledged || !validateDegradedUnitTransfer(degradedTransfer)} onPress={() => {
            updateSessionState((current) => ({
              ...current,
              degradedTransfer: { ...degradedTransfer, recordedAt: now() },
            }));
            appendEvent('degraded_outgoing_transfer');
            incrementInteractions('degraded');
          }} style={[styles.primaryButton, { backgroundColor: colors.primary }]} testID="confirm-degraded-outgoing"><Text style={styles.primaryButtonText}>{degradedOutgoing ? 'Relevo degradado registrado' : 'Confirmar relevo degradado saliente'}</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={actor?.kind !== 'incoming' || !degradedOutgoing || degradedIncoming} onPress={() => { appendEvent('degraded_incoming_acknowledgement'); incrementInteractions('degraded'); }} style={[styles.secondaryButton, { borderColor: colors.primary }]} testID="confirm-degraded-incoming"><Text style={[styles.secondaryButtonText, { color: colors.primary }]}>Reconocer recepción con información parcial</Text></Pressable>
        </View>
        <Text testID="degraded-interaction-count" style={[styles.interactionText, { color: isInteractionBudgetExceeded('degraded', degradedInteractions) ? colors.danger : colors.muted }]}>Interacciones relevantes: {degradedInteractions} / 3. La introducción manual de excepciones no se contabiliza.</Text>
        <Text testID="degraded-closure-status" style={[styles.cardMeta, { color: closure.canClose ? colors.success : colors.danger }]}>{closure.canClose ? 'Relevo degradado reconocido por el equipo receptor' : closure.blockingReasons.join('. ')}</Text>
      </View>
    );
  };

  return (
    <View style={[styles.board, { borderColor: colors.border, backgroundColor: colors.surface }]} testID="unit-exception-handover">
      <Text style={[styles.eyebrow, { color: colors.info }]}>DEMO SINTÉTICA · RELEVO POR EXCEPCIONES</Text>
      <Text style={[styles.title, { color: colors.text }]}>{patients[0]?.unitName ?? 'Unidad sintética de salud mental'}</Text>
      <Text style={[styles.subtitle, { color: colors.muted }]}>Clasificación explicable por perfil, plan, fuentes esperadas y vigencia. La indisponibilidad técnica se muestra separada del estado clínico.</Text>

      {unitResult.automaticClassificationSuspended ? renderUnavailableMode() : (
        <>
          {unitResult.unitDataHealth.status === 'degraded' ? (
            <View style={[styles.banner, { borderColor: colors.warning }]} testID="unit-data-health-banner">
              <Text style={[styles.sectionLabel, { color: colors.warning }]}>Integración clínica degradada</Text>
              <Text style={[styles.cardMeta, { color: colors.text }]}>{unitResult.unitDataHealth.reason}</Text>
              <Text style={[styles.cardMeta, { color: colors.muted }]}>Fuentes afectadas: {unitResult.unitDataHealth.affectedSources.map((source) => SOURCE_LABELS[source]).join(', ') || 'Volumen o antigüedad de revisión R'}</Text>
            </View>
          ) : null}
          <View style={styles.countRow}>
            <Text style={[styles.countCritical, { color: colors.danger }]}>{groups.critical.length} prioridad alta</Text>
            <Text style={[styles.countChanged, { color: colors.warning }]}>{groups.changed.length} con novedades</Text>
            <Text style={[styles.countUnchanged, { color: colors.success }]}>{groups.unchanged.length} sin novedades</Text>
            <Text style={[styles.countReview, { color: colors.warning }]}>{groups.review.length} revisión requerida</Text>
          </View>
          <Text testID="r-governance-metrics" style={[styles.cardMeta, { color: colors.muted }]}>R: {rMetrics.countR} · ratio {(rMetrics.ratioR * 100).toFixed(1)}% · mayor antigüedad {formatMinutes(rMetrics.oldestRAge)} · media {formatMinutes(Math.round(rMetrics.meanTimeInR))} · resueltos {rMetrics.resolvedR} · transferidos {rMetrics.transferredUnresolvedR}</Text>
          <Text testID="checkback-metrics" style={[styles.cardMeta, { color: colors.muted }]}>Check-back: requeridos {checkBackMetrics.requiredCheckBacks} · completados {checkBackMetrics.completedCheckBacks} · pendientes {checkBackMetrics.pendingCheckBacks} · bypass {checkBackMetrics.bypassCount} · aclaraciones {checkBackMetrics.clarificationCount}</Text>

          {renderActivePatient()}
          <Text style={[styles.groupTitle, { color: colors.danger }]}>A. PRIORIDAD INMEDIATA · {groups.critical.length}</Text>
          {groups.critical.map(renderPatientCard)}
          <Text style={[styles.groupTitle, { color: colors.warning }]}>B. CON NOVEDADES · {groups.changed.length}</Text>
          {groups.changed.map(renderPatientCard)}

          {groups.review.length > 0 ? (
            <View style={[styles.reviewGroup, { borderColor: colors.warning }]} testID="r-patient-group">
              <Text style={[styles.groupTitle, { color: colors.warning }]}>R. REVISIÓN REQUERIDA · {groups.review.length}</Text>
              <Text style={[styles.cardMeta, { color: colors.muted }]}>No cuenta como C y no genera un SBAR clínico aparentemente completo.</Text>
              <Pressable accessibilityRole="button" onPress={() => appendEvent('r_cause_acknowledgement', undefined, { source: rMetrics.affectedSources[0] })} style={[styles.secondaryButton, { borderColor: colors.warning }]} testID="acknowledge-r-cause"><Text style={[styles.secondaryButtonText, { color: colors.warning }]}>Reconocer causa compartida sin crear notas individuales</Text></Pressable>
              {groups.review.map(renderPatientCard)}
            </View>
          ) : null}

          <View style={[styles.unchangedHeader, { borderColor: colors.success }]}>
            <Text style={[styles.groupTitle, { color: colors.success }]}>C. SIN NOVEDADES CONFIRMADAS · {groups.unchanged.length}</Text>
            <Text style={[styles.cardMeta, { color: colors.muted }]}>{COLLECTIVE_REVIEW_RESPONSIBILITY_COPY}</Text>
            <View style={styles.actionRow}>
              <Pressable accessibilityRole="button" onPress={() => { setExpandedUnchanged((value) => !value); incrementInteractions('unchanged-group'); }} style={[styles.secondaryButton, { borderColor: colors.success }]} testID="expand-unchanged-list"><Text style={[styles.secondaryButtonText, { color: colors.success }]}>{expandedUnchanged ? 'Contraer lista' : `Expandir lista de ${groups.unchanged.length}`}</Text></Pressable>
              <Pressable accessibilityRole="button" onPress={() => { appendEvent('unchanged_group_review'); incrementInteractions('unchanged-group'); }} style={[styles.primaryButton, { backgroundColor: colors.success }]} testID="confirm-unchanged-review"><Text style={styles.primaryButtonText}>Confirmar revisión colectiva de {groups.unchanged.length} pacientes C</Text></Pressable>
            </View>
            <Text testID="unchanged-interaction-count" style={[styles.interactionText, { color: isInteractionBudgetExceeded('C', sessionState.interactionCounts['unchanged-group'] ?? 0) ? colors.danger : colors.muted }]}>Interacciones relevantes: {sessionState.interactionCounts['unchanged-group'] ?? 0} · No sustituye la validación individual.</Text>
            {collectiveReview ? <Text testID="unchanged-review-event" style={[styles.provenanceText, { color: colors.muted }]}>Revisión colectiva registrada · {collectiveReview.actorName} · {formatExceptionDateTime(collectiveReview.recordedAt)}</Text> : null}
          </View>
          {expandedUnchanged ? groups.unchanged.map(renderPatientCard) : null}

          <View style={[styles.transferCard, { borderColor: colors.primary }]} testID="exception-transfer">
            <Text style={[styles.sectionLabel, { color: colors.text }]}>Transferencia y atestación de responsabilidad</Text>
            <Text style={[styles.cardMeta, { color: colors.muted }]}>{COLLECTIVE_REVIEW_RESPONSIBILITY_COPY}</Text>
            {!closure.canClose ? <Text testID="exception-closure-blocked" style={[styles.cardMeta, { color: colors.danger }]}>{closure.blockingReasons.join('. ')}</Text> : null}
            <View style={styles.actionRow}>
              <Pressable accessibilityRole="button" disabled={actor?.kind !== 'outgoing' || !closure.canClose} onPress={() => appendEvent('outgoing_transfer')} style={[styles.primaryButton, { backgroundColor: colors.primary, opacity: actor?.kind === 'outgoing' && closure.canClose ? 1 : 0.5 }]} testID="confirm-outgoing-transfer"><Text style={styles.primaryButtonText}>Confirmar transferencia saliente</Text></Pressable>
              <Pressable accessibilityRole="button" disabled={actor?.kind !== 'incoming' || !outgoingTransfer || !closure.canClose} onPress={() => appendEvent('incoming_attestation')} style={[styles.secondaryButton, { borderColor: colors.primary }]} testID="confirm-incoming-attestation"><Text style={[styles.secondaryButtonText, { color: colors.primary }]}>Atestar recepción entrante</Text></Pressable>
            </View>
            {outgoingTransfer ? <Text testID="outgoing-transfer-event" style={[styles.provenanceText, { color: colors.muted }]}>Confirmado por profesional saliente · {outgoingTransfer.actorName} · {formatExceptionDateTime(outgoingTransfer.recordedAt)}</Text> : null}
            {incomingAttestation ? <Text testID="incoming-attestation-event" style={[styles.provenanceText, { color: colors.muted }]}>Atestado por profesional entrante · {incomingAttestation.actorName} · {formatExceptionDateTime(incomingAttestation.recordedAt)}</Text> : null}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  banner: { borderRadius: 12, borderWidth: 2, gap: 4, marginVertical: 8, padding: 12 },
  board: { borderRadius: 18, borderWidth: 1, gap: 12, marginTop: 16, padding: 16 },
  cardLine: { fontSize: 14, lineHeight: 20, marginTop: 5 },
  cardMeta: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  checkBackCard: { borderRadius: 12, borderWidth: 1, marginTop: 12, padding: 12 },
  checkLabel: { flex: 1, fontSize: 13, lineHeight: 18 },
  checkRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 8 },
  countChanged: { fontSize: 13, fontWeight: '700' },
  countCritical: { fontSize: 13, fontWeight: '700' },
  countReview: { fontSize: 13, fontWeight: '700' },
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
  input: { borderRadius: 9, borderWidth: 1, fontSize: 13, lineHeight: 18, marginTop: 6, minHeight: 40, padding: 9 },
  interactionText: { fontSize: 11, marginTop: 8 },
  patientCard: { borderRadius: 12, borderWidth: 1, marginTop: 8, padding: 12 },
  patientHeader: { alignItems: 'flex-start', flexDirection: 'row', gap: 8 },
  patientMeta: { fontSize: 12, marginTop: 2 },
  patientName: { fontSize: 15, fontWeight: '800' },
  primaryButton: { alignItems: 'center', borderRadius: 10, justifyContent: 'center', minHeight: 40, paddingHorizontal: 12, paddingVertical: 9 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800', textAlign: 'center' },
  provenanceBlock: { gap: 3, marginTop: 10 },
  provenanceText: { fontSize: 11, lineHeight: 16 },
  readOnlyValue: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  requirementCard: { borderRadius: 10, borderWidth: 1, marginTop: 8, padding: 10 },
  reviewGroup: { borderRadius: 14, borderWidth: 1, gap: 6, padding: 12 },
  sbarCard: { borderRadius: 12, marginTop: 12, padding: 12 },
  secondaryButton: { alignItems: 'center', borderRadius: 10, borderWidth: 1, justifyContent: 'center', marginTop: 9, minHeight: 38, paddingHorizontal: 12, paddingVertical: 8 },
  secondaryButtonText: { fontSize: 12, fontWeight: '800', textAlign: 'center' },
  sectionLabel: { fontSize: 14, fontWeight: '800' },
  statusPill: { fontSize: 11, fontWeight: '900', maxWidth: 150, textAlign: 'right' },
  subtitle: { fontSize: 13, lineHeight: 19 },
  title: { fontSize: 22, fontWeight: '900' },
  transferCard: { borderRadius: 14, borderWidth: 1, marginTop: 12, padding: 14 },
  unchangedHeader: { borderRadius: 14, borderWidth: 1, padding: 12 },
});
