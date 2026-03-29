import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getSyncSnapshot, subscribeSyncStatus, type SyncSnapshot } from '@/src/lib/sync';
import { getQueueSize } from '@/src/lib/sync/index';
import type { RootStackParamList } from '@/src/navigation/types';
import { useThemeTokens } from '@/src/theme';
import { useTranslation } from '@/src/i18n';

type Props = {
  onOpenSyncCenter?: () => void;
};

const SYNC_BANNER_QUEUE_REFRESH_MS = 3_000;

// Params i18n: solo string | number | undefined (no unknown)
type TranslateFn = (key: string, params?: Record<string, string | number | undefined>) => string;

function resolveStatusMessage(snapshot: SyncSnapshot, pendingCount: number, t: TranslateFn, now: number) {
  switch (snapshot.status) {
    case 'running':
      return t('sync.runningMessage', { count: pendingCount });

    case 'backoff': {
      const nextRetryAt = snapshot.nextRetryAt ?? now;
      const seconds = Math.max(1, Math.ceil((nextRetryAt - now) / 1000));
      return t('sync.backoffMessage', { seconds });
    }

    case 'paused':
      return t('sync.pausedMessage');

    case 'idle':
    default:
      if (pendingCount > 0) {
        return t('sync.runningMessage', { count: pendingCount });
      }
      return t('sync.idleMessage');
  }
}

// lastError en tu SyncSnapshot es string (según el TS2339).
// Igual lo convertimos de forma defensiva por si alguna capa lo cambiara.
function toErrorText(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return String(err);
}

export default function SyncStatusBanner({ onOpenSyncCenter }: Props) {
  const { colors } = useThemeTokens();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { t } = useTranslation();

  // Cast controlado para usar keys string sin pelear con TranslationKey/Params
  const tt = t as unknown as TranslateFn;

  const [snapshot, setSnapshot] = React.useState(getSyncSnapshot());
  const [canonicalPendingCount, setCanonicalPendingCount] = React.useState(0);
  const [now, setNow] = React.useState(Date.now());

  React.useEffect(() => subscribeSyncStatus(setSnapshot), []);

  React.useEffect(() => {
    let active = true;

    const refreshQueueCount = async () => {
      const count = await getQueueSize().catch(() => -1);
      if (!active) return;
      setCanonicalPendingCount(count < 0 ? 0 : count);
    };

    void refreshQueueCount();
    const interval = setInterval(() => {
      void refreshQueueCount();
    }, SYNC_BANNER_QUEUE_REFRESH_MS);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  React.useEffect(() => {
    if (snapshot.status !== 'backoff') return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [snapshot.status]);

  const effectivePendingCount = Math.max(snapshot.pendingCount, canonicalPendingCount);
  const shouldShow = snapshot.status !== 'idle' || effectivePendingCount > 0 || !!snapshot.lastError;
  if (!shouldShow) return null;

  const message = resolveStatusMessage(snapshot, effectivePendingCount, tt, now);

  const errorText = toErrorText(snapshot.lastError);
  const hasError = errorText.length > 0;
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

        {hasError ? (
          <Text style={[styles.detail, { color: colors.danger }]}>
            {tt('sync.lastErrorMessage', { error: errorText })}
          </Text>
        ) : null}

        {effectivePendingCount > 0 ? (
          <Text style={[styles.detail, { color: colors.text }]}>
            {tt('sync.pendingCountMessage', { count: effectivePendingCount })}
          </Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        {isPaused ? (
          <Pressable onPress={handleLogin} accessibilityRole="button">
            <Text style={[styles.cta, { color: colors.primary }]}>{tt('sync.loginCta')}</Text>
          </Pressable>
        ) : null}

        <Pressable onPress={handleOpenSync} accessibilityRole="button">
          <Text style={[styles.cta, { color: colors.primary }]}>{tt('sync.openSyncCenter')}</Text>
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
