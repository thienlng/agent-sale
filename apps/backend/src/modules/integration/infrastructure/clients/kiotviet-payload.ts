import { Logger } from '@nestjs/common';
import type { z } from 'zod';

import { KiotVietUnavailableError } from '../../domain/integration.errors.js';
import { MAX_RETRY_AFTER_MS } from './kiotviet-call.js';

/** Reading KiotViet answers: JSON, payload and list-item validation, `Retry-After`. No bodies logged. */
const log = new Logger('KiotVietClient');

/** Validates items one by one so a single odd record does not sink the page. */
export function parseItems<S extends z.ZodType>(
  schema: S,
  raw: unknown[],
  label: string,
): Array<z.output<S>> {
  const out: Array<z.output<S>> = [];
  let dropped = 0;
  for (const item of raw) {
    const parsed = schema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
    else dropped += 1;
  }
  if (dropped) log.warn(`KiotViet ${label}: dropped ${dropped} of ${raw.length} malformed items`);
  return out;
}

/** The payload, or `KiotVietUnavailableError` naming only the offending field paths. */
export function parsePayload<S extends z.ZodType>(
  schema: S,
  raw: unknown,
  label: string,
): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const fields = parsed.error.issues.map((i) => i.path.join('.') || '(root)').join(',');
  log.warn(`KiotViet ${label}: unexpected payload shape at ${fields}`);
  throw new KiotVietUnavailableError();
}

export function parseJson(body: string, label: string): unknown {
  if (!body) return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    log.warn(`KiotViet ${label}: response is not JSON`);
    throw new KiotVietUnavailableError();
  }
}

/** `Retry-After` in seconds or as an HTTP date, capped at 60 s; undefined when unusable. */
export function readRetryAfter(header: string | null, now: number): number | undefined {
  if (!header) return undefined;
  const value = header.trim();
  const ms = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  if (!Number.isFinite(ms) || ms < 0) return undefined;
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}
