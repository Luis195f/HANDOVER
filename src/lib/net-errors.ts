// src/lib/net-errors.ts

export type NetErrorKind = 'HTTP' | 'TIMEOUT' | 'OFFLINE' | 'ABORT' | 'UNKNOWN';

export type NetError = {
  kind: NetErrorKind;
  status?: number;
  url?: string;
  retryAfterMs?: number;
  details?: string;
  cause?: unknown;
};

type UserFacingNetworkMessageContext = {
  screen?: string;
  op?: string;
  httpStatus?: number;
  retryable?: boolean;
  log?: boolean;
};

const warn = (_code: string, _ctx: Record<string, unknown>) => {};

const buildWarnContext = (err: NetError, ctx?: UserFacingNetworkMessageContext) => {
  const payload: Record<string, unknown> = {};
  if (ctx?.screen) payload.screen = ctx.screen;
  if (ctx?.op) payload.op = ctx.op;
  const status = ctx?.httpStatus ?? err.status;
  if (typeof status === 'number') payload.httpStatus = status;
  if (typeof ctx?.retryable === 'boolean') payload.retryable = ctx.retryable;
  return payload;
};

const maybeWarn = (code: string, err: NetError, ctx?: UserFacingNetworkMessageContext) => {
  if (ctx?.log === false) return;
  warn(code, buildWarnContext(err, ctx));
};

const isAbortError = (error: unknown) => {
  const abortName = (error as { name?: string } | undefined)?.name;
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return error.name === 'AbortError';
  }
  return abortName === 'AbortError';
};

const isHTTPErrorLike = (
  error: unknown,
): error is { name?: string; status?: number; response?: Response; message?: string } => {
  if (!error || typeof error !== 'object') return false;
  const maybe = error as { name?: string; status?: number; response?: Response; message?: string };
  const hasHttpName = maybe.name === 'HTTPError';
  const hasStatus = typeof maybe.status === 'number';
  const hasResponse = maybe.response instanceof Response;
  return hasHttpName || hasStatus || hasResponse;
};

const isTimeoutErrorLike = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const maybe = error as { name?: string; code?: string };
  return maybe.name === 'TimeoutError' || maybe.code === 'TIMEOUT';
};

const parseRetryAfterMs = (response?: Response) => {
  const retryAfterHeader = response?.headers.get('Retry-After');
  if (!retryAfterHeader) return undefined;
  const retryAfterSeconds = Number.parseFloat(retryAfterHeader);
  if (Number.isFinite(retryAfterSeconds)) return retryAfterSeconds * 1000;
  return undefined;
};

const offlineHints = [
  /Network request failed/i,
  /Failed to fetch/i,
  /NetworkError/i,
  /Network error/i,
  /TypeError:\s*Failed to fetch/i,
  /DNS lookup failed/i,
  /Network connection lost/i,
  /ECONNRESET/i,
  /ENOTFOUND/i,
  /EAI_AGAIN/i,
];

export function normalizeNetError(error: unknown, ctx?: { url?: string; response?: Response }): NetError {
  const { response } = ctx || {};
  const url = ctx?.url ?? response?.url;
  const message = typeof error === 'string' ? error : (error as Error | undefined)?.message || '';

  if (response?.status) {
    return {
      kind: 'HTTP',
      status: response.status,
      url,
      retryAfterMs: parseRetryAfterMs(response),
      details: message || undefined,
      cause: error,
    };
  }

  if (isHTTPErrorLike(error)) {
    return {
      kind: 'HTTP',
      status: error.status ?? error.response?.status,
      url: url ?? error.response?.url,
      retryAfterMs: parseRetryAfterMs(error.response),
      details: error.message,
      cause: error,
    };
  }

  if (isTimeoutErrorLike(error) || message.toLowerCase().includes('timeout')) {
    return { kind: 'TIMEOUT', url, details: message || undefined, cause: error };
  }

  if (isAbortError(error)) {
    return { kind: 'ABORT', url, details: message || undefined, cause: error };
  }

  if (offlineHints.some((pattern) => pattern.test(message))) {
    return { kind: 'OFFLINE', url, details: message || undefined, cause: error };
  }

  return { kind: 'UNKNOWN', url, details: message || undefined, cause: error };
}

export function getUserFacingNetworkMessage(
  err: NetError,
  ctx?: UserFacingNetworkMessageContext,
): { title: string; message: string; cta?: { label: string; action: 'RETRY' | 'LOGIN' | 'OPEN_SYNC' | 'DISMISS' } } {
  const status = err.status;

  if (status === 401) {
    const nextCtx = { ...ctx, retryable: ctx?.retryable ?? false };
    maybeWarn('NET_UNAUTHORIZED_401', err, nextCtx);
    return {
      title: 'Sesión expirada',
      message: 'Tu sesión caducó. Inicia sesión nuevamente para continuar.',
      cta: { label: 'Iniciar sesión', action: 'LOGIN' },
    };
  }

  if (status === 403) {
    const nextCtx = { ...ctx, retryable: ctx?.retryable ?? false };
    maybeWarn('NET_FORBIDDEN_403', err, nextCtx);
    return {
      title: 'Permisos insuficientes',
      message: 'Tu cuenta no tiene permisos para realizar esta acción. Si crees que es un error, contacta a soporte.',
      cta: { label: 'Entendido', action: 'DISMISS' },
    };
  }

  if (status === 408 || err.kind === 'TIMEOUT' || err.kind === 'ABORT') {
    const nextCtx = { ...ctx, retryable: ctx?.retryable ?? true };
    maybeWarn('NET_TIMEOUT', err, nextCtx);
    return {
      title: 'Tiempo de espera',
      message: 'El servidor no respondió a tiempo. Intenta nuevamente.',
      cta: { label: 'Reintentar', action: 'RETRY' },
    };
  }

  if (status && status >= 500 && status <= 599) {
    const nextCtx = { ...ctx, retryable: ctx?.retryable ?? true };
    maybeWarn('NET_HTTP_5XX', err, nextCtx);
    return {
      title: 'Error del servidor',
      message: 'El servidor tuvo un problema. Intenta más tarde.',
      cta: { label: 'Reintentar', action: 'RETRY' },
    };
  }

  if (err.kind === 'OFFLINE') {
    const nextCtx = { ...ctx, retryable: ctx?.retryable ?? true };
    maybeWarn('NET_OFFLINE_ENQUEUE', err, nextCtx);
    return {
      title: 'Sin conexión',
      message:
        'No se pudo conectar. Revisa tu conexión a internet. Si estás sin red, el envío quedará en cola y se reintentará automáticamente.',
      cta: { label: 'Ver cola', action: 'OPEN_SYNC' },
    };
  }

  if (status === 422) {
    const nextCtx = { ...ctx, retryable: ctx?.retryable ?? false };
    maybeWarn('NET_HTTP_4XX_OTHER', err, nextCtx);
    return {
      title: 'Datos inválidos',
      message: 'Los datos requieren corrección antes de enviarse.',
      cta: { label: 'Entendido', action: 'DISMISS' },
    };
  }

  if (status && status >= 400 && status <= 499) {
    const nextCtx = { ...ctx, retryable: ctx?.retryable ?? false };
    maybeWarn('NET_HTTP_4XX_OTHER', err, nextCtx);
    return {
      title: 'No se pudo completar',
      message: 'Ocurrió un error inesperado. Intenta nuevamente.',
      cta: { label: 'Entendido', action: 'DISMISS' },
    };
  }

  maybeWarn('NET_UNKNOWN', err, ctx);
  return {
    title: 'No se pudo completar',
    message: 'Ocurrió un error inesperado. Intenta nuevamente.',
    cta: { label: 'Entendido', action: 'DISMISS' },
  };
}

/*
Ejemplos rápidos:
- normalizeNetError(new HTTPError(401, 'Unauthorized', false)) => { kind: 'HTTP', status: 401 }
- normalizeNetError(new Error('Network request failed')) => { kind: 'OFFLINE' }
- getUserFacingNetworkMessage({ kind: 'HTTP', status: 504 }) => CTA de reintento con título de error del servidor
*/
