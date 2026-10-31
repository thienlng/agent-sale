import { LlmCallError, type LlmErrorKind } from './gateway.js';

const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
]);
const CONTEXT_PATTERN = /context[ _]length|maximum context|context window|too many tokens/i;
const FILTER_PATTERN = /content[ _]filter|content[ _]policy/i;
const FILTER_CODES = new Set(['content_filter', 'content_policy_violation']);
const MAX_RETRY_AFTER_MS = 5 * 60_000;

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  status?: unknown;
  code?: unknown;
  cause?: unknown;
  headers?: unknown;
  retryAfterMs?: unknown;
}

/** Maps any thrown value (SDK error, fetch error, LlmCallError) to a retry-relevant kind. */
export function classifyLlmError(error: unknown): LlmErrorKind {
  if (error instanceof LlmCallError) return error.kind;
  const e = asErrorLike(error);
  const name = typeof e.name === 'string' ? e.name : '';
  const message = typeof e.message === 'string' ? e.message : '';
  const status = typeof e.status === 'number' ? e.status : undefined;
  const code = errorCode(e);

  if (name === 'APIUserAbortError' || name === 'AbortError') return 'aborted';
  if (name === 'APIConnectionTimeoutError' || name === 'TimeoutError') return 'timeout';

  if (status !== undefined) {
    if (status === 429) return 'rate_limit';
    if (status === 401 || status === 403) return 'auth';
    if (status >= 500) return 'overloaded';
    if (status === 413 || (status === 400 && CONTEXT_PATTERN.test(message))) {
      return 'context_too_long';
    }
    if (status === 400 && (FILTER_PATTERN.test(message) || FILTER_CODES.has(code ?? ''))) {
      return 'content_filter';
    }
    if (status === 400 || status === 404 || status === 422) return 'invalid_request';
    return 'unknown';
  }

  if (name === 'APIConnectionError') return 'network';
  if (
    (code && NETWORK_CODES.has(code)) ||
    /fetch failed|ECONNRESET|socket hang up/i.test(message)
  ) {
    return 'network';
  }
  if (FILTER_PATTERN.test(message)) return 'content_filter';
  return 'unknown';
}

/** Server-requested wait from a `retry-after` header (seconds or HTTP date), in ms. */
export function retryAfterMsOf(error: unknown): number | undefined {
  if (error instanceof LlmCallError) return error.retryAfterMs;
  const e = asErrorLike(error);
  if (typeof e.retryAfterMs === 'number') return e.retryAfterMs;
  const raw = readHeader(e.headers, 'retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  const date = Date.parse(raw);
  if (Number.isNaN(date)) return undefined;
  return Math.min(Math.max(0, date - Date.now()), MAX_RETRY_AFTER_MS);
}

/** Wraps any thrown value in an `LlmCallError` carrying its kind, Retry-After and HTTP status. */
export function toLlmCallError(error: unknown): LlmCallError {
  if (error instanceof LlmCallError) return error;
  const e = asErrorLike(error);
  const message = typeof e.message === 'string' ? e.message : 'LLM call failed';
  const status = typeof e.status === 'number' ? e.status : undefined;
  const wrapped = new LlmCallError(classifyLlmError(error), message, retryAfterMsOf(error), status);
  wrapped.cause = error;
  return wrapped;
}

function asErrorLike(error: unknown): ErrorLike {
  return typeof error === 'object' && error !== null ? (error as ErrorLike) : {};
}

function errorCode(e: ErrorLike): string | undefined {
  if (typeof e.code === 'string') return e.code;
  const cause = asErrorLike(e.cause);
  return typeof cause.code === 'string' ? cause.code : undefined;
}

function readHeader(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const h = headers as { get?: unknown };
  if (typeof h.get === 'function') {
    const v = (h.get as (n: string) => unknown).call(headers, name);
    return typeof v === 'string' ? v : undefined;
  }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name && typeof v === 'string') return v;
  }
  return undefined;
}
