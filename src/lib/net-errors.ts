// src/lib/net-errors.ts

import { t } from '@/src/i18n';

export type NetErrorKind = 'HTTP' | 'TIMEOUT' | 'OFFLINE' | 'ABORT' | 'TLS' | 'UNKNOWN';

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

const tlsHints = [
  /SSL/i,
  /certificate/i,
  /CERT/i,
  /TLS/i,
  /handshake/i,
  /SEC_ERROR/i,
];

type OperationOutcomeIssue = {
  diagnostics?: unknown;
  details?: { text?: unknown };
};

const parseMaybeJson = (value: unknown) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
};

const getOutcomePayload = (err: NetError) => {
  const extended = err as NetError & {
    data?: unknown;
    body?: unknown;
    response?: { data?: unknown };
  };
  const candidates = [extended.details, extended.data, extended.body, extended.response?.data];
  for (const candidate of candidates) {
    if (candidate !== undefined) return parseMaybeJson(candidate);
  }
  return undefined;
};

const getOutcomeDetail = (err: NetError): { detail?: string; diagnostics?: string } => {
  const payload = getOutcomePayload(err);
  if (!payload || typeof payload !== 'object') return {};
  const issue = (payload as { issue?: unknown }).issue;
  if (!Array.isArray(issue) || issue.length === 0) return {};
  const firstIssue = issue[0] as OperationOutcomeIssue;
  const diagnostics = typeof firstIssue.diagnostics === 'string' ? firstIssue.diagnostics : undefined;
  const detailsText = typeof firstIssue.details?.text === 'string' ? firstIssue.details.text : undefined;
  return { detail: diagnostics ?? detailsText, diagnostics };
};

const splitFirstSentence = (text: string) => {
  const parts = text.split(/[\n.;]/);
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
};

const truncateText = (text: string, limit: number) => {
  if (text.length <= limit) return text;
  return text.slice(0, limit).trimEnd();
};

const formatOutcomeDetail = (detail: string) => {
  const firstSentence = splitFirstSentence(detail);
  if (!firstSentence) return undefined;
  return truncateText(firstSentence, 160);
};

const redactQuotedText = (text: string) =>
  text.replace(/'[^']*'/g, '‘…’').replace(/"[^"]*"/g, '“…”');

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

  if (tlsHints.some((pattern) => pattern.test(message))) {
    return { kind: 'TLS', url, details: message || undefined, cause: error };
  }

  if (offlineHints.some((pattern) => pattern.test(message))) {
    return { kind: 'OFFLINE', url, details: message || undefined, cause: error };
  }

  return { kind: 'UNKNOWN', url, details: message || undefined, cause: error };
}

export function getUserFacingNetworkMessage(
  err: NetError,
  ctx?: UserFacingNetworkMessageContext,
): {
  title: string;
  message: string;
  cta?: { label: string; action: 'RETRY' | 'LOGIN' | 'OPEN_SYNC' | 'DISMISS' };
} {
  const status = err.status;

  if (status === 401) {
    const nextCtx = { ...ctx, retryable: ctx?.retryable ?? false };
    maybeWarn('NET_UNAUTHORIZED_401', err, nextCtx);
    return {
      // Importante: NO pasar currentLang aquí; t() resuelve el idioma (y en tests queda ES).
      title: t('net.sessionExpiredTitle'),
      message: t('net.sessionExpiredMessage'),
      cta: { label: t('net.loginCta'), action: 'LOGIN' },
    };
  }

  if (status === 403) {
    const nextCtx = { ...ctx, retryable: ctx?.retryable ?? false };
    maybeWarn('NET_FORBIDDEN_403', err, nextCtx);
    return {
      title: t('net.permissionsTitle'),
      message: t('net.permissionsMessage'),
      cta: { label: t('common.understood'), action: 'DISMISS' },
    };
  }

  if (status === 408 || err.kind === 'TIMEOUT' || err.kind === 'ABORT') {
    const nextCtx = { ...ctx, retryable: ctx?.retryable ?? true };
    maybeWarn('NET_TIMEOUT', err, nextCtx);
    return {
      title: t('net.timeoutTitle'),
      message: t('net.timeoutMessage'),
      cta: { label: t('common.retry'), action: 'RETRY' },
    };
  }

  if (status && status >= 500 && status <= 599) {
    const nextCtx = { ...ctx, retryable: ctx?.retryable ?? true };
    maybeWarn('NET_HTTP_5XX', err, nextCtx);
    return {
      title: t('net.serverErrorTitle'),
      message: t('net.serverErrorMessage'),
      cta: { label: t('common.retry'), action: 'RETRY' },
    };
  }

  if (err.kind === 'OFFLINE') {
    const nextCtx = { ...ctx, retryable: ctx?.retryable ?? true };
    maybeWarn('NET_OFFLINE_ENQUEUE', err, nextCtx);
    return {
      title: t('net.offlineTitle'),
      message: t('net.offlineMessage'),
      cta: { label: t('common.viewQueue'), action: 'OPEN_SYNC' },
    };
  }

  if (err.kind === 'TLS') {
    const nextCtx = { ...ctx, retryable: ctx?.retryable ?? false };
    maybeWarn('NET_TLS_ERROR', err, nextCtx);
    return {
      title: t('net.tlsTitle'),
      message: t('net.tlsMessage'),
      cta: { label: t('common.understood'), action: 'DISMISS' },
    };
  }

  if (status === 422) {
    const nextCtx = { ...ctx, retryable: ctx?.retryable ?? false };
    maybeWarn('NET_HTTP_4XX_OTHER', err, nextCtx);
    const outcome = getOutcomeDetail(err);
    const detail = outcome.detail ? formatOutcomeDetail(outcome.detail) : undefined;
    if (ctx?.log !== false && outcome.diagnostics) {
      const redacted = truncateText(redactQuotedText(outcome.diagnostics), 100);
      if (redacted) {
        console.warn('[HNDV][WARN][NET_INVALID_422]', { issues: redacted });
      }
    }
    return {
      title: t('net.invalidDataTitle'),
      message: detail
        ? t('net.invalidDataMessageDetail', { detail: detail.endsWith('.') ? detail.slice(0, -1) : detail })
        : t('net.invalidDataMessage'),
      cta: { label: t('common.understood'), action: 'DISMISS' },
    };
  }

  if (status && status >= 400 && status <= 499) {
    const nextCtx = { ...ctx, retryable: ctx?.retryable ?? false };
    maybeWarn('NET_HTTP_4XX_OTHER', err, nextCtx);
    return {
      title: t('net.requestFailedTitle'),
      message: t('net.requestFailedMessage'),
      cta: { label: t('common.understood'), action: 'DISMISS' },
    };
  }

  maybeWarn('NET_UNKNOWN', err, ctx);
  return {
    title: t('net.requestFailedTitle'),
    message: t('net.requestFailedMessage'),
    cta: { label: t('common.understood'), action: 'DISMISS' },
  };
}

/*
Ejemplos rápidos:
- normalizeNetError(new HTTPError(401, 'Unauthorized', false)) => { kind: 'HTTP', status: 401 }
- normalizeNetError(new Error('Network request failed')) => { kind: 'OFFLINE' }
- getUserFacingNetworkMessage({ kind: 'HTTP', status: 504 }) => CTA de reintento con título de error del servidor
*/
