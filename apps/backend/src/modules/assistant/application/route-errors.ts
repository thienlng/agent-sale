import { redactSensitive } from '@agent-sales/ai-core';

/** At most this many validation issues reach the model. */
export const MAX_ROUTE_ERROR_ISSUES = 5;
/** The error summary the model sees is at most this long (as text). */
export const MAX_ROUTE_ERROR_CHARS = 600;

export interface RouteErrorSummary {
  code?: string;
  message?: string;
  issues?: { path: string; message: string }[];
}

const text = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? redactSensitive(v, max) : undefined;

/**
 * What an API error answer tells the model (QA NB-3): the envelope's code, message and the first
 * validation issues (`details.issues`, field path + message), each part redacted (no phones,
 * e-mails, URLs or secrets) and the whole at most 600 chars. Only the body is read: headers
 * never reach it. Null when the body is not an error envelope.
 */
export function summariseRouteError(body: unknown): RouteErrorSummary | null {
  const error = (body as { error?: unknown } | null)?.error;
  if (!error || typeof error !== 'object') return null;
  const e = error as { code?: unknown; message?: unknown; details?: unknown };
  const out: RouteErrorSummary = {};
  const code = text(e.code, 40);
  const message = text(e.message, 240);
  if (code) out.code = code;
  if (message) out.message = message;
  const raw = (e.details as { issues?: unknown } | null | undefined)?.issues;
  if (Array.isArray(raw)) {
    const issues: { path: string; message: string }[] = [];
    let used = JSON.stringify(out).length;
    for (const i of raw.slice(0, MAX_ROUTE_ERROR_ISSUES)) {
      const issue = {
        path: text((i as { path?: unknown }).path, 80) ?? '',
        message: text((i as { message?: unknown }).message, 160) ?? '',
      };
      const size = JSON.stringify(issue).length + 12;
      if (used + size > MAX_ROUTE_ERROR_CHARS) break;
      used += size;
      issues.push(issue);
    }
    if (issues.length > 0) out.issues = issues;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** One line for an event message: `CODE: message; path: message; …`, at most 600 chars. */
export function routeErrorLine(summary: RouteErrorSummary | null): string {
  if (!summary) return '';
  const parts = [
    [summary.code, summary.message].filter(Boolean).join(': '),
    ...(summary.issues ?? []).map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)),
  ].filter(Boolean);
  const line = parts.join('; ');
  return line.length <= MAX_ROUTE_ERROR_CHARS
    ? line
    : `${line.slice(0, MAX_ROUTE_ERROR_CHARS - 1)}…`;
}
