/**
 * Multimedia (PRO): utilidades para audio.
 * - 100% compatible con el stub previo (mismo contrato).
 * - Por defecto: stub (no sube nada). Devuelve URL http(s) tal cual o CDN simulada.
 * - Opcional: subida real si pasas `directUploadUrl` en UploadOptions.
 */

export type UploadResult = {
  url: string;   // URL pública o simulada
  mime: string;  // audio/* detectado
  name?: string;
  size?: number;
};

export type UploadOptions = {
  /** Si lo defines, intentará POST multipart a este endpoint */
  directUploadUrl?: string;
  /** Cabeceras extra para el POST (auth, etc.) */
  headers?: Record<string, string>;
  /** Nombre de campo en el form-data (por defecto "file") */
  fieldName?: string;
  /** Forzar nombre de archivo (si no, se infiere) */
  fileName?: string;
  /** Forzar MIME (si no, se detecta) */
  mime?: string;
  /** Campos extra a incluir en el form-data */
  extraFields?: Record<string, string | number | boolean>;
  /** Para tests o entornos controlados */
  fetchImpl?: typeof fetch;
};

/* =========================
 * Detección de tipos/extensiones
 * ========================= */

export function detectMimeFromUri(uri: string): string {
  const first = (uri ?? '').split("?")[0] ?? '';
  const clean = first.split("#")[0] ?? '';
  const ext = (clean.split(".").pop() ?? '').toLowerCase();
  switch (ext) {
    case "m4a":
    case "mp4": return "audio/mp4";
    case "mp3": return "audio/mpeg";
    case "wav": return "audio/wav";
    case "aac": return "audio/aac";
    case "ogg":
    case "oga": return "audio/ogg";
    case "opus": return "audio/opus";
    case "flac": return "audio/flac";
    case "amr": return "audio/amr";
    case "3gp":
    case "3gpp": return "audio/3gpp";
    default: return "application/octet-stream";
  }
}

function detectExtFromMime(mime: string): string {
  switch (mime) {
    case "audio/mp4": return "m4a";
    case "audio/mpeg": return "mp3";
    case "audio/wav": return "wav";
    case "audio/aac": return "aac";
    case "audio/ogg": return "ogg";
    case "audio/opus": return "opus";
    case "audio/flac": return "flac";
    case "audio/amr": return "amr";
    case "audio/3gpp": return "3gp";
    default: return "bin";
  }
}

function basename(path: string): string {
  const first = (path ?? '').split("?")[0] ?? '';
  const clean = first.split("#")[0] ?? '';
  const name = clean.substring(clean.lastIndexOf("/") + 1) || clean;
  return sanitizeFileName(name || "audio");
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^\w\-.]+/g, "_").slice(0, 100);
}

function isHttpUrl(u: string): boolean {
  return /^https?:\/\//i.test(u);
}

function isDataUri(u: string): boolean {
  return /^data:audio\/[a-z0-9.+-]+;base64,/i.test(u);
}

/* =========================
 * Tamaño de archivo (opcional con Expo)
 * ========================= */

async function tryGetFileSize(uri: string): Promise<number | undefined> {
  try {
    // Carga perezosa: sólo si existe 'expo-file-system'
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const FS = require("expo-file-system") as typeof import("expo-file-system");
    const info = await FS.getInfoAsync(uri);
    if (info?.exists && typeof info.size === "number") return info.size;
  } catch {
    /* librería no instalada o no disponible: ignora */
  }
  return undefined;
}

/* =========================
 * Subida real opcional (multipart/form-data)
 * ========================= */

async function uploadMultipart(
  uri: string,
  { directUploadUrl, headers, fieldName, fileName, mime, extraFields, fetchImpl }: UploadOptions,
  detectedMime: string
): Promise<UploadResult> {
  if (!directUploadUrl) {
    // Sin endpoint → no subimos, devolvemos stub
    return stubResult(uri, detectedMime);
  }

  const f = fetchImpl ?? fetch;
  const name = fileName || withExtension(basename(uri), mime ?? detectedMime);
  const type = mime ?? detectedMime;

  // En React Native/Expo, FormData acepta { uri, name, type }
  const form = new FormData();
  Object.entries(extraFields ?? {}).forEach(([k, v]) => form.append(k, String(v)));
  // Si es data URI, algunos backends no lo aceptan como uri. Intentamos pasarlo tal cual.
  form.append(fieldName || "file", { uri, name, type } as any);

  const res = await f(directUploadUrl, {
    method: "POST",
    headers: {
      ...(headers ?? {}),
      // No pongas Content-Type manualmente: RN lo define con el boundary correcto
    } as any,
    body: form as any,
  });

  // Éxito convencional: 200–299
  if (res.ok) {
    // Intenta leer JSON con URL si el backend lo devuelve
    try {
      const data = await res.json();
      const url: string | undefined = data?.url || data?.location || data?.publicUrl;
      const size = await tryGetFileSize(uri);
      return { url: url ?? (isHttpUrl(uri) ? uri : `https://example.invalid/media/${encodeURIComponent(name)}`), mime: type, name, size };
    } catch {
      const size = await tryGetFileSize(uri);
      return { url: isHttpUrl(uri) ? uri : `https://example.invalid/media/${encodeURIComponent(name)}`, mime: type, name, size };
    }
  }

  // Si falla, no rompas flujo: vuelve al stub
  return stubResult(uri, type);
}

function withExtension(name: string, mime: string): string {
  if (name.includes(".")) return name;
  return `${name}.${detectExtFromMime(mime)}`;
}

function stubResult(uri: string, mime: string): UploadResult {
  const name = basename(uri);
  if (isHttpUrl(uri)) {
    return { url: uri, mime, name };
  }
  const fakeCdn = "https://example.invalid/media";
  return { url: `${fakeCdn}/${encodeURIComponent(name)}`, mime, name };
}

/* =========================
 * API principal (compatible)
 * ========================= */

/**
 * Sube un audio o devuelve una URL simulada.
 * - Si `opts.directUploadUrl` existe → intenta POST multipart.
 * - Si `uri` es http(s) → la devuelve tal cual (no re-sube).
 * - Si `uri` es file:// u otra → devuelve CDN simulada salvo que se suba.
 */
export async function uploadAudio(uri: string, opts: UploadOptions = {}): Promise<UploadResult> {
  const detectedMime = opts.mime ?? detectMimeFromUri(uri);

  // Caso simple: ya es http(s) y no pediste subir → devolver tal cual
  if (isHttpUrl(uri) && !opts.directUploadUrl) {
    const size = await tryGetFileSize(uri);
    return { url: uri, mime: detectedMime, name: basename(uri), size };
  }

  // Data URI: muchos backends no aceptan RN {uri: data:...}. Si no hay uploadUrl, stub.
  if (isDataUri(uri) && !opts.directUploadUrl) {
    return stubResult(uri, detectedMime);
  }

  // Subida real si se configuró
  if (opts.directUploadUrl) {
    try {
      return await uploadMultipart(uri, opts, detectedMime);
    } catch {
      // Si algo falla, no detengas el flujo de la app
      return stubResult(uri, detectedMime);
    }
  }

  // Stub por defecto
  const size = await tryGetFileSize(uri);
  const res = stubResult(uri, detectedMime);
  return { ...res, size };
}

/* =========================
 * Utilidades extra (opcionales)
 * ========================= */

/** ¿Es un MIME de audio soportado por nuestro mapeo? */
export function isSupportedAudioMime(mime: string): boolean {
  return /^audio\//i.test(mime) && detectExtFromMime(mime) !== "bin";
}

/** Normaliza nombre a <base>.<ext> según MIME cuando falta extensión */
export function ensureFileName(name: string, mime: string): string {
  return withExtension(sanitizeFileName(name || "audio"), mime);
}

export function fileExtFromUri(uri?: string): string {
  const first = (uri ?? '').split("?")[0] ?? '';
  const clean = first.split("#")[0] ?? '';
  if (!clean) return "";
  const ext = (clean.split(".").pop() ?? "").toLowerCase();
  return ext;
}

export function fileNameFromPath(path?: string): string {
  const first = (path ?? '').split("?")[0] ?? '';
  const clean = first.split("#")[0] ?? '';
  if (!clean) return "";
  const idx = clean.lastIndexOf("/");
  return idx >= 0 ? clean.substring(idx + 1) : clean;
}
