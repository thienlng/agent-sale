import type { RunnableTool, ToolDefinition } from '@agent-sales/ai-core';
import type { AssistantPageContext } from '@agent-sales/contracts';
import { newId } from '@agent-sales/shared';
import { z } from 'zod';

import type { OwnerScope } from '../domain/owner-scope.js';
import type { AssistantRepository } from '../domain/ports/assistant.repository.js';
import type { RouteInvoker } from '../domain/ports/route-invoker.port.js';
import { type CatalogEntry, type RouteCatalog, searchCatalog } from './route-catalog.js';

export const TOOL_SEARCH_TOOL = 'tool_search';
export const TOOL_DESCRIBE_TOOL = 'tool_describe';
export const TOOL_CALL_TOOL = 'tool_call';
/** A route tool result the model sees is never longer than this. */
export const MAX_ROUTE_RESULT_CHARS = 8_000;
/** Read results of one turn, all together, are never longer than this. */
export const TURN_READ_BUDGET_CHARS = 40_000;
/** A proposal waits this long for the owner. */
export const PROPOSAL_TTL_MS = 24 * 60 * 60_000;
export const TRUNCATED = '…[truncated]';
/** Said to the model with a 403, so it tells the owner why. */
export const FORBIDDEN_MESSAGE = 'Tài khoản của anh/chị không có quyền này';
const MAX_ISSUES = 5;
const PATH_PARAM = /^[A-Za-z0-9_-]{1,64}$/;
const MUTATING_WITH_STATE = new Set(['patch', 'put', 'delete']);

const ToolSearchInput = z.object({ query: z.string().trim().min(1).max(200) });
const ToolDescribeInput = z.object({ key: z.string().max(200) });
const ToolCallInput = z.object({
  key: z.string().max(200),
  businessId: z.string().max(64).optional(),
  params: z.record(z.string().max(60), z.string().max(200)).optional(),
  query: z.record(z.string().max(60), z.unknown()).optional(),
  body: z.unknown().optional(),
  summary: z.string().max(300).optional(),
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
      'Run a route by key. A read returns { status, body }. A write is never run: it becomes a proposal the owner approves in the chat; give `summary` (Vietnamese, ≤ 300 chars: what will change). businessId defaults to the current business.',
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
    }
  | { ok: false; errorCode: string; extra?: Record<string, unknown> };

/** tool_search, tool_describe and tool_call for one turn (spec §6). */
export function routeTools(ctx: RouteToolContext): RunnableTool[] {
  const now = ctx.now ?? (() => new Date());
  let readChars = 0;

  function prepare(input: z.output<typeof ToolCallInput>): Prepared {
    const entry = ctx.catalog.get(input.key);
    if (!entry) return { ok: false, errorCode: 'unknown_key' };
    const businessId = input.businessId ?? ctx.scope.businessId;
    if (!ctx.scope.businessIds.some((id) => id === businessId)) {
      return { ok: false, errorCode: 'unknown_business' };
    }
    let path = entry.path;
    for (const name of entry.pathParams) {
      const value = input.params?.[name];
      if (value === undefined || !PATH_PARAM.test(value)) {
        return { ok: false, errorCode: 'bad_params', extra: { param: name } };
      }
      path = path.replace(`{${name}}`, value);
    }
    let query: Record<string, string | string[]> | undefined;
    if (entry.query) {
      query = queryStrings(input.query ?? {});
      const parsed = entry.query.safeParse(query);
      if (!parsed.success) {
        return { ok: false, errorCode: 'invalid_input', extra: { issues: issuesOf(parsed.error) } };
      }
    }
    if (entry.body) {
      const parsed = entry.body.safeParse(input.body);
      if (!parsed.success) {
        return { ok: false, errorCode: 'invalid_input', extra: { issues: issuesOf(parsed.error) } };
      }
    }
    return {
      ok: true,
      entry,
      businessId,
      path,
      ...(query && Object.keys(query).length ? { query } : {}),
      ...(entry.body ? { body: input.body } : {}),
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
      const error = (res.body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
      const out = fail(`http_${res.status}`, {
        ...(res.status === 403 ? { message: FORBIDDEN_MESSAGE } : {}),
        ...(error ? { error: { code: error.code, message: error.message } } : {}),
      });
      out.content = cut(out.content, room);
      readChars += out.content.length;
      return out;
    }
    const content = cut(json({ status: res.status, body: res.body }), room);
    readChars += content.length;
    return { content };
  }

  async function propose(p: Extract<Prepared, { ok: true }>, summary: string) {
    let before: unknown;
    const reader = MUTATING_WITH_STATE.has(p.entry.method)
      ? ctx.catalog.readerOf(p.entry)
      : undefined;
    if (reader) {
      // The current state, so the owner sees what changes (a PUT replaces it whole).
      const current = await ctx.invoker.invoke({
        method: 'get',
        path: p.path,
        businessId: p.businessId,
        authorization: ctx.authorization,
      });
      if (current.status < 300) before = current.body;
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
        body: p.body ?? null,
        query: p.query ?? null,
        ...(before !== undefined ? { before } : {}),
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
      const hits = searchCatalog(ctx.catalog, query, ctx.page?.route).map((e) => ({
        key: e.key,
        use: e.use,
        summary: e.summary,
        when: e.when,
      }));
      return Promise.resolve({ content: cut(json(hits), MAX_ROUTE_RESULT_CHARS) });
    },
  };

  const describe: RunnableTool = {
    name: TOOL_DESCRIBE_TOOL,
    readOnly: true,
    schema: ToolDescribeInput,
    run(input) {
      const { key } = input as z.output<typeof ToolDescribeInput>;
      const entry = ctx.catalog.get(key);
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
