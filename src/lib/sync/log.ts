// FILE: src/lib/sync/log.ts
// -----------------------------------------------------------------------------
// Log de sincronización compatible con expo-sqlite moderna y legacy.
// - si db.withTransactionAsync existe → usa API async (v11+)
// - si no → fallback a transaction/executeSql (WebSQL-style)
// -----------------------------------------------------------------------------

export const TABLE = "sync_log";

export type LogRow = { ts: number; msg: string };

// Tipos suaves para no acoplarse a versiones concretas de expo-sqlite
type SQLiteResultLegacy = { rows?: { length: number; _array?: any[]; item?: (i: number) => any } };
type DBCompat = {
  // Nueva API
  withTransactionAsync?: (fn: () => Promise<void>) => Promise<void>;
  runAsync?: (sql: string, params?: any[]) => Promise<any>;
  getAllAsync?: (sql: string, params?: any[]) => Promise<any[]>;
  // Clásica
  transaction?: (
    fn: (tx: { executeSql: (sql: string, params?: any[], s?: (tx: any, res: SQLiteResultLegacy) => void, e?: (tx: any, err: any) => void) => void }) => void,
    error?: (err: any) => void,
    success?: () => void
  ) => void;
};

// -----------------------------------------------------------------------------
// API pública mínima (requerida por tus módulos)
// -----------------------------------------------------------------------------

/**
 * Añade una fila de log de forma transaccional.
 * - En DBs modernas: withTransactionAsync + runAsync
 * - En legacy: transaction + executeSql
 */
export async function appendLog(db: DBCompat, row: LogRow) {
  if (!db) throw new Error("appendLog: db no definido");

  // Nueva API (expo-sqlite async)
  if (typeof db.withTransactionAsync === "function" && typeof db.runAsync === "function") {
    const runAsync = db.runAsync.bind(db);
    await db.withTransactionAsync(async () => {
      await runAsync(`CREATE TABLE IF NOT EXISTS ${TABLE} (ts INTEGER, msg TEXT)`);
      await runAsync(`INSERT INTO ${TABLE} (ts, msg) VALUES (?, ?)`, [row.ts, row.msg]);
    });
    return;
  }

  // Fallback legacy
  await new Promise<void>((resolve, reject) => {
    db.transaction?.(
      (tx) => {
        tx.executeSql?.(
          `CREATE TABLE IF NOT EXISTS ${TABLE} (ts INTEGER, msg TEXT)`,
          []
        );
        tx.executeSql?.(
          `INSERT INTO ${TABLE} (ts, msg) VALUES (?, ?)`,
          [row.ts, row.msg],
          () => resolve(),
          (_tx, err) => {
            reject(err);
            return true;
          }
        );
      },
      (err) => reject(err),
      () => resolve()
    );
  });
}

// -----------------------------------------------------------------------------
// Utilidades opcionales (no intrusivas) para depuración/operación
// -----------------------------------------------------------------------------

/** Crea la tabla si no existe. Seguro de llamar múltiples veces. */
export async function ensureSchema(db: DBCompat) {
  if (!db) throw new Error("ensureSchema: db no definido");
  if (typeof db.runAsync === "function") {
    const runAsync = db.runAsync.bind(db);
    await runAsync(`CREATE TABLE IF NOT EXISTS ${TABLE} (ts INTEGER, msg TEXT)`);
    // índice opcional para consultas por fecha
    await runAsync(`CREATE INDEX IF NOT EXISTS idx_${TABLE}_ts ON ${TABLE}(ts)`);
    return;
  }
  // Legacy
  await new Promise<void>((resolve, reject) => {
    db.transaction?.(
      (tx) => {
        tx.executeSql?.(`CREATE TABLE IF NOT EXISTS ${TABLE} (ts INTEGER, msg TEXT)`);
        tx.executeSql?.(`CREATE INDEX IF NOT EXISTS idx_${TABLE}_ts ON ${TABLE}(ts)`);
      },
      (err) => reject(err),
      () => resolve()
    );
  });
}

/** Lee logs recientes (descendente). */
export async function getLogs(
  db: DBCompat,
  opts: { limit?: number; sinceTs?: number; untilTs?: number } = {}
): Promise<LogRow[]> {
  const limit = Math.max(1, Math.min(10_000, opts.limit ?? 200));
  const has = (x: unknown) => typeof x !== "undefined" && x !== null;

  const clauses: string[] = [];
  const params: any[] = [];
  if (has(opts.sinceTs)) { clauses.push("ts >= ?"); params.push(opts.sinceTs); }
  if (has(opts.untilTs)) { clauses.push("ts <= ?"); params.push(opts.untilTs); }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const sql = `SELECT ts, msg FROM ${TABLE} ${where} ORDER BY ts DESC LIMIT ${limit}`;

  // Nueva API con sugar
  if (typeof db.getAllAsync === "function") {
    try {
      await ensureSchema(db);
      const rows = await db.getAllAsync(sql, params);
      return rows as LogRow[];
    } catch {
      // cae a otros caminos si falla
    }
  }

  // Nueva API básica (runAsync)
  if (typeof db.runAsync === "function") {
    await ensureSchema(db);
    const runAsync = db.runAsync.bind(db);
    const res = await runAsync(sql, params);
    const rows: LogRow[] =
      res?.rows?._array ??
      res?.rowsArray ??
      res?.rows ??
      [];
    return rows as LogRow[];
  }

  // Legacy API
  await ensureSchema(db);
  return new Promise<LogRow[]>((resolve, reject) => {
    db.transaction?.(
      (tx) => {
        tx.executeSql?.(
          sql,
          params,
          (_t, result) => {
            const items =
              (result?.rows?._array as any[]) ??
              Array.from({ length: result?.rows?.length ?? 0 }, (_, i) => result?.rows?.item?.(i));
            resolve((items ?? []).filter(Boolean) as LogRow[]);
          },
          (_t, err) => {
            reject(err);
            return true;
          }
        );
      },
      (err) => reject(err)
    );
  });
}

/** Borra todos los logs. */
export async function clearLogs(db: DBCompat) {
  if (!db) throw new Error("clearLogs: db no definido");
  if (typeof db.runAsync === "function") {
    const runAsync = db.runAsync.bind(db);
    await runAsync(`DELETE FROM ${TABLE}`);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    db.transaction?.(
      (tx) => tx.executeSql?.(`DELETE FROM ${TABLE}`, [], () => {}, (_t, err) => { reject(err); return true; }),
      (err) => reject(err),
      () => resolve()
    );
  });
}

/** Devuelve el número de filas en la tabla. */
export async function countLogs(db: DBCompat): Promise<number> {
  if (!db) throw new Error("countLogs: db no definido");
  const sql = `SELECT COUNT(*) AS n FROM ${TABLE}`;

  if (typeof db.runAsync === "function") {
    await ensureSchema(db);
    const runAsync = db.runAsync.bind(db);
    const res = await runAsync(sql);
    const row = res?.rows?._array?.[0] ?? res?.rowsArray?.[0] ?? res?.rows?.[0];
    return Number(row?.n ?? 0);
  }

  // Legacy
  await ensureSchema(db);
  return new Promise<number>((resolve, reject) => {
    db.transaction?.(
      (tx) => {
        tx.executeSql?.(
          sql,
          [],
          (_t, result) => {
            const row =
              result?.rows?._array?.[0] ??
              (result?.rows?.length ? result?.rows?.item?.(0) : undefined);
            resolve(Number(row?.n ?? 0));
          },
          (_t, err) => {
            reject(err);
            return true;
          }
        );
      },
      (err) => reject(err)
    );
  });
}

/**
 * Mantiene el log por debajo de `maxRows`.
 * Estrategia: calcula umbral por OFFSET y borra todo lo anterior.
 */
export async function pruneLogs(db: DBCompat, maxRows = 5000) {
  const n = await countLogs(db);
  if (n <= maxRows) return;

  // Nueva API
  if (typeof db.withTransactionAsync === "function" && typeof db.runAsync === "function") {
    const runAsync = db.runAsync.bind(db);
    await db.withTransactionAsync(async () => {
      const thr = await thresholdTs(db, maxRows);
      if (thr !== null) {
        await runAsync(`DELETE FROM ${TABLE} WHERE ts < ?`, [thr]);
      }
    });
    return;
  }

  // Legacy
  await new Promise<void>((resolve, reject) => {
    db.transaction?.(
      (tx) => {
        // umbral por OFFSET
        tx.executeSql?.(
          `SELECT ts FROM ${TABLE} ORDER BY ts DESC LIMIT 1 OFFSET ?`,
          [maxRows - 1],
          (_t, r1) => {
            const row =
              r1?.rows?._array?.[0] ??
              (r1?.rows?.length ? r1?.rows?.item?.(0) : undefined);
            const thr = typeof row?.ts === "number" ? row.ts : null;
            if (thr === null) return;
            tx.executeSql?.(
              `DELETE FROM ${TABLE} WHERE ts < ?`,
              [thr]
            );
          }
        );
      },
      (err) => reject(err),
      () => resolve()
    );
  });
}

// -----------------------------------------------------------------------------
// Helpers internos
// -----------------------------------------------------------------------------

async function thresholdTs(db: DBCompat, keep: number): Promise<number | null> {
  if (typeof db.runAsync === "function") {
    const runAsync = db.runAsync.bind(db);
    const res = await runAsync(
      `SELECT ts FROM ${TABLE} ORDER BY ts DESC LIMIT 1 OFFSET ?`,
      [Math.max(0, keep - 1)]
    );
    const row = res?.rows?._array?.[0] ?? res?.rowsArray?.[0] ?? res?.rows?.[0];
    return typeof row?.ts === "number" ? row.ts : null;
  }
  // Legacy: se resuelve dentro de la transacción del caller
  return null;
}
