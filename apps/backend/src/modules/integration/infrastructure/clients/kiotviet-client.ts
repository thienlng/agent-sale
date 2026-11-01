import { createHash } from 'node:crypto';

import { Logger } from '@nestjs/common';
import type { z } from 'zod';

import type { Env } from '../../../../common/config.js';
import type {
  KiotVietGateway,
  KvBranch,
  KvCredentials,
  KvOnHand,
  KvPage,
  KvWebhook,
} from '../../application/ports/kiotviet-gateway.js';
import {
  KiotVietAuthError,
  KiotVietPermissionError,
  KiotVietRetailerError,
  KiotVietUnavailableError,
} from '../../domain/integration.errors.js';
import type { KvProduct } from '../../domain/kiotviet-mapping.js';
import {
  KvBranchSchema,
  KvListSchema,
  KvOnHandSchema,
  KvProductSchema,
  KvWebhookIdSchema,
  KvWebhookSchema,
  TokenSchema,
} from './kiotviet.schemas.js';

/**
 * KiotViet public API client (spec §3, §8). Logs carry method, path, status and counts only:
 * never the client secret, the access token or a response body (rule 07).
 */
const log = new Logger('KiotVietClient');

const TIMEOUT_MS = 15_000;
const RETRY_DELAYS_MS = [1_000, 4_000, 15_000] as const;
/** Tokens are renewed this long before KiotViet says they expire. */
const TOKEN_MARGIN_MS = 300_000;
const DEFAULT_TOKEN_TTL_S = 86_400;
const PAGE_SIZE = 100;
/** Per-store request budget: bursts of 10, refilled at 4 500 requests per hour. */
const BUDGET_CAPACITY = 10;
const BUDGET_PER_SECOND = 4_500 / 3_600;

export interface KiotVietClientOptions {
  tokenUrl: string;
  apiUrl: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Milliseconds since the epoch. */
  now?: () => number;
}

interface CachedToken {
  token: string;
  secretHash: string;
  expiresAt: number;
}

interface Bucket {
  tokens: number;
  at: number;
}

type Query = Record<string, string | number | boolean | undefined>;

interface CallOptions {
  query?: Query;
  body?: unknown;
  /** Answer `null` on 404 instead of treating it as an unknown store. */
  allowNotFound?: boolean;
}

const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex');
const retryable = (status: number): boolean => status === 429 || status >= 500;
/** `/products/12` → `products`: the resource named in a permission error. */
const resourceOf = (path: string): string => path.split('/').filter(Boolean)[0] ?? path;

export class KiotVietClient implements KiotVietGateway {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly apiUrl: string;
  private readonly tokens = new Map<string, CachedToken>();
  private readonly pendingTokens = new Map<string, Promise<string>>();
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly options: KiotVietClientOptions) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
    this.apiUrl = options.apiUrl.replace(/\/+$/, '');
  }

  static fromEnv(env: Pick<Env, 'KIOTVIET_TOKEN_URL' | 'KIOTVIET_API_URL'>): KiotVietClient {
    return new KiotVietClient({ tokenUrl: env.KIOTVIET_TOKEN_URL, apiUrl: env.KIOTVIET_API_URL });
  }

  async branches(c: KvCredentials): Promise<KvBranch[]> {
    const out: KvBranch[] = [];
    for (let currentItem = 0; ; currentItem += PAGE_SIZE) {
      const page = await this.list(
        c,
        '/branches',
        { currentItem, pageSize: PAGE_SIZE },
        KvBranchSchema,
      );
      out.push(...page.data);
      if (page.data.length === 0 || currentItem + PAGE_SIZE >= page.total) return out;
    }
  }

  products(
    c: KvCredentials,
    q: { currentItem: number; pageSize: number; lastModifiedFrom?: Date },
  ): Promise<KvPage<KvProduct>> {
    return this.list(
      c,
      '/products',
      {
        currentItem: q.currentItem,
        pageSize: Math.min(q.pageSize, PAGE_SIZE),
        includeInventory: true,
        includeRemoveIds: true,
        lastModifiedFrom: q.lastModifiedFrom?.toISOString(),
      },
      KvProductSchema,
    );
  }

  async productById(c: KvCredentials, id: number): Promise<KvProduct | null> {
    const raw = await this.call(c, 'GET', `/products/${id}`, { allowNotFound: true });
    if (raw === null) return null;
    return this.parse(KvProductSchema, raw, 'GET /products/{id}');
  }

  onHands(
    c: KvCredentials,
    q: { currentItem: number; pageSize: number; lastModifiedFrom?: Date; branchIds: number[] },
  ): Promise<KvPage<KvOnHand>> {
    return this.list(
      c,
      '/productOnHands',
      {
        currentItem: q.currentItem,
        pageSize: Math.min(q.pageSize, PAGE_SIZE),
        branchIds: q.branchIds.length ? q.branchIds.join(',') : undefined,
        lastModifiedFrom: q.lastModifiedFrom?.toISOString(),
      },
      KvOnHandSchema,
    );
  }

  async *productCodes(c: KvCredentials): AsyncIterable<string> {
    for (let currentItem = 0; ; currentItem += PAGE_SIZE) {
      const page = await this.list(
        c,
        '/products',
        { currentItem, pageSize: PAGE_SIZE },
        KvProductSchema,
      );
      for (const p of page.data) yield p.code;
      if (page.data.length === 0 || currentItem + PAGE_SIZE >= page.total) return;
    }
  }

  async registerWebhook(
    c: KvCredentials,
    w: { type: string; url: string; secretBase64: string },
  ): Promise<number> {
    const raw = await this.call(c, 'POST', '/webhooks', {
      body: {
        Webhook: {
          Type: w.type,
          Url: w.url,
          IsActive: true,
          Description: 'Rapiz',
          Secret: w.secretBase64,
        },
      },
    });
    return this.parse(KvWebhookIdSchema, raw, 'POST /webhooks');
  }

  async deleteWebhook(c: KvCredentials, id: number): Promise<void> {
    // A 404 means the webhook is already gone, which is what the caller wants.
    await this.call(c, 'DELETE', `/webhooks/${id}`, { allowNotFound: true });
  }

  async listWebhooks(c: KvCredentials): Promise<KvWebhook[]> {
    const raw = await this.call(c, 'GET', '/webhooks', { query: { pageSize: PAGE_SIZE } });
    const items = Array.isArray(raw) ? raw : this.parse(KvListSchema, raw, 'GET /webhooks').data;
    return this.items(KvWebhookSchema, items, 'GET /webhooks');
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async list<S extends z.ZodType>(
    c: KvCredentials,
    path: string,
    query: Query,
    schema: S,
  ): Promise<KvPage<z.output<S>>> {
    const raw = await this.call(c, 'GET', path, { query });
    const envelope = this.parse(KvListSchema, raw, `GET ${path}`);
    return { ...envelope, data: this.items(schema, envelope.data, `GET ${path}`) };
  }

  /** Validates items one by one so a single odd record does not sink the page. */
  private items<S extends z.ZodType>(schema: S, raw: unknown[], label: string): Array<z.output<S>> {
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

  private parse<S extends z.ZodType>(schema: S, raw: unknown, label: string): z.output<S> {
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    const fields = parsed.error.issues.map((i) => i.path.join('.') || '(root)').join(',');
    log.warn(`KiotViet ${label}: unexpected payload shape at ${fields}`);
    throw new KiotVietUnavailableError();
  }

  /**
   * One API call: token, budget, retries. A 401 renews the token once; a second 401 with a
   * freshly issued token means the store name is wrong.
   */
  private async call(
    c: KvCredentials,
    method: string,
    path: string,
    opts: CallOptions = {},
  ): Promise<unknown> {
    const url = new URL(`${this.apiUrl}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const label = `${method} ${path}`;
    let renewed = false;
    for (;;) {
      const token = await this.token(c);
      const headers: Record<string, string> = {
        Retailer: c.retailer,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      };
      if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await this.send(
        label,
        url.toString(),
        opts.body === undefined
          ? { method, headers }
          : { method, headers, body: JSON.stringify(opts.body) },
        c.retailer,
      );

      if (res.status === 401) {
        await res.body?.cancel();
        this.forget(c.clientId, token);
        if (renewed) {
          log.warn(`KiotViet ${label} → 401 with a fresh token: unknown store`);
          throw new KiotVietRetailerError();
        }
        renewed = true;
        continue;
      }
      if (res.status === 403) {
        await res.body?.cancel();
        log.warn(`KiotViet ${label} → 403`);
        throw new KiotVietPermissionError([resourceOf(path)]);
      }
      if (res.status === 404) {
        await res.body?.cancel();
        if (opts.allowNotFound) return null;
        log.warn(`KiotViet ${label} → 404: unknown store`);
        throw new KiotVietRetailerError();
      }
      if (!res.ok) {
        await res.body?.cancel();
        log.warn(`KiotViet ${label} → ${res.status}`);
        throw new KiotVietUnavailableError();
      }
      return this.json(res, label);
    }
  }

  private async json(res: Response, label: string): Promise<unknown> {
    const body = await res.text();
    if (!body) return null;
    try {
      return JSON.parse(body) as unknown;
    } catch {
      log.warn(`KiotViet ${label}: response is not JSON`);
      throw new KiotVietUnavailableError();
    }
  }

  /** Fetch with timeout and backoff on 429, 5xx and network errors. */
  private async send(
    label: string,
    url: string,
    init: RequestInit,
    budgetKey?: string,
  ): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      if (budgetKey !== undefined) await this.takeBudget(budgetKey);
      let outcome: string;
      try {
        const res = await this.fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!retryable(res.status)) return res;
        await res.body?.cancel();
        outcome = String(res.status);
      } catch (error) {
        outcome = error instanceof Error ? error.name : 'network error';
      }
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        log.warn(`KiotViet ${label} → ${outcome}; giving up after ${attempt} retries`);
        throw new KiotVietUnavailableError();
      }
      log.warn(`KiotViet ${label} → ${outcome}; retry ${attempt + 1} in ${delay} ms`);
      await this.sleep(delay);
    }
  }

  /** Cached per client id; one token request in flight per client and secret. */
  private token(c: KvCredentials): Promise<string> {
    const secretHash = sha256(c.clientSecret);
    const cached = this.tokens.get(c.clientId);
    if (cached && cached.secretHash === secretHash && cached.expiresAt > this.now()) {
      return Promise.resolve(cached.token);
    }
    const key = `${c.clientId}\u0000${secretHash}`;
    let pending = this.pendingTokens.get(key);
    if (!pending) {
      pending = this.requestToken(c, secretHash).finally(() => this.pendingTokens.delete(key));
      this.pendingTokens.set(key, pending);
    }
    return pending;
  }

  private async requestToken(c: KvCredentials, secretHash: string): Promise<string> {
    const res = await this.send('POST /connect/token', this.options.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        scopes: 'PublicApi.Access',
        grant_type: 'client_credentials',
        client_id: c.clientId,
        client_secret: c.clientSecret,
      }).toString(),
    });
    if (res.status === 400 || res.status === 401) {
      await res.body?.cancel();
      log.warn(`KiotViet token → ${res.status}: client id or secret rejected`);
      throw new KiotVietAuthError();
    }
    if (!res.ok) {
      await res.body?.cancel();
      log.warn(`KiotViet token → ${res.status}`);
      throw new KiotVietUnavailableError();
    }
    const parsed = this.parse(TokenSchema, await this.json(res, 'POST /connect/token'), 'token');
    const ttlMs = (parsed.expires_in ?? DEFAULT_TOKEN_TTL_S) * 1000;
    this.tokens.set(c.clientId, {
      token: parsed.access_token,
      secretHash,
      expiresAt: this.now() + ttlMs - TOKEN_MARGIN_MS,
    });
    return parsed.access_token;
  }

  private forget(clientId: string, token: string): void {
    if (this.tokens.get(clientId)?.token === token) this.tokens.delete(clientId);
  }

  /** In-memory token bucket per store; waits instead of failing. */
  private async takeBudget(retailer: string): Promise<void> {
    const key = retailer.trim().toLowerCase();
    for (;;) {
      const now = this.now();
      const bucket = this.buckets.get(key) ?? { tokens: BUDGET_CAPACITY, at: now };
      bucket.tokens = Math.min(
        BUDGET_CAPACITY,
        bucket.tokens + ((now - bucket.at) / 1000) * BUDGET_PER_SECOND,
      );
      bucket.at = now;
      this.buckets.set(key, bucket);
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return;
      }
      await this.sleep(Math.ceil(((1 - bucket.tokens) / BUDGET_PER_SECOND) * 1000));
    }
  }
}
