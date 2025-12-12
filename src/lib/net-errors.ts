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
): { title: string; message: string; cta?: { label: string; action: 'RETRY' | 'LOGIN' | 'OPEN_SYNC' | 'DISMISS' } } {
  const status = err.status;

  if (status === 401) {
    return {
      title: 'Sesión expirada',
      message: 'Vuelve a iniciar sesión para continuar.',
      cta: { label: 'Iniciar sesión', action: 'LOGIN' },
    };
  }

  if (status === 403) {
    return {
      title: 'Acceso restringido',
      message: 'No tienes permisos para realizar esta acción.',
      cta: { label: 'Entendido', action: 'DISMISS' },
    };
  }

  if (status === 408 || err.kind === 'TIMEOUT') {
    return {
      title: 'Tiempo de espera agotado',
      message: 'Revisa tu conexión e inténtalo de nuevo.',
      cta: { label: 'Reintentar', action: 'RETRY' },
    };
  }

  if (status === 429) {
    const retryAfterText = err.retryAfterMs ? ` Espera ${Math.ceil(err.retryAfterMs / 1000)}s y vuelve a intentar.` : '';
    return {
      title: 'Demasiadas solicitudes',
      message: `Has alcanzado el límite de solicitudes.${retryAfterText}`.trim(),
      cta: { label: 'Entendido', action: 'DISMISS' },
    };
  }

  if (status === 502 || status === 503 || status === 504) {
    return {
      title: 'Servidor no disponible / inestable',
      message: 'Estamos teniendo problemas para conectar con el servidor. Intenta nuevamente en unos momentos.',
      cta: { label: 'Reintentar', action: 'RETRY' },
    };
  }

  if (err.kind === 'OFFLINE') {
    return {
      title: 'Sin conexión',
      message: 'Guardamos los cambios localmente y los enviaremos automáticamente cuando vuelva la conexión.',
      cta: { label: 'Ver estado de envío', action: 'OPEN_SYNC' },
    };
  }

  return {
    title: 'No pudimos completar la acción',
    message: 'Ocurrió un problema inesperado. Intenta nuevamente o consulta con soporte si persiste.',
    cta: { label: 'Entendido', action: 'DISMISS' },
  };
}

/*
Ejemplos rápidos:
- normalizeNetError(new HTTPError(401, 'Unauthorized', false)) => { kind: 'HTTP', status: 401 }
- normalizeNetError(new Error('Network request failed')) => { kind: 'OFFLINE' }
- getUserFacingNetworkMessage({ kind: 'HTTP', status: 504 }) => CTA de reintento con título de servidor no disponible
*/
