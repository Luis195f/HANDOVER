// FILE: src/screens/SyncCenter.tsx
import React from 'react';
import {
  View, Text, FlatList, RefreshControl,
  Pressable, StyleSheet, Alert, useColorScheme, Switch
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { listOfflineQueue } from '@/src/lib/queue';
import { flushQueueNow, type SyncOpts } from '@/src/lib/sync/index';

type QueueItemMeta = {
  id: string;
  createdAt: number | string;
  tries: number;
  hash?: string;
  syncStatus?: string;
  errorMessage?: string | null;
  errorStatus?: number | null;
  errorIssuesJson?: string | null;
};

function resolveSyncOpts(): SyncOpts | null {
  try {
    // ENV tolerante
    const env = require('@/src/config/env') as { ENV?: { FHIR_BASE?: string }; FHIR_BASE?: string };
    const base: string =
      env?.ENV?.FHIR_BASE ?? env?.FHIR_BASE ?? (process?.env?.EXPO_PUBLIC_FHIR_BASE as string) ?? '';
    if (!base) return null;
    // Auth tolerante
    const auth = require('@/src/services/AuthService') as {
      getToken?: SyncOpts['getToken'];
      default?: { getToken?: SyncOpts['getToken'] };
    };
    const getToken: SyncOpts['getToken'] =
      auth?.getToken ?? auth?.default?.getToken ?? (async () => null);
    return { fhirBaseUrl: base, getToken, backoff: { retries: 5, minMs: 500, maxMs: 15000 } };
  } catch {
    return null;
  }
}

export default function SyncCenter() {
  const scheme = useColorScheme();
  const C = scheme === 'dark' ? D_COLORS : L_COLORS;

  const isFocused = useIsFocused();
  const [items, setItems] = React.useState<QueueItemMeta[]>([]);
  const [refreshing, setRefreshing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  // Auto-retry
  const [autoRetry, setAutoRetry] = React.useState(true);
  const [intervalSec, setIntervalSec] = React.useState(10);
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const [lastRun, setLastRun] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      const queue = await listOfflineQueue();
      const meta: QueueItemMeta[] = queue.map((item) => ({
        id: item.id,
        createdAt: item.createdAt,
        tries: item.attempts ?? item.tries ?? 0,
        hash: item.hash,
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

  const doFlush = React.useCallback(async () => {
    const opts = resolveSyncOpts();
    if (!opts) {
      Alert.alert('Sync', 'Config FHIR_BASE o AuthService no disponible.');
      return { processed: 0, remaining: -1 };
    }
    setBusy(true);
    try {
      const res = await flushQueueNow(opts);
      await refresh();
      setLastRun(new Date().toLocaleTimeString());
      return res;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      Alert.alert('Sync', `Error al reintentar: ${message}`);
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
    <View style={[styles.container, { backgroundColor: C.bg }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: C.textPrimary }]}>Sync Center</Text>

        <View style={styles.actionsRow}>
          <Pressable
            disabled={busy}
            onPress={doFlush}
            style={({ pressed }) => [
              styles.btn, { backgroundColor: busy ? C.btnDisabled : C.btn },
              pressed && { opacity: 0.85 }
            ]}
          >
            <Text style={[styles.btnText, { color: C.btnText }]}>{busy ? 'Reintentando…' : 'Reintentar ahora'}</Text>
          </Pressable>
        </View>
      </View>

      {/* Controles de Auto-retry */}
      <View style={[styles.card, { backgroundColor: C.card, borderColor: C.border }]}>
        <View style={styles.rowBetween}>
          <Text style={[styles.cardTitle, { color: C.textPrimary }]}>Auto-retry</Text>
          <Switch value={autoRetry} onValueChange={setAutoRetry} />
        </View>
        <View style={[styles.rowBetween, { marginTop: 10 }]}>
          <Text style={{ color: C.textSecondary }}>Intervalo</Text>
          <View style={styles.intervalRow}>
            <Pressable
              onPress={decInterval}
              style={[styles.intervalBtn, { borderColor: C.border }]}
            >
              <Text style={{ color: C.textPrimary }}>−</Text>
            </Pressable>
            <Text style={{ color: C.textPrimary, marginHorizontal: 8 }}>{intervalSec}s</Text>
            <Pressable
              onPress={incInterval}
              style={[styles.intervalBtn, { borderColor: C.border }]}
            >
              <Text style={{ color: C.textPrimary }}>＋</Text>
            </Pressable>
          </View>
        </View>
        {lastRun && (
          <Text style={{ marginTop: 8, color: C.textHint }}>Última ejecución: {lastRun}</Text>
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
            tintColor={C.textSecondary}
            colors={[C.accent]}
          />
        }
        renderItem={({ item }) => <ItemRow item={item} C={C} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={{ color: C.textSecondary }}>No hay elementos en cola 🎉</Text>
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

  const parseIssues = React.useCallback(() => {
    if (!item.errorIssuesJson) return [] as Array<Record<string, unknown>>;
    try {
      const parsed = JSON.parse(item.errorIssuesJson);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [item.errorIssuesJson]);

  const isError = item.syncStatus === 'error';
  const isValidation422 = isError && item.errorStatus === 422;
  const statusLabel = isValidation422
    ? 'Error de validación FHIR (422)'
    : isError
    ? 'Error de sincronización'
    : (item.syncStatus ?? 'pending').toUpperCase();

  const rowStyle = [
    styles.row,
    { backgroundColor: C.card, borderColor: C.border },
    isError && { borderColor: C.stateError },
  ];

  const showErrorAlert = React.useCallback(() => {
    if (!isError) return;
    const issues = parseIssues();
    const issuesText = issues
      .map((issue) => {
        const diag = typeof issue?.diagnostics === 'string' ? issue.diagnostics : null;
        const expr = Array.isArray(issue?.expression)
          ? (issue.expression as unknown[])
              .filter((it) => typeof it === 'string')
              .join(', ')
          : typeof issue?.expression === 'string'
          ? issue.expression
          : null;
        if (diag && expr) return `• ${diag} (${expr})`;
        if (diag) return `• ${diag}`;
        if (expr) return `• ${expr}`;
        return null;
      })
      .filter(Boolean)
      .join('\n');

    const buttons: Array<{ text: string; onPress?: () => void; style?: 'cancel' }> = [];

    if (issuesText) {
      buttons.push({
        text: 'Ver detalle',
        onPress: () => Alert.alert('Detalle de error', issuesText),
      });
    }

    buttons.push({ text: 'Cerrar', style: 'cancel' });

    Alert.alert(
      'Error de validación FHIR',
      item.errorMessage || 'No se encontró mensaje de error.',
      buttons,
    );
  }, [isError, item.errorMessage, parseIssues]);

  const RowWrapper = isError ? Pressable : View;

  return (
    <RowWrapper
      onPress={isError ? showErrorAlert : undefined}
      style={isError ? ({ pressed }: { pressed?: boolean }) => [...rowStyle, pressed && { opacity: 0.95 }] : rowStyle}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.id, { color: C.textPrimary }]}>#{short(item.id, 12)}</Text>
        <Text style={[styles.sub, { color: C.textSecondary }]}>Fecha: {when}</Text>
        <Text style={[styles.sub, { color: C.textSecondary }]}>Tries: {item.tries}</Text>
        {isError && (
          <Text style={[styles.sub, { color: C.stateError, marginTop: 4 }]}>
            Toca para ver el error
          </Text>
        )}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[styles.hash, { color: C.textHint }]}>hash</Text>
        <Text style={[styles.hashVal, { color: C.textPrimary }]}>{short(item.hash, 24) || '—'}</Text>
        <Text
          style={[styles.state, { color: isError ? C.stateError : C.statePending }]}
          numberOfLines={2}
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

const L_COLORS: Colors = {
  bg: '#ffffff',
  textPrimary: '#111111',
  textSecondary: '#555555',
  textHint: '#777777',
  card: '#fafafa',
  border: '#e5e5e5',
  accent: '#2962FF',
  btn: '#2962FF',
  btnDisabled: '#90CAF9',
  btnText: '#ffffff',
  statePending: '#FF8F00',
  stateError: '#C62828',
};

const D_COLORS: Colors = {
  bg: '#121212',
  textPrimary: '#ECECEC',
  textSecondary: '#B3B3B3',
  textHint: '#9E9E9E',
  card: '#1E1E1E',
  border: '#333333',
  accent: '#82B1FF',
  btn: '#82B1FF',
  btnDisabled: '#4F6B9B',
  btnText: '#000000',
  statePending: '#FFB300',
  stateError: '#EF9A9A',
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
  sub: { marginTop: 2 },
  hash: { fontSize: 12 },
  hashVal: { fontFamily: 'monospace', fontSize: 12 },
  state: { marginTop: 4, fontWeight: '700', fontSize: 12 },
  empty: { padding: 24, alignItems: 'center' },
});
