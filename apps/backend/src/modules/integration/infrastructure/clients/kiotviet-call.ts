import { createHash } from 'node:crypto';

import type { KvCredentials } from '../../application/ports/kiotviet-gateway.js';
import type { Bucket } from './kiotviet-budget.js';

/** How the KiotViet client calls: profiles (background, interactive), shared state, call options. */

/** Calls made while the owner waits (connect wizard): one 10 s try, no retries, no budget wait. */
export interface CallProfile {
  timeoutMs: number;
  retryDelaysMs: readonly number[];
  /** Wait for the per-store budget (background) or spend it into debt at once (interactive). */
  waitForBudget: boolean;
}

export const BACKGROUND: CallProfile = {
  timeoutMs: 15_000,
  retryDelaysMs: [1_000, 4_000, 15_000],
  waitForBudget: true,
};
export const INTERACTIVE: CallProfile = {
  timeoutMs: 10_000,
  retryDelaysMs: [],
  waitForBudget: false,
};
/** Upper bound for a server-sent `Retry-After`. */
export const MAX_RETRY_AFTER_MS = 60_000;
/** Tokens are renewed this long before KiotViet says they expire. */
export const TOKEN_MARGIN_MS = 300_000;
export const DEFAULT_TOKEN_TTL_S = 86_400;
export interface CachedToken {
  token: string;
  expiresAt: number;
}

/** A response whose body was read inside the retried section. */
export interface Received {
  status: number;
  /** Empty unless the status is 2xx. */
  body: string;
}

/** Token cache and budget, shared by the background client and its interactive view. */
export interface SharedState {
  tokens: Map<string, CachedToken>;
  pendingTokens: Map<string, Promise<string>>;
  buckets: Map<string, Bucket>;
}

export type Query = Record<string, string | number | boolean | undefined>;

export interface CallOptions {
  query?: Query;
  body?: unknown;
  /** Answer `null` on 404 instead of treating it as an unknown store. */
  allowNotFound?: boolean;
  /**
   * A write that must not be sent twice: only 429 (refused before processing) is retried; a
   * timeout, network error or 5xx fails at once. Other 4xx answers are `KiotVietRejectedError`.
   */
  once?: boolean;
}

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');
/** Token cache key: a rotated secret never reuses, or is overwritten by, the old secret's token. */
export const tokenKey = (c: KvCredentials): string =>
  `${c.clientId}\u0000${sha256(c.clientSecret)}`;
export const retryable = (status: number): boolean => status === 429 || status >= 500;
/** `/products/12` → `products`: the resource named in a permission error. */
export const resourceOf = (path: string): string => path.split('/').filter(Boolean)[0] ?? path;
