import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useAdminDashboardData } from '../../hooks/useAdminDashboardData';
import { hasRole } from '../../security/acl';
import { useAuth } from '../../security/auth';
import type {
  ClinicalDecisionGovernanceDecisionCounts,
  ClinicalDecisionGovernanceSection,
  ClinicalDecisionGovernanceSource,
  ClinicalDecisionGovernanceSummary,
  ClinicalDecisionGovernanceValue,
  IceaOpsErrorSummary,
  IceaOpsEventSummary,
  IceaOpsUnitSummary,
} from '../../types/admin';

type GovernanceFilterDraft = {
  unitId: string;
  suggestionSource: 'all' | ClinicalDecisionGovernanceSource;
  decision: 'all' | ClinicalDecisionGovernanceValue;
  section: 'all' | ClinicalDecisionGovernanceSection;
  dateFrom: string;
  dateTo: string;
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const GOVERNANCE_SOURCE_OPTIONS: Array<{ value: GovernanceFilterDraft['suggestionSource']; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'ai_generate_sbar', label: 'SBAR IA' },
  { value: 'ai_refine_sbar', label: 'Refinado SBAR' },
  { value: 'ai_nic_suggestions', label: 'NIC' },
  { value: 'ai_noc_suggestions', label: 'NOC' },
];
const GOVERNANCE_DECISION_OPTIONS: Array<{ value: GovernanceFilterDraft['decision']; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'shown', label: 'Mostradas' },
  { value: 'applied', label: 'Aplicadas' },
  { value: 'dismissed', label: 'Descartadas' },
  { value: 'accepted', label: 'Aceptadas' },
  { value: 'rejected', label: 'Rechazadas' },
];
const GOVERNANCE_SECTION_OPTIONS: Array<{ value: GovernanceFilterDraft['section']; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'sbar', label: 'SBAR' },
  { value: 'treatments', label: 'Tratamientos' },
  { value: 'outcomes', label: 'Resultados' },
];

function formatDate(value: string | null | undefined) {
  if (!value) return 'Sin datos';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10));
    if ([year, month, day].every((part) => Number.isFinite(part))) {
      return new Intl.DateTimeFormat('es-ES', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(year, month - 1, day)));
    }
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('es-ES');
}

function toLocalDateInputValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function defaultGovernanceFilters(): GovernanceFilterDraft {
  const currentDate = new Date();
  const dateTo = toLocalDateInputValue(currentDate);
  const dateFromValue = new Date(currentDate);
  dateFromValue.setDate(dateFromValue.getDate() - 29);
  const dateFrom = toLocalDateInputValue(dateFromValue);
  return {
    unitId: '',
    suggestionSource: 'all',
    decision: 'all',
    section: 'all',
    dateFrom,
    dateTo,
  };
}

function stateLabel(state: string | null | undefined) {
  switch (state) {
    case 'healthy':
      return 'Healthy';
    case 'degraded':
      return 'Degraded';
    case 'backlog':
      return 'Backlog';
    case 'stale':
      return 'Stale';
    case 'failed':
      return 'Failed';
    default:
      return state || 'Unavailable';
  }
}

function stateColors(state: string | null | undefined) {
  switch (state) {
    case 'healthy':
      return { border: '#86efac', background: '#f0fdf4', text: '#166534' };
    case 'backlog':
      return { border: '#fcd34d', background: '#fffbeb', text: '#92400e' };
    case 'stale':
      return { border: '#fdba74', background: '#fff7ed', text: '#9a3412' };
    case 'failed':
      return { border: '#fca5a5', background: '#fef2f2', text: '#991b1b' };
    default:
      return { border: '#fcd34d', background: '#fffbeb', text: '#92400e' };
  }
}

function governanceSourceLabel(source: string) {
  switch (source) {
    case 'ai_generate_sbar':
      return 'SBAR generado por IA';
    case 'ai_refine_sbar':
      return 'SBAR refinado por IA';
    case 'ai_nic_suggestions':
      return 'Sugerencias NIC';
    case 'ai_noc_suggestions':
      return 'Sugerencias NOC';
    default:
      return source;
  }
}

function governanceSectionLabel(section: string) {
  switch (section) {
    case 'sbar':
      return 'SBAR';
    case 'treatments':
      return 'Tratamientos';
    case 'outcomes':
      return 'Resultados';
    default:
      return section;
  }
}

function decisionCount(summary: ClinicalDecisionGovernanceSummary | null | undefined, target: ClinicalDecisionGovernanceValue) {
  return summary?.byDecision.find((item) => item.decision === target)?.count ?? 0;
}

function Banner({ state, children }: { state: string; children: React.ReactNode }) {
  const colors = stateColors(state);
  return (
    <View
      style={{
        marginBottom: 12,
        padding: 12,
        borderRadius: 10,
        borderWidth: 1,
        backgroundColor: colors.background,
        borderColor: colors.border,
      }}
    >
      <Text style={{ color: colors.text }}>{children}</Text>
    </View>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return (
    <View
      style={{
        flexBasis: '48%',
        padding: 12,
        marginBottom: 10,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        backgroundColor: '#fff',
      }}
    >
      <Text style={{ color: '#475569', marginBottom: 4 }}>{label}</Text>
      <Text style={{ fontSize: 20, fontWeight: '700', color: '#0f172a' }}>{value}</Text>
      {detail ? <Text style={{ marginTop: 4, color: '#64748b' }}>{detail}</Text> : null}
    </View>
  );
}

function ErrorCard({ item }: { item: IceaOpsErrorSummary }) {
  return (
    <View
      style={{
        padding: 12,
        marginBottom: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        backgroundColor: '#fff',
      }}
    >
      <Text style={{ fontWeight: '600' }}>
        {item.source} · {item.errorFamily}
      </Text>
      <Text>Casos: {item.count}</Text>
      <Text style={{ fontSize: 12, marginTop: 4, color: '#64748b' }}>Última vez: {formatDate(item.lastSeenAt)}</Text>
    </View>
  );
}

function EventCard({ event }: { event: IceaOpsEventSummary }) {
  const colors = stateColors(event.status);
  return (
    <View
      style={{
        padding: 12,
        marginBottom: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.background,
      }}
    >
      <Text style={{ fontWeight: '600', color: colors.text }}>
        {(event.unitId ?? 'sin-unidad') + ' · ' + event.source + ' · ' + event.status}
      </Text>
      {event.stage ? <Text>Etapa: {event.stage}</Text> : null}
      {event.scoringMode ? <Text>Modo: {event.scoringMode}</Text> : null}
      {event.errorFamily ? <Text>Familia error: {event.errorFamily}</Text> : null}
      {event.requestId ? <Text>request_id: {event.requestId}</Text> : null}
      {event.bundleId ? <Text>bundle_id: {event.bundleId}</Text> : null}
      {event.payloadHash ? <Text>payload_hash: {event.payloadHash}</Text> : null}
      <Text style={{ fontSize: 12, marginTop: 4 }}>{formatDate(event.updatedAt)}</Text>
    </View>
  );
}

function UnitCard({
  unit,
  canTriggerActions,
  refreshingUnitId,
  onRefresh,
}: {
  unit: IceaOpsUnitSummary;
  canTriggerActions: boolean;
  refreshingUnitId: string | null;
  onRefresh: (unitId: string) => void;
}) {
  const colors = stateColors(unit.state);
  return (
    <View
      style={{
        padding: 12,
        marginBottom: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: '#fff',
      }}
    >
      <Text style={{ fontWeight: '600', marginBottom: 6 }}>{unit.unitId}</Text>
      <Text>Estado operativo: {stateLabel(unit.state)}</Text>
      <Text>Pending count: {unit.pendingCount}</Text>
      <Text>Última actualización: {formatDate(unit.lastUpdatedAt)}</Text>
      <Text>Handovers exportados: {unit.counts.handoversExported}</Text>
      <Text>
        Outbox queued/retry/failed: {unit.counts.outbox.queued}/{unit.counts.outbox.retry}/{unit.counts.outbox.failed}
      </Text>
      <Text>
        Bridge pending/scored/stale: {unit.counts.bridge.pending}/{unit.counts.bridge.scored}/{unit.counts.bridge.stale}
      </Text>
      <Text>
        Pipeline running/retry/failed: {unit.counts.pipeline.running}/{unit.counts.pipeline.retry}/{unit.counts.pipeline.failed}
      </Text>
      <Text>Último delivery: {formatDate(unit.freshness.lastOutboundDeliveredAt)}</Text>
      {unit.shifts.length > 0 ? (
        <Text style={{ marginTop: 6 }}>
          Shifts: {unit.shifts.map((shift) => `${shift.shift} ${shift.state} (${shift.pendingCount})`).join(' · ')}
        </Text>
      ) : (
        <Text style={{ marginTop: 6, color: '#64748b' }}>Shifts: sin datos reales</Text>
      )}
      {!unit.available && unit.unavailableReason ? (
        <Text style={{ marginTop: 6, color: '#92400e' }}>Unavailable: {unit.unavailableReason}</Text>
      ) : null}
      {canTriggerActions ? (
        <Pressable onPress={() => onRefresh(unit.unitId)} disabled={refreshingUnitId === unit.unitId} style={{ marginTop: 10 }}>
          <Text style={{ color: refreshingUnitId === unit.unitId ? '#94a3b8' : '#2563eb' }}>
            {refreshingUnitId === unit.unitId ? 'Actualizando...' : 'Refrescar summary remoto'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function FilterChip({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? '#1d4ed8' : '#cbd5e1',
        backgroundColor: active ? '#eff6ff' : '#fff',
      }}
    >
      <Text style={{ color: active ? '#1d4ed8' : '#334155', fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

function GovernanceBreakdownCard({
  title,
  count,
  decisions,
}: {
  title: string;
  count: number;
  decisions: ClinicalDecisionGovernanceDecisionCounts;
}) {
  return (
    <View
      style={{
        padding: 12,
        marginBottom: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        backgroundColor: '#fff',
      }}
    >
      <Text style={{ fontWeight: '700', color: '#0f172a' }}>{title}</Text>
      <Text style={{ marginTop: 4, color: '#334155' }}>Eventos: {count}</Text>
      <Text style={{ marginTop: 6, color: '#64748b' }}>
        Mostradas {decisions.shown} · Aplicadas {decisions.applied} · Descartadas {decisions.dismissed} · Aceptadas {decisions.accepted} · Rechazadas {decisions.rejected}
      </Text>
    </View>
  );
}

export function AdminDashboardScreen() {
  const { session, loading: authLoading } = useAuth();
  const canAdminister = hasRole(session, ['admin', 'supervisor']);
  const canTriggerActions = hasRole(session, ['admin']);
  const isDemoSession = session?.mode === 'demo';
  const [draftFilters, setDraftFilters] = useState<GovernanceFilterDraft>(defaultGovernanceFilters);
  const [appliedFilters, setAppliedFilters] = useState<GovernanceFilterDraft>(defaultGovernanceFilters);

  const governanceApiFilters = useMemo(
    () => ({
      unitId: appliedFilters.unitId.trim() || undefined,
      suggestionSource: appliedFilters.suggestionSource === 'all' ? undefined : appliedFilters.suggestionSource,
      decision: appliedFilters.decision === 'all' ? undefined : appliedFilters.decision,
      section: appliedFilters.section === 'all' ? undefined : appliedFilters.section,
      dateFrom: appliedFilters.dateFrom.trim() || undefined,
      dateTo: appliedFilters.dateTo.trim() || undefined,
    }),
    [appliedFilters],
  );

  const { data, loading, error, reload, refreshRemoteSummary, refreshingUnitId, stale, lastLoadedAt } = useAdminDashboardData(
    canAdminister,
    {
      demoMode: isDemoSession,
      includeClinicalDecisionSummary: true,
      clinicalDecisionFilters: governanceApiFilters,
    },
  );

  const applyGovernanceFilters = () => {
    setAppliedFilters({
      unitId: draftFilters.unitId.trim(),
      suggestionSource: draftFilters.suggestionSource,
      decision: draftFilters.decision,
      section: draftFilters.section,
      dateFrom: draftFilters.dateFrom.trim(),
      dateTo: draftFilters.dateTo.trim(),
    });
  };

  const resetGovernanceFilters = () => {
    const next = defaultGovernanceFilters();
    setDraftFilters(next);
    setAppliedFilters(next);
  };

  if (authLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!session || !canAdminister) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <Text>Acceso restringido. Solo usuarios administrativos.</Text>
      </View>
    );
  }

  if (loading && !data) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
        <Text style={{ marginTop: 8 }}>Cargando observabilidad operativa...</Text>
      </View>
    );
  }

  if (error && !data) {
    return (
      <View style={{ flex: 1, padding: 16 }}>
        <Banner state="failed">{error.message}</Banner>
        <Pressable onPress={reload}>
          <Text style={{ color: '#2563eb' }}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }

  if (!data) return null;

  const { summary, events, clinicalDecisionSummary } = data;
  const isEmpty = Boolean(summary.empty || (summary.units.length === 0 && events.length === 0 && (summary.errors?.length ?? 0) === 0));
  const governanceUnavailable = clinicalDecisionSummary?.available === false;
  const governanceEmpty = Boolean(clinicalDecisionSummary?.empty);

  return (
    <ScrollView style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 20, fontWeight: '600', marginBottom: 8 }}>Observabilidad operativa ICEA+</Text>
      <Text style={{ marginBottom: 16 }}>Fuente: backend HANDOVER, sin llamadas directas del frontend a ICEA+.</Text>
      <Text style={{ marginBottom: 4, color: '#475569' }}>Generado: {formatDate(summary.generatedAt)}</Text>
      <Text style={{ marginBottom: 16, color: '#475569' }}>Última actividad: {formatDate(summary.lastUpdatedAt ?? lastLoadedAt)}</Text>

      {isDemoSession ? <Banner state="healthy">Modo demo explícito: estos datos están etiquetados como demo.</Banner> : null}
      {stale ? <Banner state="stale">La vista muestra el último estado persistido y puede estar stale.</Banner> : null}
      {!summary.available ? (
        <Banner state="degraded">Observabilidad unavailable: {summary.unavailableReason ?? 'feature flag deshabilitado.'}</Banner>
      ) : null}
      {summary.state && summary.available ? <Banner state={summary.state}>Estado global: {stateLabel(summary.state)}</Banner> : null}
      {error && data ? <Banner state="failed">No se pudo refrescar el backend. Se conserva el último resumen local.</Banner> : null}

      {isEmpty ? (
        <View style={{ paddingVertical: 24 }}>
          <Text style={{ marginBottom: 8 }}>Todavía no hay datos operativos reales para mostrar.</Text>
          <Text style={{ color: '#64748b' }}>
            Cuando entren handovers, outbox, bridge o eventos de pipeline, esta vista dejará de estar vacía.
          </Text>
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <SummaryCard label="Estado global" value={stateLabel(summary.state)} detail={`Pending ${summary.pendingCount ?? 0}`} />
        <SummaryCard
          label="Handovers exportados"
          value={summary.counts?.handoversExported ?? 0}
          detail={`Outbox delivered ${summary.counts?.outbox.delivered ?? 0}`}
        />
        <SummaryCard
          label="Bridge"
          value={summary.counts?.bridge.scored ?? 0}
          detail={`Pending ${summary.counts?.bridge.pending ?? 0} · Stale ${summary.counts?.bridge.stale ?? 0}`}
        />
        <SummaryCard
          label="Errores tipificados"
          value={summary.errors?.reduce((acc, item) => acc + item.count, 0) ?? 0}
          detail={`Pipeline events ${summary.counts?.pipeline.events ?? 0}`}
        />
      </View>

      <View
        style={{
          marginTop: 12,
          marginBottom: 12,
          padding: 12,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: '#dbeafe',
          backgroundColor: '#f8fbff',
        }}
        testID="clinical-governance-panel"
      >
        <Text style={{ fontSize: 16, fontWeight: '700', color: '#0f172a', marginBottom: 6 }}>
          Gobernanza de decisiones IA
        </Text>
        <Text style={{ color: '#334155', marginBottom: 8 }}>
          Lectura agregada, pilot-grade y no punitiva. No expone profesionales ni habilita benchmarking individual.
        </Text>
        <Text style={{ color: '#64748b', marginBottom: 12 }}>
          Mide decisiones registradas sobre superficies IA ya cableadas en HANDOVER, no verdad clínica ni desempeño profesional.
        </Text>

        <View style={{ marginBottom: 10 }}>
          <Text style={{ fontWeight: '600', color: '#0f172a', marginBottom: 6 }}>Filtros mínimos</Text>
          <TextInput
            value={draftFilters.unitId}
            onChangeText={(unitId) => setDraftFilters((current) => ({ ...current, unitId }))}
            placeholder="unitId técnico (opcional)"
            style={{
              borderWidth: 1,
              borderColor: '#cbd5e1',
              borderRadius: 8,
              paddingHorizontal: 10,
              paddingVertical: 10,
              backgroundColor: '#fff',
              marginBottom: 8,
            }}
            testID="clinical-governance-unit-input"
          />
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
            <TextInput
              value={draftFilters.dateFrom}
              onChangeText={(dateFrom) => setDraftFilters((current) => ({ ...current, dateFrom }))}
              placeholder="YYYY-MM-DD"
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: '#cbd5e1',
                borderRadius: 8,
                paddingHorizontal: 10,
                paddingVertical: 10,
                backgroundColor: '#fff',
              }}
              testID="clinical-governance-date-from-input"
            />
            <TextInput
              value={draftFilters.dateTo}
              onChangeText={(dateTo) => setDraftFilters((current) => ({ ...current, dateTo }))}
              placeholder="YYYY-MM-DD"
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: '#cbd5e1',
                borderRadius: 8,
                paddingHorizontal: 10,
                paddingVertical: 10,
                backgroundColor: '#fff',
              }}
              testID="clinical-governance-date-to-input"
            />
          </View>

          <Text style={{ color: '#475569', marginBottom: 6 }}>Fuente de sugerencia</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            {GOVERNANCE_SOURCE_OPTIONS.map((option) => (
              <FilterChip
                key={option.value}
                active={draftFilters.suggestionSource === option.value}
                label={option.label}
                onPress={() => setDraftFilters((current) => ({ ...current, suggestionSource: option.value }))}
              />
            ))}
          </View>

          <Text style={{ color: '#475569', marginBottom: 6 }}>Tipo de decisión</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
            {GOVERNANCE_DECISION_OPTIONS.map((option) => (
              <FilterChip
                key={option.value}
                active={draftFilters.decision === option.value}
                label={option.label}
                onPress={() => setDraftFilters((current) => ({ ...current, decision: option.value }))}
              />
            ))}
          </View>

          <Text style={{ color: '#475569', marginBottom: 6 }}>Sección funcional</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {GOVERNANCE_SECTION_OPTIONS.map((option) => (
              <FilterChip
                key={option.value}
                active={draftFilters.section === option.value}
                label={option.label}
                onPress={() => setDraftFilters((current) => ({ ...current, section: option.value }))}
              />
            ))}
          </View>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <Pressable
              onPress={applyGovernanceFilters}
              style={{
                backgroundColor: '#1d4ed8',
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: 10,
              }}
              testID="clinical-governance-apply-filters"
            >
              <Text style={{ color: '#fff', fontWeight: '600' }}>Aplicar filtros</Text>
            </Pressable>
            <Pressable
              onPress={resetGovernanceFilters}
              style={{
                backgroundColor: '#e2e8f0',
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: 10,
              }}
              testID="clinical-governance-reset-filters"
            >
              <Text style={{ color: '#0f172a', fontWeight: '600' }}>Limpiar</Text>
            </Pressable>
          </View>
        </View>

        {governanceUnavailable ? (
          <Banner state="degraded">
            Gobernanza unavailable: {clinicalDecisionSummary?.unavailableReason ?? 'feature flag deshabilitado.'}
          </Banner>
        ) : null}

        {clinicalDecisionSummary?.available ? (
          <>
            <Text style={{ color: '#475569', marginBottom: 8 }}>
              Corte: {clinicalDecisionSummary.filters.dateFrom ? formatDate(clinicalDecisionSummary.filters.dateFrom) : 'sin inicio'} hasta{' '}
              {clinicalDecisionSummary.filters.dateTo ? formatDate(clinicalDecisionSummary.filters.dateTo) : 'sin fin'}
            </Text>

            {governanceEmpty ? (
              <View style={{ paddingVertical: 12 }} testID="clinical-governance-empty-state">
                <Text style={{ marginBottom: 6 }}>No hay decisiones IA registradas para este corte.</Text>
                <Text style={{ color: '#64748b' }}>
                  Esta vista resume solo eventos realmente persistidos sobre SBAR/NIC/NOC cableados.
                </Text>
              </View>
            ) : null}

            {!governanceEmpty ? (
              <>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                  <SummaryCard
                    label="Eventos registrados"
                    value={clinicalDecisionSummary.totals.events}
                    detail={`Unidades ${clinicalDecisionSummary.totals.units}`}
                  />
                  <SummaryCard
                    label="Aplicadas"
                    value={decisionCount(clinicalDecisionSummary, 'applied')}
                    detail={`Mostradas ${decisionCount(clinicalDecisionSummary, 'shown')} · Descartadas ${decisionCount(clinicalDecisionSummary, 'dismissed')}`}
                  />
                  <SummaryCard
                    label="Fuentes IA"
                    value={clinicalDecisionSummary.totals.suggestionSources}
                    detail={`Secciones ${clinicalDecisionSummary.totals.sections}`}
                  />
                  <SummaryCard
                    label="Ventanas diarias"
                    value={clinicalDecisionSummary.timeline.length}
                    detail={`Aceptadas ${decisionCount(clinicalDecisionSummary, 'accepted')} · Rechazadas ${decisionCount(clinicalDecisionSummary, 'rejected')}`}
                  />
                </View>

                <Text style={{ fontSize: 16, fontWeight: '600', marginVertical: 8 }}>Distribución por fuente</Text>
                {clinicalDecisionSummary.bySuggestionSource.map((item) => (
                  <GovernanceBreakdownCard
                    key={item.suggestionSource}
                    title={governanceSourceLabel(item.suggestionSource)}
                    count={item.count}
                    decisions={item.decisions}
                  />
                ))}

                <Text style={{ fontSize: 16, fontWeight: '600', marginVertical: 8 }}>Distribución por sección</Text>
                {clinicalDecisionSummary.bySection.length === 0 ? (
                  <Text style={{ color: '#64748b', marginBottom: 12 }}>
                    Sin segmentación por `section` en el corte seleccionado.
                  </Text>
                ) : null}
                {clinicalDecisionSummary.bySection.map((item) => (
                  <GovernanceBreakdownCard
                    key={item.section}
                    title={governanceSectionLabel(item.section)}
                    count={item.count}
                    decisions={item.decisions}
                  />
                ))}

                <Text style={{ fontSize: 16, fontWeight: '600', marginVertical: 8 }}>Distribución por unidad</Text>
                {clinicalDecisionSummary.byUnit.length === 0 ? (
                  <Text style={{ color: '#64748b', marginBottom: 12 }}>Sin unidades con decisiones persistidas en este corte.</Text>
                ) : null}
                {clinicalDecisionSummary.byUnit.map((item) => (
                  <View
                    key={item.unitId}
                    style={{
                      padding: 12,
                      marginBottom: 8,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: '#e2e8f0',
                      backgroundColor: '#fff',
                    }}
                  >
                    <Text style={{ fontWeight: '700', color: '#0f172a' }}>{item.unitId}</Text>
                    <Text style={{ color: '#334155', marginTop: 4 }}>Eventos registrados: {item.count}</Text>
                  </View>
                ))}

                <Text style={{ fontSize: 16, fontWeight: '600', marginVertical: 8 }}>Serie temporal por día</Text>
                {clinicalDecisionSummary.timeline.length === 0 ? (
                  <Text style={{ color: '#64748b', marginBottom: 12 }}>Sin serie temporal disponible para este corte.</Text>
                ) : null}
                {clinicalDecisionSummary.timeline.map((item) => (
                  <View
                    key={item.date}
                    style={{
                      padding: 12,
                      marginBottom: 8,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: '#e2e8f0',
                      backgroundColor: '#fff',
                    }}
                  >
                    <Text style={{ fontWeight: '700', color: '#0f172a' }}>{formatDate(item.date)}</Text>
                    <Text style={{ marginTop: 4, color: '#334155' }}>Eventos: {item.count}</Text>
                    <Text style={{ marginTop: 6, color: '#64748b' }}>
                      Mostradas {item.decisions.shown} · Aplicadas {item.decisions.applied} · Descartadas {item.decisions.dismissed} · Aceptadas {item.decisions.accepted} · Rechazadas {item.decisions.rejected}
                    </Text>
                  </View>
                ))}
              </>
            ) : null}
          </>
        ) : null}

        {clinicalDecisionSummary?.limitations.map((item) => (
          <Text key={item} style={{ color: '#64748b', marginTop: 6 }}>
            {item}
          </Text>
        ))}
      </View>

      <Text style={{ fontSize: 16, fontWeight: '600', marginVertical: 8 }}>Resumen por unidad</Text>
      {summary.units.length === 0 ? <Text style={{ color: '#64748b', marginBottom: 12 }}>Sin unidades con actividad real.</Text> : null}
      {summary.units.map((unit) => (
        <UnitCard
          key={unit.unitId}
          unit={unit}
          canTriggerActions={canTriggerActions}
          refreshingUnitId={refreshingUnitId}
          onRefresh={(unitId) => void refreshRemoteSummary(unitId)}
        />
      ))}

      <Text style={{ fontSize: 16, fontWeight: '600', marginVertical: 8 }}>Familias de error</Text>
      {(summary.errors?.length ?? 0) === 0 ? <Text style={{ color: '#64748b', marginBottom: 12 }}>Sin errores tipificados activos.</Text> : null}
      {summary.errors?.map((item) => (
        <ErrorCard key={`${item.source}-${item.errorFamily}`} item={item} />
      ))}

      <Text style={{ fontSize: 16, fontWeight: '600', marginVertical: 8 }}>Eventos recientes</Text>
      {events.length === 0 ? <Text style={{ color: '#64748b', marginBottom: 12 }}>Sin eventos operativos persistidos.</Text> : null}
      {events.map((event) => (
        <EventCard key={event.eventId} event={event} />
      ))}
    </ScrollView>
  );
}
