import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getSyncSnapshot, subscribeSyncStatus, type SyncSnapshot } from '@/src/lib/sync';
import type { RootStackParamList } from '@/src/navigation/types';
import { useThemeTokens } from '@/src/theme';
import { useTranslation } from '@/src/i18n';

type Props = {
  onOpenSyncCenter?: () => void;
};

function resolveStatusMessage(
  snapshot: SyncSnapshot,
  t: (key: string, vars?: Record<string, unknown>) => string,
  now: number,
) {
  switch (snapshot.status) {
    case 'running':
      return t('sync.runningMessage', { count: snapshot.pendingCount });
    case 'backoff': {
      const nextRetryAt = snapshot.nextRetryAt ?? now;
      const seconds = Math.max(1, Math.ceil((nextRetryAt - now) / 1000));
      return t('sync.backoffMessage', { seconds });
    }
    case 'paused':
      return t('sync.pausedMessage');
    case 'idle':
    default:
      return t('sync.idleMessage');
  }
}

export default function SyncStatusBanner({ onOpenSyncCenter }: Props) {
  const { colors } = useThemeTokens();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = React.useState(getSyncSnapshot());
  const [now, setNow] = React.useState(Date.now());

  React.useEffect(() => subscribeSyncStatus(setSnapshot), []);

  React.useEffect(() => {
    if (snapshot.status !== 'backoff') return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [snapshot.status]);

  const shouldShow = snapshot.status !== 'idle' || snapshot.pendingCount > 0 || !!snapshot.lastError;
  if (!shouldShow) return null;

  const message = resolveStatusMessage(snapshot, t, now);
  const hasError = Boolean(snapshot.lastError);
  const isPaused = snapshot.status === 'paused';

  const bannerBackground = isPaused
    ? `${colors.danger}22`
    : snapshot.status === 'backoff'
    ? `${colors.warning}22`
    : snapshot.status === 'running'
    ? `${colors.info}22`
    : `${colors.success}22`;

  const titleColor = isPaused
    ? colors.danger
    : snapshot.status === 'backoff'
    ? colors.warning
    : snapshot.status === 'running'
    ? colors.info
    : colors.success;

  const handleOpenSync = () => {
    if (onOpenSyncCenter) {
      onOpenSyncCenter();
      return;
    }
    navigation.navigate('SyncCenter');
  };

  const handleLogin = () => {
    navigation.navigate('Login');
  };

  return (
    <View style={[styles.wrapper, { backgroundColor: bannerBackground, borderColor: titleColor }]}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: titleColor }]}>{message}</Text>
        {hasError && snapshot.lastError ? (
          <Text style={[styles.detail, { color: colors.danger }]}>
            {t('sync.lastErrorMessage', { error: snapshot.lastError })}
          </Text>
        ) : null}
        {snapshot.pendingCount > 0 ? (
          <Text style={[styles.detail, { color: colors.text }]}>
            {t('sync.pendingCountMessage', { count: snapshot.pendingCount })}
          </Text>
        ) : null}
      </View>
      <View style={styles.actions}>
        {isPaused ? (
          <Pressable onPress={handleLogin} accessibilityRole="button">
            <Text style={[styles.cta, { color: colors.primary }]}>{t('sync.loginCta')}</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={handleOpenSync} accessibilityRole="button">
          <Text style={[styles.cta, { color: colors.primary }]}>{t('sync.openSyncCenter')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderWidth: 1,
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 8,
    padding: 12,
  },
  content: {
    gap: 4,
  },
  title: { fontWeight: '700', fontSize: 14 },
  detail: { fontSize: 12 },
  actions: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  cta: { fontWeight: '600' },
});
