import {
  containsPiiToken,
  redactPii,
  type RunnableTool,
  type ToolDefinition,
} from '@agent-sales/ai-core';
import { type AssistantPageContext, SECRET_IN_DRAFT } from '@agent-sales/contracts';
import { newId } from '@agent-sales/shared';
import { z } from 'zod';

import { utcInstants } from '../domain/local-time.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import type { AssistantRepository } from '../domain/ports/assistant.repository.js';
import type { RouteInvoker } from '../domain/ports/route-invoker.port.js';
import { readCurrentState } from './current-state.js';
import {
  InitialStock,
  PRODUCT_CREATE_KEY,
  unknownStockSkus,
  withStockShown,
} from './initial-stock.js';
import { summariseRouteError } from './route-errors.js';
import { type CatalogEntry, type RouteCatalog, searchCatalog } from './route-catalog.js';
import type { NativeToolEntry } from './sql/sql-tools.js';

export const TOOL_SEARCH_TOOL = 'tool_search';
export const TOOL_DESCRIBE_TOOL = 'tool_describe';
export const TOOL_CALL_TOOL = 'tool_call';
/** A route tool result the model sees is never longer than this. */
export const MAX_ROUTE_RESULT_CHARS = 8_000;
/** Read results of one turn, all together, are never longer than this. */
export const TURN_READ_BUDGET_CHARS = 40_000;
/** A proposal waits this long for the owner. */
export const PROPOSAL_TTL_MS = 24 * 60 * 60_000;
/** A proposal's body is at most this long as JSON (`body_too_large`). */
export const MAX_PROPOSAL_BODY_CHARS = 20_000;
/** At most this many proposals wait for the owner in one thread (`too_many_pending`). */
export const MAX_PENDING_PROPOSALS = 20;
export const TRUNCATED = '…[truncated]';
/** Said to the model with a 403, so it tells the owner why. */
export const FORBIDDEN_MESSAGE = 'Tài khoản của anh/chị không có quyền này';
const MAX_ISSUES = 5;
const PATH_PARAM = /^[A-Za-z0-9_-]{1,64}$/;
const MUTATING_WITH_STATE = new Set(['patch', 'put', 'delete']);
/**
 * Reads of the business's own content (its bots, FAQs, scenarios, profile and villas), where a
 * phone, e-mail or address is the shop's hotline or address, not a customer's. Every other read
 * has customer contact data redacted before the model sees it (spec 2-R4, QA Villas #3).
 */
export const BUSINESS_OWNED_READS: ReadonlySet<string> = new Set([
  'GET /bots',
  'GET /bots/{botId}',
  'GET /bots/{botId}/faqs',
  'GET /bots/{botId}/training-items',
  'GET /bots/{botId}/training-history',
  'GET /workspace/profile',
  'GET /workspaces/current',
  'GET /lodging/properties',
  'GET /lodging/properties/{id}',
  'GET /products',
  'GET /products/{productId}',
]);

const ToolSearchInput = z.object({ query: z.string().trim().min(1).max(200) });
const ToolDescribeInput = z.object({ key: z.string().max(200) });
const ToolCallInput = z.object({
  key: z.string().max(200),
  businessId: z.string().max(64).optional(),
  params: z.record(z.string().max(60), z.string().max(200)).optional(),
  query: z.record(z.string().max(60), z.unknown()).optional(),
  body: z.unknown().optional(),
  summary: z.string().max(300).optional(),
  /** Only with POST /products: counted stock of the new variants, set on the same approval. */
  stock: z.unknown().optional(),
});

export const ROUTE_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: TOOL_SEARCH_TOOL,
    description:
      'Find the API routes that read or change the owner’s business data (products, orders, customers, bots, statistics, lodging, …). Query in English words. Returns keys to describe or call.',
    input: ToolSearchInput,
  },
  {
    name: TOOL_DESCRIBE_TOOL,
    description:
      'The inputs of one route from tool_search: its path params and the JSON schemas of its query and body.',
    input: ToolDescribeInput,
  },
  {
    name: TOOL_CALL_TOOL,
    description:
      'Run a route by key. A read returns { status, body }. A write is never run: it becomes a proposal the owner approves in the chat; give `summary` (Vietnamese, ≤ 300 chars: what will change). businessId defaults to the current business. Native tools (sql_schema, sql_query) take their input in `body`. With POST /products, `stock` ([{sku, onHand}]) sets the counted stock of the new variants in the default warehouse on the same approval: one card for "tạo sản phẩm, tồn 5 cái".',
    input: ToolCallInput,
  },
];

/** What the route tools work on during one turn. */
export interface RouteToolContext {
  scope: OwnerScope;
  repo: AssistantRepository;
  invoker: RouteInvoker;
  catalog: RouteCatalog;
  /** The owner's own `Authorization` header (memory only; never stored or logged). */
  authorization: string;
  threadId: string;
  runId: string;
  page?: AssistantPageContext;
  /** Proposals made during the turn, in order. */
  proposalIds: string[];
  now?: () => Date;
  /**
   * Native entries of the deferred catalog (T-171: `sql_schema`, `sql_query`), searched,
   * described and called next to the routes. Their keys never start with an HTTP method.
   */
  native?: readonly NativeToolEntry[];
  /** The current business's industry: its own routes rank first in `tool_search`. */
  industry?: string;
}

/** `<` is escaped so a result cannot open or close a prompt tag. */
const json = (value: unknown): string => JSON.stringify(value).replaceAll('<', '\\u003c');

const cut = (text: string, max: number): string =>
  text.length > max ? text.slice(0, Math.max(0, max - TRUNCATED.length)) + TRUNCATED : text;

const fail = (errorCode: string, extra: Record<string, unknown> = {}) => ({
  content: json({ ok: false, errorCode, ...extra }),
  ok: false,
});

function jsonSchema(schema: z.ZodType | undefined): unknown {
  if (!schema) return undefined;
  try {
    const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, {
      io: 'input',
      unrepresentable: 'any',
    });
    return rest;
  } catch {
    return {};
  }
}

/** Query values as the server receives them: strings (arrays stay arrays of strings). */
function queryStrings(query: Record<string, unknown>): Record<string, string | string[]> {
  const str = (v: unknown): string =>
    typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v as string);
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    out[k] = Array.isArray(v) ? v.map(str) : str(v);
  }
  return out;
}

const issuesOf = (error: z.ZodError) =>
  error.issues.slice(0, MAX_ISSUES).map((i) => ({
    path: i.path.map(String).join('.'),
    message: i.message,
  }));

type Prepared =
  | {
      ok: true;
      entry: CatalogEntry;
      businessId: string;
      path: string;
      query?: Record<string, string | string[]>;
      body?: unknown;
      stock?: InitialStock;
    }
  | { ok: false; errorCode: string; extra?: Record<string, unknown> };

/**
 * The catalog entry of a key, also when the model wrote a concrete path instead of the key's
 * template (`GET /bots/01a1…/turns` for `GET /bots/{botId}/turns`, AS-14): the entry and the
 * path params read from it. A query string in the key is ignored. Undefined when nothing matches.
 */
export function resolveRouteKey(
  catalog: RouteCatalog,
  key: string,
): { entry: CatalogEntry; params: Record<string, string> } | undefined {
  const exact = catalog.get(key);
  if (exact) return { entry: exact, params: {} };
  const m = /^([A-Z]+) (\/[^?\s]*)/.exec(key.trim());
  if (!m) return undefined;
  const [, method, path] = m as unknown as [string, string, string];
  const parts = path.replace(/\/+$/, '').split('/');
  for (const entry of catalog.entries) {
    if (entry.method.toUpperCase() !== method || entry.pathParams.length === 0) continue;
    const tpl = entry.path.split('/');
    if (tpl.length !== parts.length) continue;
    const params: Record<string, string> = {};
    const fits = tpl.every((seg, i) => {
      const value = parts[i] as string;
      const name = /^\{(\w+)\}$/.exec(seg)?.[1];
      if (!name) return seg === value;
      if (!PATH_PARAM.test(value)) return false;
      params[name] = value;
      return true;
    });
    if (fits) return { entry, params };
  }
  return undefined;
}

const PRODUCT_LIST_KEY = 'GET /products';
/** A product description in a list read is cut to this many characters (NEW-3). */
export const LIST_DESCRIPTION_CHARS = 200;
export const LIST_DESCRIPTION_CUT = '…[cut: GET /products/{productId} has the full text]';

/**
 * A product list as the model reads it (NEW-3): each description cut to 200 chars, so a few
 * long descriptions do not push the names, prices and stock past the turn's read budget. A
 * write never starts from a list: the full product is `GET /products/{productId}`, which is
 * also what a proposal shows as the current state.
 */
export function compactProductList(body: unknown): unknown {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return body;
  return {
    ...(body as object),
    data: data.map((item: unknown) => {
      const d = (item as { description?: unknown } | null)?.description;
      return typeof d === 'string' && d.length > LIST_DESCRIPTION_CHARS
        ? {
            ...(item as object),
            description: d.slice(0, LIST_DESCRIPTION_CHARS) + LIST_DESCRIPTION_CUT,
          }
        : item;
    }),
  };
}

/** tool_search, tool_describe and tool_call for one turn (spec §6). */
export function routeTools(ctx: RouteToolContext): RunnableTool[] {
  const now = ctx.now ?? (() => new Date());
  let readChars = 0;
  const native = new Map((ctx.native ?? []).map((e) => [e.key, e]));

  /** Cuts a read result to what is left of the turn's read budget and counts it. */
  function spend(out: { content: string; ok?: boolean }) {
    const room = Math.min(MAX_ROUTE_RESULT_CHARS, TURN_READ_BUDGET_CHARS - readChars);
    if (room <= TRUNCATED.length) return fail('turn_budget_exhausted');
    const content = cut(out.content, room);
    readChars += content.length;
    return { ...out, content };
  }

  /** A native entry: `body` is its input; businessId, params and query are ignored. */
  async function callNative(entry: NativeToolEntry, body: unknown) {
    if (Math.min(MAX_ROUTE_RESULT_CHARS, TURN_READ_BUDGET_CHARS - readChars) <= TRUNCATED.length) {
      return fail('turn_budget_exhausted');
    }
    const parsed = entry.input.safeParse(body ?? {});
    if (!parsed.success) {
      return spend(fail('invalid_input', { issues: issuesOf(parsed.error) }));
    }
    return spend(await entry.run(parsed.data));
  }

  function prepare(input: z.output<typeof ToolCallInput>): Prepared {
    const resolved = resolveRouteKey(ctx.catalog, input.key);
    if (!resolved) return { ok: false, errorCode: 'unknown_key' };
    const entry = resolved.entry;
    // Params the model wrote into the path count as given; explicit ones win.
    const params: Record<string, string> = { ...resolved.params, ...input.params };
    const businessId = input.businessId ?? ctx.scope.businessId;
    if (!ctx.scope.businessIds.some((id) => id === businessId)) {
      return { ok: false, errorCode: 'unknown_business' };
    }
    let path = entry.path;
    for (const name of entry.pathParams) {
      const value = params[name];
      if (value === undefined || !PATH_PARAM.test(value)) {
        return { ok: false, errorCode: 'bad_params', extra: { param: name } };
      }
      path = path.replace(`{${name}}`, value);
    }
    let query: Record<string, string | string[]> | undefined;
    if (entry.query) {
      // The model reads instants on the owner's clock (+07:00, AS-3); routes take UTC.
      query = utcInstants(queryStrings(input.query ?? {})) as Record<string, string | string[]>;
      const parsed = entry.query.safeParse(query);
      if (!parsed.success) {
        return { ok: false, errorCode: 'invalid_input', extra: { issues: issuesOf(parsed.error) } };
      }
    }
    // The parsed body, not the raw one, is what is stored and run: unknown keys never reach a
    // proposal (a narrowed, strict schema rejects them; others strip them).
    let body: unknown;
    if (entry.body) {
      const parsed = entry.body.safeParse(utcInstants(input.body));
      if (!parsed.success) {
        const errorCode = parsed.error.issues.some((i) => i.message === SECRET_IN_DRAFT)
          ? SECRET_IN_DRAFT
          : 'invalid_input';
        return { ok: false, errorCode, extra: { issues: issuesOf(parsed.error) } };
      }
      body = parsed.data;
    }
    let stock: InitialStock | undefined;
    if (input.stock !== undefined && input.stock !== null) {
      if (entry.key !== PRODUCT_CREATE_KEY) return { ok: false, errorCode: 'stock_not_allowed' };
      const parsed = InitialStock.safeParse(input.stock);
      if (!parsed.success) {
        return { ok: false, errorCode: 'invalid_stock', extra: { issues: issuesOf(parsed.error) } };
      }
      const unknown = unknownStockSkus(body, parsed.data);
      if (unknown.length > 0) {
        return { ok: false, errorCode: 'stock_unknown_sku', extra: { skus: unknown } };
      }
      stock = parsed.data;
    }
    return {
      ok: true,
      entry,
      businessId,
      path,
      ...(query && Object.keys(query).length ? { query } : {}),
      ...(entry.body ? { body } : {}),
      ...(stock ? { stock } : {}),
    };
  }

  async function read(p: Extract<Prepared, { ok: true }>) {
    const room = Math.min(MAX_ROUTE_RESULT_CHARS, TURN_READ_BUDGET_CHARS - readChars);
    if (room <= TRUNCATED.length) return fail('turn_budget_exhausted');
    const res = await ctx.invoker.invoke({
      method: p.entry.method,
      path: p.path,
      ...(p.query ? { query: p.query } : {}),
      ...(p.body !== undefined ? { body: p.body } : {}),
      businessId: p.businessId,
      authorization: ctx.authorization,
    });
    if (res.status >= 400) {
      const error = summariseRouteError(res.body);
      const out = fail(`http_${res.status}`, {
        ...(res.status === 403 ? { message: FORBIDDEN_MESSAGE } : {}),
        ...(error ? { error } : {}),
      });
      out.content = cut(out.content, room);
      readChars += out.content.length;
      return out;
    }
    const shown = BUSINESS_OWNED_READS.has(p.entry.key) ? res.body : redactPii(res.body);
    const body = p.entry.key === PRODUCT_LIST_KEY ? compactProductList(shown) : shown;
    const content = cut(json({ status: res.status, body }), room);
    readChars += content.length;
    return { content };
  }

  async function propose(p: Extract<Prepared, { ok: true }>, summary: string) {
    if ((JSON.stringify(p.body ?? null) ?? '').length > MAX_PROPOSAL_BODY_CHARS) {
      return fail('body_too_large', { maxChars: MAX_PROPOSAL_BODY_CHARS });
    }
    // A draft copied from a redacted read would write `[phone]` over the real value.
    if (containsPiiToken(p.body ?? null)) return fail('redacted_value_in_body');
    const at = now().getTime();
    const waiting = (await ctx.repo.listProposals(ctx.scope, ctx.threadId)).filter(
      (x) => x.status === 'pending' && x.expiresAt.getTime() > at,
    );
    if (waiting.length >= MAX_PENDING_PROPOSALS) {
      return fail('too_many_pending', { max: MAX_PENDING_PROPOSALS });
    }
    let before: unknown;
    let beforeUnavailable = false;
    if (MUTATING_WITH_STATE.has(p.entry.method)) {
      // The current state, so the owner sees what changes (a PUT replaces it whole).
      const current = await readCurrentState({
        catalog: ctx.catalog,
        invoker: ctx.invoker,
        entry: p.entry,
        path: p.path,
        businessId: p.businessId,
        authorization: ctx.authorization,
      });
      if (current.found) before = current.value;
      // Said on the card instead of an empty "before" the owner could take for "nothing".
      else beforeUnavailable = current.viaParent;
    }
    const proposal = await ctx.repo.createProposal(ctx.scope, {
      id: newId(),
      threadId: ctx.threadId,
      runId: ctx.runId,
      businessId: p.businessId,
      routeKey: p.entry.key,
      path: p.path,
      query: p.query ?? null,
      body: p.body ?? null,
      summary,
      preview: {
        // The card shows each new variant with its stock; `stock` runs after the create.
        body: p.stock ? withStockShown(p.body, p.stock) : (p.body ?? null),
        query: p.query ?? null,
        ...(p.stock ? { stock: p.stock } : {}),
        ...(before !== undefined ? { before } : {}),
        ...(beforeUnavailable ? { beforeUnavailable: true } : {}),
      },
      expiresAt: new Date(now().getTime() + PROPOSAL_TTL_MS),
    });
    ctx.proposalIds.push(proposal.id);
    return { content: json({ status: 'awaiting_owner_approval', proposalId: proposal.id }) };
  }

  const search: RunnableTool = {
    name: TOOL_SEARCH_TOOL,
    readOnly: true,
    schema: ToolSearchInput,
    run(input) {
      const { query } = input as z.output<typeof ToolSearchInput>;
      const hits = searchCatalog(ctx.catalog, query, ctx.page?.route, ctx.native, ctx.industry).map(
        (e) => ({
          key: e.key,
          use: e.use,
          summary: e.summary,
          when: e.when,
        }),
      );
      return Promise.resolve({ content: cut(json(hits), MAX_ROUTE_RESULT_CHARS) });
    },
  };

  const describe: RunnableTool = {
    name: TOOL_DESCRIBE_TOOL,
    readOnly: true,
    schema: ToolDescribeInput,
    run(input) {
      const { key } = input as z.output<typeof ToolDescribeInput>;
      const nativeEntry = native.get(key);
      if (nativeEntry) {
        const out = {
          key: nativeEntry.key,
          use: 'read',
          pathParams: [],
          body: jsonSchema(nativeEntry.input),
        };
        return Promise.resolve({ content: cut(json(out), MAX_ROUTE_RESULT_CHARS) });
      }
      const entry = resolveRouteKey(ctx.catalog, key)?.entry;
      if (!entry) return Promise.resolve(fail('unknown_key'));
      const out = {
        key: entry.key,
        use: entry.use,
        pathParams: entry.pathParams,
        query: jsonSchema(entry.query),
        body: jsonSchema(entry.body),
      };
      return Promise.resolve({ content: cut(json(out), MAX_ROUTE_RESULT_CHARS) });
    },
  };

  // Not read-only for the loop: a write call creates a proposal, so calls run in order.
  const call: RunnableTool = {
    name: TOOL_CALL_TOOL,
    readOnly: false,
    schema: ToolCallInput,
    async run(raw) {
      const input = raw as z.output<typeof ToolCallInput>;
      // Native keys first; a route key always starts with an HTTP method, so none collides.
      const nativeEntry = native.get(input.key);
      if (nativeEntry) return callNative(nativeEntry, input.body);
      const p = prepare(input);
      if (!p.ok) return fail(p.errorCode, p.extra);
      if (p.entry.use === 'read') return read(p);
      const summary = input.summary?.trim();
      if (!summary) return fail('summary_required');
      return propose(p, summary);
    },
  };

  return [search, describe, call];
}
