import React from 'react';
import {
  View,
  Text,
  FlatList,
  RefreshControl,
  StyleSheet,
  useColorScheme,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { apiGet } from '@/src/lib/api';
import { useThemeTokens } from '@/src/theme';

const ACTION_LABELS: Record<string, string> = {
  patient_open: 'Apertura de paciente',
  patient_edit: 'Edición de paciente',
  handover_signed: 'Cierre legal de entrega',
};

type AuditLogItem = {
  id: number | string;
  type: string;
  at: string;
  userId: string;
  patientKey?: string | null;
  unitId?: string | null;
  shiftCode?: string | null;
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('es-ES');
}

function resolveActionLabel(type: string) {
  return ACTION_LABELS[type] ?? 'Acción desconocida';
}

export default function AuditLogScreen() {
  const scheme = useColorScheme();
  const { colors } = useThemeTokens();
  const palette = {
    bg: colors.background,
    textPrimary: colors.text,
    textSecondary: colors.muted,
    border: colors.border,
    card: colors.surface,
  };

  const isFocused = useIsFocused();
  const [logs, setLogs] = React.useState<AuditLogItem[]>([]);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const data = await apiGet('/api/audit/');
      setLogs(Array.isArray(data) ? data : []);
    } catch {
      setError('No se pudieron cargar los registros de auditoría.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    if (isFocused) {
      void refresh();
    }
  }, [isFocused, refresh]);

  const backgroundColor = scheme === 'dark' ? '#121212' : palette.bg;

  return (
    <View style={[styles.container, { backgroundColor }]}> 
      <Text style={[styles.title, { color: palette.textPrimary }]}>Registros de auditoría</Text>
      <Text style={[styles.subtitle, { color: palette.textSecondary }]}>
        Solo seudónimos estables; nunca nombres ni IDs clínicos.
      </Text>
      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
      <FlatList
        data={logs}
        keyExtractor={(item) => String(item.id)}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={palette.textSecondary}
            colors={[colors.info]}
          />
        }
        ListHeaderComponent={
          <View style={[styles.headerRow, { borderColor: palette.border }]}> 
            <Text style={[styles.headerCell, { color: palette.textSecondary }]}>Fecha</Text>
            <Text style={[styles.headerCell, { color: palette.textSecondary }]}>Usuario</Text>
            <Text style={[styles.headerCell, { color: palette.textSecondary }]}>Paciente</Text>
            <Text style={[styles.headerCell, { color: palette.textSecondary }]}>Acción</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.row, { borderColor: palette.border, backgroundColor: palette.card }]}> 
            <Text style={[styles.cell, { color: palette.textPrimary }]} numberOfLines={2}>
              {formatDate(item.at)}
            </Text>
            <Text style={[styles.cell, { color: palette.textPrimary }]} numberOfLines={1}>
              {item.userId}
            </Text>
            <Text style={[styles.cell, { color: palette.textPrimary }]} numberOfLines={1}>
              {item.patientKey ?? '—'}
            </Text>
            <Text style={[styles.cell, { color: palette.textPrimary }]} numberOfLines={2}>
              {resolveActionLabel(item.type)}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={{ color: palette.textSecondary }}>No hay eventos registrados.</Text>
          </View>
        }
        contentContainerStyle={{ paddingBottom: 24 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    marginTop: 4,
    marginBottom: 12,
  },
  error: {
    marginBottom: 8,
    fontWeight: '600',
  },
  headerRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    paddingBottom: 8,
    marginBottom: 8,
  },
  headerCell: {
    flex: 1,
    fontWeight: '700',
    fontSize: 12,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginBottom: 8,
    gap: 6,
  },
  cell: {
    flex: 1,
    fontSize: 12,
  },
  emptyState: {
    paddingVertical: 24,
    alignItems: 'center',
  },
});
