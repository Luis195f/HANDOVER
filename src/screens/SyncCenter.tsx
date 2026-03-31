// FILE: src/screens/SyncCenter.tsx
import React from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  Pressable,
  StyleSheet,
  Alert,
  Switch,
} from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { listOfflineQueue, type SyncStatus } from '@/src/lib/queue';
import { flushQueue, type SyncOpts } from '@/src/lib/sync/index';
import { buildIssuesText, parseErrorIssuesJson, resolveErrorCopy } from './SyncCenter.helpers';
import { getUserFacingNetworkMessage, normalizeNetError } from '@/src/lib/net-errors';
import { PrimaryButton } from '../components/PrimaryButton';
import { useThemeTokens } from '../theme';
import type { RootStackParamList } from '@/src/navigation/types';
import { t } from '@/src/i18n';
import { FHIR_BASE_URL } from '@/src/config/env';
import { ensureFreshAccessToken } from '@/src/security/auth';

type QueueItemMeta = {
  id: string;
  createdAt: number | string;
  attempts: number;
  hash?: string;
  syncStatus: SyncStatus;
  errorMessage?: string | null;
  errorStatus?: number | null;
  errorIssuesJson?: string | null;
};

function getAuthReplayMessage(outcome: 'auth-required' | 'auth-failed'): string {
  return outcome === 'auth-failed' ? t('sync.authFailedMessage') : t('sync.authRequiredMessage');
}

function resolveSyncOpts(): SyncOpts | null {
  if (!FHIR_BASE_URL) return null;

  return {
    fhirBaseUrl: FHIR_BASE_URL,
    getToken: () => ensureFreshAccessToken('fhir'),
    backoff: { retries: 5, minMs: 500, maxMs: 15000 },
  };
}

export default function SyncCenter() {
  const { colors, fontSizes } = useThemeTokens();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const palette: Colors = {
    bg: colors.background,
    textPrimary: colors.text,
    textSecondary: colors.muted,
    textHint: colors.muted,
    card: colors.surface,
    border: colors.border,
    accent: colors.info,
    btn: colors.primary,
    btnDisabled: colors.muted,
    btnText: colors.onPrimary,
    statePending: colors.warning,
    stateError: colors.danger,
  };

  const isFocused = useIsFocused();
  const [items, setItems] = React.useState<QueueItemMeta[]>([]);
  const [refreshing, setRefreshing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [authMessage, setAuthMessage] = React.useState<string | null>(null);

  // Auto-retry
  const [autoRetry, setAutoRetry] = React.useState(true);
  const [intervalSec, setIntervalSec] = React.useState(10);
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const [lastRun, setLastRun] = React.useState<string | null>(null);
  const alertedErrorsRef = React.useRef<Set<string>>(new Set());

  const refresh = React.useCallback(async () => {
    setRefreshing(true);
      try {
        const queue = await listOfflineQueue();
        const meta: QueueItemMeta[] = queue.map((item) => ({
          id: item.id,
          createdAt: item.createdAt,
          attempts: item.attempts ?? 0,
          hash: item.id,
          syncStatus: item.syncStatus,
          errorMessage: item.errorMessage,
          errorStatus: item.errorStatus,
          errorIssuesJson: item.errorIssuesJson,
        }));
      setItems(meta);
    } finally {
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);
  React.useEffect(() => {
    if (isFocused) {
      void refresh();
    }
  }, [isFocused, refresh]);

  React.useEffect(() => {
    const candidate = items.find((item) => {
      const status = item.errorStatus ?? null;
      if (item.syncStatus !== 'error' || status == null) return false;
      if (status < 400 || status >= 500) return false;
      return !alertedErrorsRef.current.has(`${item.id}:${status}`);
    });

    if (!candidate) return;
    const status = candidate.errorStatus ?? t('sync.unknownStatus');
    alertedErrorsRef.current.add(`${candidate.id}:${status}`);
    Alert.alert(
      t('sync.syncErrorTitle'),
      t('sync.syncErrorStatusMessage', { status }),
    );
  }, [items]);

  const doFlush = React.useCallback(async () => {
    const opts = resolveSyncOpts();
    if (!opts) {
      Alert.alert(t('sync.syncTitle'), t('sync.configMissingMessage'));
      return { processed: 0, remaining: -1, outcome: 'client-error' as const };
    }
    setAuthMessage(null);
    setBusy(true);
    try {
      const res = await flushQueue(opts);
      if (res.outcome === 'auth-required' || res.outcome === 'auth-failed') {
        const message = getAuthReplayMessage(res.outcome);
        setAuthMessage(message);
        Alert.alert(t('sync.syncTitle'), message);
        return res;
      }
      setAuthMessage(null);
      await refresh();
      setLastRun(new Date().toLocaleTimeString());
      return res;
    } catch (e: unknown) {
      const netError = normalizeNetError(e);
      const ui = getUserFacingNetworkMessage(netError, { screen: 'SyncCenter', op: 'flush' });
      Alert.alert(ui.title, ui.message);
      return { processed: 0, remaining: -1 };
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  // Inicia/detiene interval cuando la pantalla está enfocada
  React.useEffect(() => {
    if (!isFocused || !autoRetry) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      // flush coalescente en sync/index.ts; es seguro llamarlo seguido
      void doFlush();
    }, Math.max(5, Math.min(60, intervalSec)) * 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [autoRetry, intervalSec, doFlush, isFocused]);

  const decInterval = () => setIntervalSec((s) => Math.max(5, s - 5));
  const incInterval = () => setIntervalSec((s) => Math.min(60, s + 5));

  return (
    <View style={[styles.container, { backgroundColor: palette.bg }]}>
      <View style={styles.header} accessibilityRole="header">
        <Text allowFontScaling style={[styles.title, { color: palette.textPrimary, fontSize: fontSizes.xl }]}>
          {t('sync.title')}
        </Text>

        <View style={styles.actionsRow}>
          <PrimaryButton
            testID="sync-flush"
            disabled={busy}
            onPress={doFlush}
            label={busy ? t('sync.retrying') : t('sync.retryNow')}
          />
          <PrimaryButton
            testID="audit-log"
            onPress={() => navigation.navigate('AuditLog')}
            label={t('sync.viewAudit')}
          />
        </View>
      </View>
      {authMessage && (
        <Text allowFontScaling style={[styles.authWarning, { color: palette.stateError }]}>
          {authMessage}
        </Text>
      )}

      {/* Controles de Auto-retry */}
      <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <View style={styles.rowBetween}>
          <Text allowFontScaling style={[styles.cardTitle, { color: palette.textPrimary, fontSize: fontSizes.lg }]}>
            {t('sync.autoRetryTitle')}
          </Text>
          <Switch
            value={autoRetry}
            onValueChange={setAutoRetry}
            accessibilityLabel={t('sync.autoRetryAccessibilityLabel')}
            accessibilityHint={t('sync.autoRetryAccessibilityHint')}
          />
        </View>
        <View style={[styles.rowBetween, { marginTop: 10 }]}>
          <Text allowFontScaling style={{ color: palette.textSecondary }}>
            {t('sync.intervalLabel')}
          </Text>
          <View style={styles.intervalRow}>
            <Pressable
              onPress={decInterval}
              style={[styles.intervalBtn, { borderColor: palette.border }]}
              accessibilityRole="button"
              accessibilityLabel={t('sync.intervalDecreaseLabel')}
              accessibilityHint={t('sync.intervalDecreaseHint')}
            >
              <Text allowFontScaling style={{ color: palette.textPrimary }}>−</Text>
            </Pressable>
            <Text allowFontScaling style={{ color: palette.textPrimary, marginHorizontal: 8 }}>
              {t('sync.intervalValueLabel', { seconds: intervalSec })}
            </Text>
            <Pressable
              onPress={incInterval}
              style={[styles.intervalBtn, { borderColor: palette.border }]}
              accessibilityRole="button"
              accessibilityLabel={t('sync.intervalIncreaseLabel')}
              accessibilityHint={t('sync.intervalIncreaseHint')}
            >
              <Text allowFontScaling style={{ color: palette.textPrimary }}>＋</Text>
            </Pressable>
          </View>
        </View>
        {lastRun && (
          <Text allowFontScaling style={{ marginTop: 8, color: palette.textHint }}>
            {t('sync.lastRunLabel', { time: lastRun })}
          </Text>
        )}
      </View>

      {/* Lista FIFO */}
      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={palette.textSecondary}
            colors={[palette.accent]}
          />
        }
        renderItem={({ item }) => <ItemRow item={item} C={palette} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text allowFontScaling style={{ color: palette.textSecondary }}>{t('sync.emptyQueue')}</Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: 24 }}
      />
    </View>
  );
}

function ItemRow({ item, C }: { item: QueueItemMeta; C: Colors }) {
  const dt = new Date(item.createdAt);
  const when = isFinite(dt.getTime()) ? dt.toLocaleString() : String(item.createdAt);
  const short = (s: string | undefined, n = 16) => {
    if (!s) return '';
    return s.length > n ? `${s.slice(0, n)}…` : s;
  };

  const issues = React.useMemo(() => parseErrorIssuesJson(item.errorIssuesJson), [item.errorIssuesJson]);

  const isError = item.syncStatus === 'error';
  const { subtitle, title, message } = resolveErrorCopy(item.errorStatus);
  const statusLabel = isError
    ? subtitle
    : t(`sync.status.${item.syncStatus ?? 'pending'}`);

  const rowStyle = [
    styles.row,
    { backgroundColor: C.card, borderColor: C.border },
    isError && { borderColor: C.stateError },
  ];

  const showErrorAlert = React.useCallback(() => {
    if (!isError) return;
    const issuesText = buildIssuesText(issues);

    const buttons: Array<{ text: string; onPress?: () => void; style?: 'cancel' }> = [];

    if (issuesText) {
      buttons.push({
        text: t('sync.viewDetails'),
        onPress: () => Alert.alert(t('sync.errorDetailsTitle'), issuesText),
      });
    }

    buttons.push({ text: t('common.close'), style: 'cancel' });

    Alert.alert(
      title,
      item.errorStatus && item.errorStatus >= 400 && item.errorStatus < 500
        ? t('sync.syncErrorStatusMessage', { status: item.errorStatus })
        : item.errorMessage || message,
      buttons,
    );
  }, [isError, item.errorMessage, item.errorStatus, issues, message, title]);

  const RowWrapper = isError ? Pressable : View;

  return (
    <RowWrapper
      testID={`sync-item-${item.id}`}
      onPress={isError ? showErrorAlert : undefined}
      style={isError ? ({ pressed }: { pressed?: boolean }) => [...rowStyle, pressed && { opacity: 0.95 }] : rowStyle}
    >
      <View style={{ flex: 1 }}>
        <View style={styles.rowBetween}>
          <Text allowFontScaling style={[styles.id, { color: C.textPrimary }]}>#{short(item.id, 12)}</Text>
          {isError && (
            <View style={[styles.errorBadge, { backgroundColor: `${C.stateError}22`, borderColor: C.stateError }]}>
              <Text allowFontScaling style={[styles.errorBadgeText, { color: C.stateError }]}>
                {t('common.error')}
              </Text>
            </View>
          )}
        </View>
        <Text allowFontScaling style={[styles.sub, { color: C.textSecondary }]}>
          {t('sync.dateLabel', { date: when })}
        </Text>
        <Text allowFontScaling style={[styles.sub, { color: C.textSecondary }]}>
          {t('sync.attemptsLabel', { count: item.attempts })}
        </Text>
        {isError && (
          <>
            <Text allowFontScaling style={[styles.sub, { color: C.stateError, marginTop: 4 }]} numberOfLines={2}>
              {subtitle}
            </Text>
            <Pressable onPress={showErrorAlert} style={({ pressed }) => pressed && { opacity: 0.85 }}>
              <Text allowFontScaling style={[styles.errorAction, { color: C.stateError }]}>
                {t('sync.viewError')}
              </Text>
            </Pressable>
          </>
        )}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text allowFontScaling style={[styles.hash, { color: C.textHint }]}>{t('sync.hashLabel')}</Text>
        <Text allowFontScaling style={[styles.hashVal, { color: C.textPrimary }]}>
          {short(item.hash, 24) || t('common.notAvailable')}
        </Text>
        <Text
          style={[styles.state, { color: isError ? C.stateError : C.statePending }]}
          numberOfLines={2}
          allowFontScaling
        >
          {statusLabel}
        </Text>
      </View>
    </RowWrapper>
  );
}

/* ===== THEME ===== */
type Colors = {
  bg: string;
  textPrimary: string;
  textSecondary: string;
  textHint: string;
  card: string;
  border: string;
  accent: string;
  btn: string;
  btnDisabled: string;
  btnText: string;
  statePending: string;
  stateError: string;
};

/* ===== STYLES ===== */
const styles = StyleSheet.create({
  container: { flex: 1, padding: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { fontSize: 20, fontWeight: '700' },
  actionsRow: { flexDirection: 'row', gap: 8 },
  btn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  btnText: { fontWeight: '600' },

  card: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 16, fontWeight: '700' },

  intervalRow: { flexDirection: 'row', alignItems: 'center' },
  intervalBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1 },

  row: {
    paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, marginBottom: 8,
    flexDirection: 'row', gap: 8,
  },
  id: { fontWeight: '700' },
  errorBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  errorBadgeText: { fontSize: 12, fontWeight: '700' },
  sub: { marginTop: 2 },
  errorAction: { marginTop: 6, fontWeight: '700' },
  hash: { fontSize: 12 },
  hashVal: { fontFamily: 'monospace', fontSize: 12 },
  state: { marginTop: 4, fontWeight: '700', fontSize: 12 },
  empty: { padding: 24, alignItems: 'center' },
  authWarning: { marginBottom: 8, fontWeight: '600' },
});
