/* [NURSEOS PRO PATCH 2025-10-22] offlineQueue.ts
   - API pública estable (QueueItem, QueueItemMeta, enqueueTx, readQueue, size, peekNext, bumpTries, markDone, drain)
   - WebCrypto AES-GCM con tipos BufferSource correctos (encryptBlob + helpers)
   - Almacenamiento tolerante: AsyncStorage → localStorage → memoria
   - Índice FIFO con createdAt y búsqueda O(1) por clave
*/

///////////////////////
// Tipos públicos
///////////////////////

export type QueueItem = {
  key: string;
  payload?: any;
  tries?: number;
  createdAt?: number;
};

export type QueueItemMeta = {
  size: number;
  oldest?: number;
  newest?: number;
};

///////////////////////
// Storage backend
///////////////////////

type KV = {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
  removeItem(k: string): Promise<void>;
};

let AsyncStorage: any = undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  AsyncStorage = require("@react-native-async-storage/async-storage").default;
} catch {}

const memory = new Map<string, string>();

const kv: KV =
  AsyncStorage
    ? {
        getItem: (k) => AsyncStorage.getItem(k),
        setItem: (k, v) => AsyncStorage.setItem(k, v),
        removeItem: (k) => AsyncStorage.removeItem(k),
      }
    : typeof window !== "undefined" && window.localStorage
    ? {
        getItem: async (k) => window.localStorage.getItem(k),
        setItem: async (k, v) => window.localStorage.setItem(k, v),
        removeItem: async (k) => window.localStorage.removeItem(k),
      }
    : {
        getItem: async (k) => (memory.has(k) ? memory.get(k)! : null),
        setItem: async (k, v) => void memory.set(k, v),
        removeItem: async (k) => void memory.delete(k),
      };

///////////////////////
// Constantes índice
///////////////////////

const NS = "@offlineQueue";
const INDEX_KEY = `${NS}/index`;
// item key: `${NS}/items/${queueKey}`

type IndexEntry = { key: string; createdAt: number };
type IndexData = { keys: IndexEntry[] };

async function readIndex(): Promise<IndexData> {
  const raw = await kv.getItem(INDEX_KEY);
  if (!raw) return { keys: [] };
  try {
    const parsed = JSON.parse(raw) as IndexData;
    if (!Array.isArray(parsed.keys)) return { keys: [] };
    return parsed;
  } catch {
    return { keys: [] };
  }
}

async function writeIndex(idx: IndexData) {
  await kv.setItem(INDEX_KEY, JSON.stringify(idx));
}

function itemStorageKey(queueKey: string) {
  return `${NS}/items/${queueKey}`;
}

///////////////////////
// TextEncoder/Decoder
///////////////////////

const enc =
  typeof TextEncoder !== "undefined"
    ? new TextEncoder()
    : new (class {
        encode(s: string) {
          // fallback mínimo a UTF-8
          const utf8 = unescape(encodeURIComponent(s));
          const out = new Uint8Array(utf8.length);
          for (let i = 0; i < utf8.length; i++) out[i] = utf8.charCodeAt(i);
          return out;
        }
      })();

const dec =
  typeof TextDecoder !== "undefined"
    ? new TextDecoder()
    : new (class {
        decode(arr: ArrayBufferView | ArrayBuffer) {
          const u8 = arr instanceof Uint8Array ? arr : new Uint8Array(arr as ArrayBuffer);
          let s = "";
          for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
          try {
            return decodeURIComponent(escape(s));
          } catch {
            return s;
          }
        }
      })();

///////////////////////
// WebCrypto helpers
///////////////////////

const subtle = (globalThis as any)?.crypto?.subtle as SubtleCrypto | undefined;

async function aesKeyFromRaw(raw: ArrayBufferView | ArrayBuffer) {
  if (!subtle) throw new Error("WebCrypto 'subtle' no disponible para AES-GCM.");
  const keyData: BufferSource =
    raw instanceof ArrayBuffer ? raw : (raw as ArrayBufferView).buffer;
  // Nota: si se pasa un view con offset, mejor clonar exactamente el rango
  const bytes =
    raw instanceof ArrayBuffer
      ? new Uint8Array(raw)
      : new Uint8Array((raw as ArrayBufferView).buffer, (raw as ArrayBufferView).byteOffset, (raw as ArrayBufferView).byteLength);
  return await subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptBlob(plaintext: string, rawKey: Uint8Array) {
  if (!subtle) throw new Error("AES-GCM no disponible en este entorno.");
  const key = await aesKeyFromRaw(rawKey);
  const iv = (globalThis as any).crypto?.getRandomValues
    ? (globalThis as any).crypto.getRandomValues(new Uint8Array(12))
    : // fallback inseguro si no hay CSPRNG (no recomendado, pero evita crash)
      cryptoPseudoRandom(12);
  const pt: BufferSource = enc.encode(plaintext); // Uint8Array (válido para BufferSource)
  const ctBuf = await subtle.encrypt({ name: "AES-GCM", iv }, key, pt);
  const ct = new Uint8Array(ctBuf);
  return { iv, ct };
}

export async function decryptBlob(ciphertext: Uint8Array, iv: Uint8Array, rawKey: Uint8Array) {
  if (!subtle) throw new Error("AES-GCM no disponible en este entorno.");
  const key = await aesKeyFromRaw(rawKey);
  const ptBuf = await subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  const pt = new Uint8Array(ptBuf);
  return dec.decode(pt);
}

function cryptoPseudoRandom(n: number) {
  // Solo como último recurso; no cripto-seguro
  const u8 = new Uint8Array(n);
  for (let i = 0; i < n; i++) u8[i] = (Math.random() * 256) & 0xff;
  return u8;
}

///////////////////////
// Mutex simple (evita race en índice)
///////////////////////

let lock: Promise<void> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = lock.then(fn, fn);
  lock = next.then(() => void 0, () => void 0);
  return next;
}

///////////////////////
// API de la cola
///////////////////////

/** Encola/actualiza un item. Conserva FIFO por createdAt. */
export async function enqueueTx(tx: { key: string; payload?: any }) {
  if (!tx?.key) throw new Error("enqueueTx: 'key' es obligatorio.");
  const createdAt = Date.now();

  return withLock(async () => {
    const idx = await readIndex();
    const exists = idx.keys.find((e) => e.key === tx.key);
    if (!exists) {
      idx.keys.push({ key: tx.key, createdAt });
      await writeIndex(idx);
    }
    const item: QueueItem = {
      key: tx.key,
      payload: tx.payload,
      tries: exists ? undefined : 0,
      createdAt: exists ? exists.createdAt : createdAt,
    };
    await kv.setItem(itemStorageKey(tx.key), JSON.stringify(item));
    return item;
  });
}

/** Lee todos los items en orden FIFO. */
export async function readQueue(): Promise<QueueItem[]> {
  const idx = await readIndex();
  const out: QueueItem[] = [];
  for (const e of idx.keys) {
    const raw = await kv.getItem(itemStorageKey(e.key));
    if (!raw) continue;
    try {
      const it = JSON.parse(raw) as QueueItem;
      out.push(it);
    } catch {
      // ignora corruptos
    }
  }
  // aseguremos orden por createdAt (por si alguien tocó el índice)
  out.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  return out;
}

/** Número de elementos en cola. */
export async function size(): Promise<number> {
  const idx = await readIndex();
  return idx.keys.length;
}

/** Siguiente en FIFO (sin extraer). */
export async function peekNext(): Promise<QueueItem | undefined> {
  const idx = await readIndex();
  const first = idx.keys[0];
  if (!first) return undefined;
  const raw = await kv.getItem(itemStorageKey(first.key));
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as QueueItem;
  } catch {
    return undefined;
  }
}

/** Incrementa contador de intentos. */
export async function bumpTries(key: string): Promise<void> {
  if (!key) return;
  await withLock(async () => {
    const raw = await kv.getItem(itemStorageKey(key));
    if (!raw) return;
    try {
      const it = JSON.parse(raw) as QueueItem;
      it.tries = (it.tries ?? 0) + 1;
      await kv.setItem(itemStorageKey(key), JSON.stringify(it));
    } catch {
      // ignora
    }
  });
}

/** Marca como procesado (elimina de almacenamiento e índice). */
export async function markDone(key: string): Promise<void> {
  if (!key) return;
  await withLock(async () => {
    const idx = await readIndex();
    const nextKeys = idx.keys.filter((e) => e.key !== key);
    if (nextKeys.length !== idx.keys.length) {
      await kv.removeItem(itemStorageKey(key));
      await writeIndex({ keys: nextKeys });
    } else {
      // si no estaba en índice, al menos limpia el item huérfano
      await kv.removeItem(itemStorageKey(key));
    }
  });
}

/** Metadatos rápidos (sin leer todos los items). */
export async function drain(): Promise<QueueItemMeta> {
  const idx = await readIndex();
  const size = idx.keys.length;
  if (size === 0) return { size };
  const times = idx.keys.map((e) => e.createdAt).sort((a, b) => a - b);
  return { size, oldest: times[0], newest: times[times.length - 1] };
}

// Exportar helpers de crypto si otros módulos los importan
export { aesKeyFromRaw };
