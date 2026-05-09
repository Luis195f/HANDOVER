import React from 'react';
import { Button, Pressable, Text, View, type TextStyle, type ViewStyle } from 'react-native';

import type { PatientSummary } from '@/src/lib/fhir-client';
import type { HandoverProfileRuntime } from '@/src/lib/profile-runtime';
import type { SyncSnapshot } from '@/src/lib/sync';
import { t } from '@/src/i18n';

import { PatientBanner } from '../components/PatientBanner';
import type { HandoverSyncStatus } from './useHandoverSyncStatus';

type StyleRecord = Record<string, TextStyle | ViewStyle>;

type Props = {
  styles: StyleRecord;
  colors: {
    text: string;
    primary: string;
    danger: string;
    success: string;
    warning: string;
    info: string;
  };
  handoverSyncStatus: HandoverSyncStatus;
  handoverSyncError: string | null;
  syncSnapshot: Pick<SyncSnapshot, 'status'>;
  onRetrySync: () => void;
  onOpenLogin: () => void;
  onOpenSyncCenter: () => void;
  isE2E: boolean;
  onSetFinalStatus: () => void;
  onAddSignature: () => void;
  onCompleteChecklist: () => void;
  profileRuntime: HandoverProfileRuntime;
  bannerSummary: PatientSummary | null;
  bannerLoading: boolean;
  patientSummaryError?: string | null;
};

const resolveSyncNoticeCopy = (
  handoverSyncStatus: HandoverSyncStatus,
  handoverSyncError: string | null,
) => {
  switch (handoverSyncStatus) {
    case 'queued':
      return t('handover.syncQueuedMessage');
    case 'syncing':
      return t('handover.syncSyncingMessage');
    case 'synced':
      return t('handover.syncSyncedMessage');
    case 'error':
      return t('handover.syncErrorMessage', { error: handoverSyncError ?? t('sync.syncErrorTitle') });
    case 'idle':
    default:
      return '';
  }
};

const resolveSyncNoticeColors = (
  status: HandoverSyncStatus,
  colors: Props['colors'],
) => {
  if (status === 'error') {
    return { backgroundColor: `${colors.danger}12`, borderColor: colors.danger, textColor: colors.danger };
  }
  if (status === 'synced') {
    return { backgroundColor: `${colors.success}12`, borderColor: colors.success, textColor: colors.success };
  }
  if (status === 'syncing' || status === 'queued') {
    return { backgroundColor: `${colors.warning}12`, borderColor: colors.warning, textColor: colors.warning };
  }
  return { backgroundColor: `${colors.info}12`, borderColor: colors.info, textColor: colors.info };
};

export function HandoverOverview({
  styles,
  colors,
  handoverSyncStatus,
  handoverSyncError,
  syncSnapshot,
  onRetrySync,
  onOpenLogin,
  onOpenSyncCenter,
  isE2E,
  onSetFinalStatus,
  onAddSignature,
  onCompleteChecklist,
  profileRuntime,
  bannerSummary,
  bannerLoading,
  patientSummaryError,
}: Props) {
  const syncNoticeCopy = resolveSyncNoticeCopy(handoverSyncStatus, handoverSyncError);
  const syncNoticeColors = resolveSyncNoticeColors(handoverSyncStatus, colors);
  const usesBehavioralHealthRuntime =
    profileRuntime.basePack.id === 'behavioral-health' || profileRuntime.pack.id === 'behavioral-health';

  return (
    <>
      <PatientBanner
        summary={bannerSummary}
        loading={bannerLoading}
        error={patientSummaryError}
      />
      {handoverSyncStatus !== 'idle' ? (
        <View
          style={[
            styles.syncNotice,
            { backgroundColor: syncNoticeColors.backgroundColor, borderColor: syncNoticeColors.borderColor },
          ]}
        >
          <Text style={[styles.syncNoticeTitle, { color: syncNoticeColors.textColor }]}>{t('sync.syncTitle')}</Text>
          <Text style={[styles.syncNoticeMessage, { color: colors.text }]}>{syncNoticeCopy}</Text>
          <View style={styles.syncNoticeActions}>
            {handoverSyncStatus === 'error' ? (
              <Pressable accessibilityRole="button" onPress={onRetrySync}>
                <Text style={[styles.syncNoticeCta, { color: colors.primary }]}>{t('sync.retryNow')}</Text>
              </Pressable>
            ) : null}
            {syncSnapshot.status === 'paused' ? (
              <Pressable accessibilityRole="button" onPress={onOpenLogin}>
                <Text style={[styles.syncNoticeCta, { color: colors.primary }]}>{t('sync.loginCta')}</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" onPress={onOpenSyncCenter}>
              <Text style={[styles.syncNoticeCta, { color: colors.primary }]}>{t('sync.openSyncCenter')}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {isE2E ? (
        <View style={styles.e2eControls} testID="e2e-controls">
          <Text style={styles.e2eTitle}>Controles E2E</Text>
          <View style={styles.e2eActions}>
            <Button title="Marcar final" onPress={onSetFinalStatus} testID="e2e-set-final" />
            <Button title="Registrar firma" onPress={onAddSignature} testID="e2e-add-signature" />
            <Button title="Completar checklist" onPress={onCompleteChecklist} testID="e2e-complete-checklist" />
          </View>
        </View>
      ) : null}
      <View style={styles.profileCard} testID="handover-profile-runtime">
        <Text style={styles.profileCardTitle}>
          {profileRuntime.context.usesCoreFallback
            ? 'HANDOVER Core activo'
            : `Perfil de unidad activo: ${profileRuntime.basePack.label}`}
        </Text>
        <Text style={styles.profileCardMeta}>
          {profileRuntime.context.usesCoreFallback
            ? 'No hay un UPP activo para esta unidad; el formulario cae al Core sin abrir una pantalla paralela.'
            : `Unidad resuelta: ${profileRuntime.basePack.label}.`}
        </Text>
        {profileRuntime.activeOverlays.length > 0 ? (
          <Text style={styles.profileCardMeta}>
            {`SOP activos: ${profileRuntime.activeOverlays.map((overlay) => overlay.label).join(' · ')}`}
          </Text>
        ) : null}
        {profileRuntime.context.hasHumanSpecialtyOverride ? (
          <Text style={styles.profileCardMeta}>
            {`Override humano de especialidad activo: ${profileRuntime.context.requestedSpecialtyId ?? profileRuntime.context.specialtyId ?? 'sin especialidad'}.`}
          </Text>
        ) : null}
        {profileRuntime.focusAreas.length > 0 ? (
          <Text style={styles.profileCardMeta}>
            {`Foco clinico: ${profileRuntime.focusAreas.join(' · ')}`}
          </Text>
        ) : null}
        {profileRuntime.requiredExtraFields.length > 0 ? (
          <Text style={styles.profileCardMeta}>
            {`Campos extra minimos: ${profileRuntime.requiredExtraFields.join(' · ')}`}
          </Text>
        ) : null}
        {profileRuntime.sentinelEvents.length > 0 ? (
          <Text style={styles.profileCardMeta}>
            {`Eventos criticos: ${profileRuntime.sentinelEvents.join(' · ')}`}
          </Text>
        ) : null}
        {profileRuntime.explanations.length > 0 ? (
          <Text style={styles.profileCardMeta}>
            {`Explicacion visible: ${profileRuntime.explanations.join(' · ')}`}
          </Text>
        ) : null}
        <Text style={styles.profileCardMeta}>
          {`Merge aplicado: ${profileRuntime.mergeTrace.map((entry) => entry.label).join(' -> ')}`}
        </Text>
        {profileRuntime.visibleOutputs.length > 0 ? (
          <View testID="handover-profile-visible-outputs">
            <Text style={styles.profileCardMeta}>
              {usesBehavioralHealthRuntime
                ? 'Prioridades explicables de continuidad (MPAC prudente):'
                : 'Salidas visibles:'}
            </Text>
            {profileRuntime.visibleOutputs.map((output) => (
              <Text key={output} style={styles.profileCardMeta}>
                {`- ${output}`}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
    </>
  );
}
