// FILE: src/screens/SyncCenter.tsx
import React from 'react';
import {
  View, Text, FlatList, RefreshControl,
  Pressable, StyleSheet, Alert, useColorScheme, Switch
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { drain, type QueueItemMeta } from '@/src/lib/offlineQueue';
import { flushQueueNow } from '@/src/lib/sync';

type GetToken = () => Promise<string | null>;
type SyncOpts = {
  fhirBaseUrl: string;
  getToken: GetToken;
  backoff?: { retries?: number; minMs?: number; maxMs?: number }
};

function resolveSyncOpts(): SyncOpts | null {
  try {
    // ENV tolerante
    // @ts-ignore
    const env = require('@/src/config/env');
    const base: string =
      env?.ENV?.FHIR_BASE ?? env?.FHIR_BASE ?? (process?.env?.EXPO_PUBLIC_FHIR_BASE as string) ?? '';
    if (!base) return null;
    // Auth tolerante
    // @ts-ignore
    const auth = require('@/src/services/AuthService');
    const getToken: GetToken =
      (auth?.getToken as GetToken) ?? (auth?.default?.getToken as GetToken) ?? (async () => null);
    return { fhirBaseUrl: base, getToken, backoff: { retries: 5, minMs: 500, maxMs: 15000 } };
  } catch {
    return null;
  }
}

export default function SyncCenter() {
  const scheme = useColorScheme();
  const C = scheme === 'dark' ? D_COLORS : L_COLORS;

  const [items, setItems] = React.useState<QueueItemMeta[]>([]);
  const [refreshing, setRefreshing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  // Auto-retry
  const [autoRetry, setAutoRetry] = React.useState(true);
  const [intervalSec, setIntervalSec] = React.useState(10);
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const [lastRun, setLastRun] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setRefreshing(true);
    try {
      const idx = await drain();
      setItems(idx ?? []);
    } finally {
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const doFlush = React.useCallback(async () => {
    const opts = resolveSyncOpts();
    if (!opts) {
      Alert.alert('Sync', 'Config FHIR_BASE o AuthService no disponible.');
      return { processed: 0, remaining: -1 };
    }
    setBusy(true);
    try {
      const res = await flushQueueNow(opts);
      await load();
      setLastRun(new Date().toLocaleTimeString());
      return res;
    } catch (e: any) {
      Alert.alert('Sync', `Error al reintentar: ${e?.message ?? e}`);
      return { processed: 0, remaining: -1 };
    } finally {
      setBusy(false);
    }
  }, [load]);

  // Inicia/detiene interval cuando la pantalla está enfocada
  useFocusEffect(
    React.useCallback(() => {
      if (autoRetry) {
        intervalRef.current = setInterval(() => {
          // flush coalescente en sync/index.ts; es seguro llamarlo seguido
          void doFlush();
        }, Math.max(5, Math.min(60, intervalSec)) * 1000);
      }
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = null;
      };
    }, [autoRetry, intervalSec, doFlush])
  );

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
            onRefresh={load}
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
  const short = (s: string, n = 16) => (s?.length > n ? s.slice(0, n) + '…' : s);
  return (
    <View style={[styles.row, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.id, { color: C.textPrimary }]}>#{short(item.id, 12)}</Text>
        <Text style={[styles.sub, { color: C.textSecondary }]}>Fecha: {when}</Text>
        <Text style={[styles.sub, { color: C.textSecondary }]}>Tries: {item.tries}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[styles.hash, { color: C.textHint }]}>hash</Text>
        <Text style={[styles.hashVal, { color: C.textPrimary }]}>{short(item.hash, 24)}</Text>
        <Text style={[styles.state, { color: C.statePending }]}>PENDING</Text>
      </View>
    </View>
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
