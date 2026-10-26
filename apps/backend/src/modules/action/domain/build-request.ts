import type { ActionAuth, ActionParam } from '@agent-sales/contracts';

import type { SafeHttpRequest } from './safe-http.js';

/**
 * Turns model-supplied arguments into an outbound request. Pure. Arguments are validated
 * against the declared params first; only then are they placed (path encoded, query via
 * URLSearchParams, body as JSON, headers restricted). Never throws.
 */
export type ActionArgs = Record<string, string | number | boolean>;

export interface RequestSpec {
  url: string;
  method: string;
  params: ActionParam[];
  auth: ActionAuth;
}

export type BuildRequestResult =
  { ok: true; request: SafeHttpRequest } | { ok: false; errorCode: 'invalid_args' | 'network' };

const MAX_ARG_LENGTH = 500;
const HEADER_NAME = /^[A-Za-z][A-Za-z0-9-]{0,39}$/;
/** Visible ASCII plus space/tab: no CR, LF, NUL or other control characters. */
const HEADER_VALUE = /^[\t\x20-\x7e]*$/;
const RESERVED_HEADERS = new Set([
  'host',
  'authorization',
  'cookie',
  'set-cookie',
  'content-length',
  'content-type',
  'transfer-encoding',
  'connection',
  'upgrade',
  'idempotency-key',
  'proxy-authorization',
  'accept',
]);

const invalid = { ok: false, errorCode: 'invalid_args' } as const;

function coerce(param: ActionParam, raw: unknown): string | number | boolean | undefined {
  if (param.type === 'string') {
    return typeof raw === 'string' && raw.length <= MAX_ARG_LENGTH ? raw : undefined;
  }
  if (param.type === 'number') {
    const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
    return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
  }
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return typeof raw === 'boolean' ? raw : undefined;
}

function isReservedHeader(name: string): boolean {
  const n = name.toLowerCase();
  return RESERVED_HEADERS.has(n) || n.startsWith('proxy-') || n.startsWith('sec-');
}

export function buildRequest(
  spec: RequestSpec,
  args: Record<string, unknown>,
  secret: string | null,
  idempotencyKey: string,
): BuildRequestResult {
  const values = new Map<string, string | number | boolean>();
  for (const param of spec.params) {
    const raw = Object.hasOwn(args, param.name) ? args[param.name] : undefined;
    if (raw === undefined || raw === null) {
      if (param.required) return invalid;
      continue;
    }
    const value = coerce(param, raw);
    if (value === undefined) return invalid;
    values.set(param.name, value);
  }

  let path = spec.url;
  const query: [string, string][] = [];
  const headers: Record<string, string> = { Accept: 'application/json' };
  const body: Record<string, string | number | boolean> = {};
  for (const param of spec.params) {
    const value = values.get(param.name);
    if (value === undefined) continue;
    const text = String(value);
    if (param.location === 'path') {
      if (text === '' || text === '.' || text === '..') return invalid;
      path = path.split(`{${param.name}}`).join(encodeURIComponent(text));
    } else if (param.location === 'query') {
      query.push([param.name, text]);
    } else if (param.location === 'header') {
      if (!HEADER_NAME.test(param.name) || isReservedHeader(param.name)) return invalid;
      if (!HEADER_VALUE.test(text)) return invalid;
      headers[param.name] = text;
    } else {
      body[param.name] = value;
    }
  }
  if (/[{}]/.test(path.replace(/^https?:\/\/[^/]*/i, ''))) return invalid;

  let url: URL;
  try {
    url = new URL(path);
  } catch {
    return invalid;
  }
  for (const [k, v] of query) url.searchParams.append(k, v);

  if (spec.auth.kind !== 'none' && secret) {
    if (!HEADER_VALUE.test(secret)) return { ok: false, errorCode: 'network' };
    if (spec.auth.kind === 'bearer') headers['Authorization'] = `Bearer ${secret}`;
    else {
      const name = spec.auth.headerName;
      if (!HEADER_NAME.test(name) || isReservedHeader(name))
        return { ok: false, errorCode: 'network' };
      headers[name] = secret;
    }
  }

  const method = spec.method.toUpperCase();
  const request: SafeHttpRequest = { url: url.toString(), method, headers };
  if (method !== 'GET') {
    headers['Idempotency-Key'] = idempotencyKey;
    if (Object.keys(body).length > 0) {
      headers['Content-Type'] = 'application/json';
      request.body = JSON.stringify(body);
    }
  }
  return { ok: true, request };
}
