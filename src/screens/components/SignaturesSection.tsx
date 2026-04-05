import React, { useMemo } from 'react';
import { Alert, Button, StyleSheet, Text, View } from 'react-native';

import { hashHex } from '@/src/lib/crypto';
import type { HandoverSignature } from '@/src/types/handover';
import type { HandoverValues } from '@/src/validation/schemas';
import { t } from '@/src/i18n';

export type SignatureUser = {
  id?: string;
  userId?: string;
  name?: string;
  fullName?: string;
  displayName?: string;
  role?: string;
  roles?: string[];
  units?: string[];
  activeUnitId?: string;
};

export type SignatureInfo = HandoverValues['signatures'];

type Props = {
  value?: SignatureInfo;
  onChange: (next: SignatureInfo) => void;
  currentUser?: SignatureUser | null;
  administrativeUnitId?: string;
  getSignaturePayload?: () => unknown;
  disableOutgoingAction?: boolean;
};

type SignatureKind = 'outgoing' | 'incoming';

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderColor: '#CBD5F5',
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#F8FAFF',
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  block: { marginBottom: 16 },
  label: { fontWeight: '600', marginBottom: 4 },
  valueText: { marginBottom: 6 },
  emptyText: { color: '#4B5563', marginBottom: 8 },
  action: { alignSelf: 'flex-start' },
});

function formatSignedAt(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function canUserSign(user?: SignatureUser | null) {
  if (!user) return false;
  const roles = user.roles ?? (user.role ? [user.role] : []);
  return roles.includes('nurse');
}

function buildSignatureFromUser(
  user: SignatureUser,
  unitId: string,
  signatureHash?: string,
  signedAt?: string,
): HandoverSignature {
  const resolvedRole =
    (user.roles?.[0] as HandoverSignature['role']) ??
    (user.role as HandoverSignature['role']) ??
    'nurse';
  return {
    userId: user.id ?? user.userId ?? user.displayName ?? 'unknown-user',
    fullName: user.fullName ?? user.name ?? user.displayName ?? user.userId ?? t('signatures.unknownUser'),
    role: resolvedRole,
    unitId,
    signedAt: signedAt ?? new Date().toISOString(),
    signatureHash,
    deviceInfo: undefined,
    method: 'session',
  };
}

export function SignaturesSection({
  value,
  onChange,
  currentUser,
  administrativeUnitId,
  getSignaturePayload,
  disableOutgoingAction,
}: Props) {
  const outgoing = value?.outgoing;
  const incoming = value?.incoming;
  const allowedToSign = canUserSign(currentUser);
  const activeUnitId = administrativeUnitId ?? currentUser?.activeUnitId ?? currentUser?.units?.[0];
  const hasUnit = !!activeUnitId;
  const canSignWithUnit = allowedToSign && hasUnit;

  const signingUserLabel = useMemo(
    () => currentUser?.fullName ?? currentUser?.displayName ?? currentUser?.name ?? currentUser?.userId,
    [currentUser],
  );

  const confirmSignature = (kind: SignatureKind) => {
    if (!currentUser || !activeUnitId) return;
    const message =
      kind === 'outgoing'
        ? t('signatures.confirmOutgoingMessage')
        : t('signatures.confirmIncomingMessage');
    Alert.alert(t('signatures.confirmTitle'), message, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('signatures.confirm'),
        style: 'default',
        onPress: () => {
          const timestamp = new Date().toISOString();
          const contentToSign = JSON.stringify(getSignaturePayload?.() ?? {});
          const signatureHash = hashHex(`${contentToSign}${timestamp}`);
          const nextSignature = buildSignatureFromUser(
            currentUser,
            activeUnitId,
            signatureHash,
            timestamp,
          );
          onChange({
            ...value,
            [kind]: nextSignature,
          });
        },
      },
    ]);
  };

  const renderBlock = (kind: SignatureKind, signature?: HandoverSignature | null) => {
    const isOutgoing = kind === 'outgoing';
    return (
      <View style={styles.block}>
        <Text style={styles.label}>
          {isOutgoing ? t('signatures.outgoingLabel') : t('signatures.incomingLabel')}
        </Text>
        {signature ? (
          <View>
            <Text style={styles.valueText}>
              {t('signatures.nameLabel')}: {signature.fullName}
            </Text>
            <Text style={styles.valueText}>
              {t('signatures.roleLabel')}: {signature.role ?? t('common.notAvailable')}
            </Text>
            <Text style={styles.valueText}>
              {t('signatures.unitLabel')}: {signature.unitId}
            </Text>
            <Text style={styles.valueText}>
              {t('signatures.dateLabel')}: {formatSignedAt(signature.signedAt)}
            </Text>
          </View>
        ) : (
          <View>
            <Text style={styles.emptyText}>{t('signatures.noSignature')}</Text>
            {canSignWithUnit && !(isOutgoing && disableOutgoingAction) ? (
              <View style={styles.action}>
                <Button
                  title={isOutgoing ? t('signatures.signOutgoing') : t('signatures.signIncoming')}
                  onPress={() => confirmSignature(kind)}
                />
              </View>
            ) : null}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={styles.title}>{t('signatures.sectionTitle')}</Text>
        {signingUserLabel ? (
          <Text>{t('signatures.currentUserLabel', { name: signingUserLabel })}</Text>
        ) : null}
      </View>
      {renderBlock('outgoing', outgoing)}
      {renderBlock('incoming', incoming)}
      {!hasUnit && allowedToSign ? (
        <Text style={styles.emptyText}>{t('signatures.selectUnitHint')}</Text>
      ) : null}
    </View>
  );
}
