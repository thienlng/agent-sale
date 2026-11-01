import { Logger } from '@nestjs/common';
import type { z } from 'zod';

import type { Env } from '../../../../common/config.js';
import type {
  KiotVietGateway,
  KvBranch,
  KvCredentials,
  KvOnHand,
  KvOrderRef,
  KvOrderSummary,
  KvPage,
  KvWebhook,
} from '../../application/ports/kiotviet-gateway.js';
import {
  KiotVietAuthError,
  KiotVietPermissionError,
  KiotVietRejectedError,
  KiotVietRetailerError,
  KiotVietUnavailableError,
} from '../../domain/integration.errors.js';
import type { KvProduct } from '../../domain/kiotviet-mapping.js';
import type { KvOrderBody } from '../../domain/kiotviet-order.js';
import { takeFromBudget } from './kiotviet-budget.js';
import { parseItems, parseJson, parsePayload, readRetryAfter } from './kiotviet-payload.js';
import {
  BACKGROUND,
  type CallOptions,
  type CallProfile,
  DEFAULT_TOKEN_TTL_S,
  INTERACTIVE,
  type Query,
  type Received,
  resourceOf,
  retryable,
  type SharedState,
  TOKEN_MARGIN_MS,
  tokenKey,
} from './kiotviet-call.js';
import {
  KvBranchSchema,
  KvListSchema,
  KvOnHandSchema,
  KvOrderSchema,
  KvOrderSummarySchema,
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

const PAGE_SIZE = 100;
/**
 * A stable order for paging `/products` by `currentItem`: without it, products edited during a long
 * import can shift between pages and be skipped, and the full-import sweep would archive them.
 * One constant, so a trial store can adjust it.
 */
export const PRODUCT_ORDER = { orderBy: 'id', orderDirection: 'Asc' } as const;

export interface KiotVietClientOptions {
  tokenUrl: string;
  apiUrl: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Milliseconds since the epoch. */
  now?: () => number;
}

export class KiotVietClient implements KiotVietGateway {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly apiUrl: string;
  private readonly shared: SharedState;
  private interactiveView: KiotVietClient | undefined;

  constructor(
    private readonly options: KiotVietClientOptions,
    shared?: SharedState,
    private readonly profile: CallProfile = BACKGROUND,
  ) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
    this.apiUrl = options.apiUrl.replace(/\/+$/, '');
    this.shared = shared ?? { tokens: new Map(), pendingTokens: new Map(), buckets: new Map() };
  }

  static fromEnv(env: Pick<Env, 'KIOTVIET_TOKEN_URL' | 'KIOTVIET_API_URL'>): KiotVietClient {
    return new KiotVietClient({ tokenUrl: env.KIOTVIET_TOKEN_URL, apiUrl: env.KIOTVIET_API_URL });
  }

  /**
   * The same client for calls the owner waits on: one try with a 10 s timeout (no retries, no
   * `Retry-After` wait), budget spent without waiting. Shares the token cache and the budget.
   */
  interactive(): KiotVietGateway {
    this.interactiveView ??=
      this.profile === INTERACTIVE
        ? this
        : new KiotVietClient(this.options, this.shared, INTERACTIVE);
    return this.interactiveView;
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
    q: {
      currentItem: number;
      pageSize: number;
      lastModifiedFrom?: Date;
      includeInventory?: boolean;
    },
  ): Promise<KvPage<KvProduct>> {
    return this.list(
      c,
      '/products',
      {
        currentItem: q.currentItem,
        pageSize: Math.min(q.pageSize, PAGE_SIZE),
        includeInventory: q.includeInventory ? true : undefined,
        includeRemoveIds: true,
        lastModifiedFrom: q.lastModifiedFrom?.toISOString(),
        ...PRODUCT_ORDER,
      },
      KvProductSchema,
    );
  }

  async productById(c: KvCredentials, id: number): Promise<KvProduct | null> {
    const raw = await this.call(c, 'GET', `/products/${id}`, { allowNotFound: true });
    if (raw === null) return null;
    return parsePayload(KvProductSchema, raw, 'GET /products/{id}');
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

  async productCount(c: KvCredentials): Promise<number | null> {
    const raw = await this.call(c, 'GET', '/products', { query: { currentItem: 0, pageSize: 1 } });
    const total = (raw as { total?: unknown } | null)?.total;
    return Number.isInteger(total) && (total as number) >= 0 ? (total as number) : null;
  }

  async *productCodes(c: KvCredentials): AsyncIterable<string> {
    for (let currentItem = 0; ; currentItem += PAGE_SIZE) {
      const page = await this.list(
        c,
        '/products',
        { currentItem, pageSize: PAGE_SIZE, ...PRODUCT_ORDER },
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
    return parsePayload(KvWebhookIdSchema, raw, 'POST /webhooks');
  }

  async deleteWebhook(c: KvCredentials, id: number): Promise<void> {
    // A 404 means the webhook is already gone, which is what the caller wants.
    await this.call(c, 'DELETE', `/webhooks/${id}`, { allowNotFound: true });
  }

  async listWebhooks(c: KvCredentials): Promise<KvWebhook[]> {
    const raw = await this.call(c, 'GET', '/webhooks', { query: { pageSize: PAGE_SIZE } });
    const items = Array.isArray(raw) ? raw : parsePayload(KvListSchema, raw, 'GET /webhooks').data;
    return parseItems(KvWebhookSchema, items, 'GET /webhooks');
  }

  async createOrder(c: KvCredentials, body: KvOrderBody): Promise<KvOrderRef> {
    const raw = await this.call(c, 'POST', '/orders', { body, once: true });
    return parsePayload(KvOrderSchema, raw, 'POST /orders');
  }

  recentOrders(
    c: KvCredentials,
    q: { branchId: number; since: Date; currentItem: number; pageSize: number },
  ): Promise<KvPage<KvOrderSummary>> {
    return this.list(
      c,
      '/orders',
      {
        branchIds: q.branchId,
        lastModifiedFrom: q.since.toISOString(),
        currentItem: q.currentItem,
        pageSize: Math.min(q.pageSize, PAGE_SIZE),
      },
      KvOrderSummarySchema,
    );
  }

  async orderById(c: KvCredentials, id: number): Promise<KvOrderRef | null> {
    const raw = await this.call(c, 'GET', `/orders/${id}`, { allowNotFound: true });
    if (raw === null) return null;
    return parsePayload(KvOrderSchema, raw, 'GET /orders/{id}');
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async list<S extends z.ZodType>(
    c: KvCredentials,
    path: string,
    query: Query,
    schema: S,
  ): Promise<KvPage<z.output<S>>> {
    const raw = await this.call(c, 'GET', path, { query });
    const envelope = parsePayload(KvListSchema, raw, `GET ${path}`);
    return { ...envelope, data: parseItems(schema, envelope.data, `GET ${path}`) };
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
        opts.once === true,
      );

      if (res.status === 401) {
        this.forget(c, token);
        if (renewed) {
          log.warn(`KiotViet ${label} → 401 with a fresh token: unknown store`);
          throw new KiotVietRetailerError();
        }
        renewed = true;
        continue;
      }
      if (res.status === 403) {
        log.warn(`KiotViet ${label} → 403`);
        throw new KiotVietPermissionError([resourceOf(path)]);
      }
      if (res.status === 404) {
        if (opts.allowNotFound) return null;
        log.warn(`KiotViet ${label} → 404: unknown store`);
        throw new KiotVietRetailerError();
      }
      if (opts.once && res.status >= 400 && res.status < 500) {
        log.warn(`KiotViet ${label} → ${res.status}: rejected`);
        throw new KiotVietRejectedError(res.status);
      }
      if (res.status < 200 || res.status >= 300) {
        log.warn(`KiotViet ${label} → ${res.status}`);
        throw new KiotVietUnavailableError();
      }
      return parseJson(res.body, label);
    }
  }

  /**
   * Fetch with timeout and backoff on 429, 5xx and network errors. The body is read inside the
   * retried section, so a timeout or a dropped connection while it streams is retried too. With
   * `once`, only a 429 is retried: anything else may have been processed.
   */
  private async send(
    label: string,
    url: string,
    init: RequestInit,
    budgetKey?: string,
    once = false,
  ): Promise<Received> {
    for (let attempt = 0; ; attempt += 1) {
      if (budgetKey !== undefined) await this.takeBudget(budgetKey);
      let outcome: string;
      let retryAfterMs: number | undefined;
      try {
        const res = await this.fetchImpl(url, {
          ...init,
          signal: AbortSignal.timeout(this.profile.timeoutMs),
        });
        if (!retryable(res.status)) {
          if (res.ok) return { status: res.status, body: await res.text() };
          await res.body?.cancel();
          return { status: res.status, body: '' };
        }
        await res.body?.cancel();
        outcome = String(res.status);
        if (res.status === 429 || res.status === 503) {
          retryAfterMs = readRetryAfter(res.headers.get('retry-after'), this.now());
        }
      } catch (error) {
        outcome = error instanceof Error ? error.name : 'network error';
      }
      if (once && outcome !== '429') {
        log.warn(`KiotViet ${label} → ${outcome}; not retried (the write may have landed)`);
        throw new KiotVietUnavailableError();
      }
      const scheduled = this.profile.retryDelaysMs[attempt];
      if (scheduled === undefined) {
        log.warn(`KiotViet ${label} → ${outcome}; giving up after ${attempt} retries`);
        throw new KiotVietUnavailableError();
      }
      const delay = retryAfterMs ?? scheduled;
      log.warn(`KiotViet ${label} → ${outcome}; retry ${attempt + 1} in ${delay} ms`);
      await this.sleep(delay);
    }
  }

  /** Cached per client id and secret; one token request in flight per pair. */
  private token(c: KvCredentials): Promise<string> {
    const key = tokenKey(c);
    const cached = this.shared.tokens.get(key);
    if (cached && cached.expiresAt > this.now()) return Promise.resolve(cached.token);
    let pending = this.shared.pendingTokens.get(key);
    if (!pending) {
      pending = this.requestToken(c, key).finally(() => this.shared.pendingTokens.delete(key));
      this.shared.pendingTokens.set(key, pending);
    }
    return pending;
  }

  private async requestToken(c: KvCredentials, key: string): Promise<string> {
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
      log.warn(`KiotViet token → ${res.status}: client id or secret rejected`);
      throw new KiotVietAuthError();
    }
    if (res.status < 200 || res.status >= 300) {
      log.warn(`KiotViet token → ${res.status}`);
      throw new KiotVietUnavailableError();
    }
    const parsed = parsePayload(TokenSchema, parseJson(res.body, 'POST /connect/token'), 'token');
    const ttlMs = (parsed.expires_in ?? DEFAULT_TOKEN_TTL_S) * 1000;
    this.shared.tokens.set(key, {
      token: parsed.access_token,
      expiresAt: this.now() + ttlMs - TOKEN_MARGIN_MS,
    });
    return parsed.access_token;
  }

  private forget(c: KvCredentials, token: string): void {
    const key = tokenKey(c);
    if (this.shared.tokens.get(key)?.token === token) this.shared.tokens.delete(key);
  }

  /** Per-store budget (`kiotviet-budget.ts`): background calls wait, interactive ones do not. */
  private async takeBudget(retailer: string): Promise<void> {
    const interactive = !this.profile.waitForBudget;
    for (;;) {
      let wait: number;
      try {
        wait = takeFromBudget(this.shared.buckets, retailer, this.now(), interactive);
      } catch (error) {
        log.warn('KiotViet budget of a store is too far in debt; refusing an interactive call');
        throw error;
      }
      if (wait === 0) return;
      await this.sleep(wait);
    }
  }
}
