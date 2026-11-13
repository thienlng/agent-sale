import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { GenerateRequest, GenerateResponse } from '@agent-sales/ai-core';
import { newId, userId, workspaceId, type UserId, type WorkspaceId } from '@agent-sales/shared';
import { parse } from 'yaml';
import { z } from 'zod';

import type { AccountFacade } from '../../account/api/index.js';
import type { LlmGatewayPort } from '../../ai/api/index.js';
import type { NotificationFacade } from '../../notification/api/index.js';
import type { WorkspaceFacade, WorkspaceMembership } from '../../workspace/api/index.js';
import { ChatTurnService } from '../application/chat-turn.service.js';
import { CompactionService } from '../application/compaction.service.js';
import { ASSISTANT_PROMPT } from '../application/prompt-builder.js';
import { ReportService } from '../application/report.service.js';
import { SchedulesService } from '../application/schedules.service.js';
import { SkillCatalog } from '../application/skill-tools.js';
import { SkillsService } from '../application/skills.service.js';
import { ThreadPromptService } from '../application/thread-prompt.service.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import type { ReportStringsSource } from '../domain/ports/report-data-source.port.js';
import type { SqlRunner } from '../domain/ports/sql-runner.port.js';
import { InMemoryAssistantRepository } from '../infrastructure/persistence/assistant.in-memory-repository.js';

/** `apps/backend/evals/assistant/`, the same path from src/ (tests, tsx) and dist/. */
export const ASSISTANT_EVALS_DIR = fileURLToPath(
  new URL('../../../../evals/assistant/', import.meta.url),
);
/** The original case file (T-172); every `*.yaml` of the folder is a case file. */
export const ASSISTANT_EVALS_FILE = path.join(ASSISTANT_EVALS_DIR, 'schedules.yaml');

const FakeTurn = z
  .object({
    text: z.string().default(''),
    tool_calls: z
      .array(z.object({ name: z.string(), input: z.record(z.string(), z.unknown()) }).strict())
      .default([]),
  })
  .strict();

const TextCheck = z
  .object({
    contains: z.array(z.string().min(1)).default([]),
    not_contains: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .refine((t) => t.contains.length + t.not_contains.length > 0, 'contains or not_contains');

const SqlRows = z
  .object({
    columns: z
      .array(
        z
          .object({
            name: z.string().min(1),
            type: z.enum(['number', 'text', 'boolean', 'date', 'other']),
          })
          .strict(),
      )
      .min(1),
    rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
  })
  .strict()
  .refine((r) => r.rows.every((row) => row.length === r.columns.length), 'row width = columns');
type SqlRows = z.infer<typeof SqlRows>;

/** The rows a case's SQL lane answers when it gives no `sql_rows`. */
const DEFAULT_SQL_ROWS: SqlRows = {
  columns: [
    { name: 'status_name', type: 'text' },
    { name: 'n', type: 'number' },
  ],
  rows: [['Đăng ký kiểm tra', 2]],
};

/** `contains` fragments missing from `text`, and `not_contains` ones present (case-insensitive). */
export function textProblems(
  label: string,
  text: string,
  check: { contains: readonly string[]; not_contains: readonly string[] },
): string[] {
  const hay = text.toLowerCase();
  return [
    ...check.contains
      .filter((w) => !hay.includes(w.toLowerCase()))
      .map((w) => `${label}: missing ${JSON.stringify(w)}`),
    ...check.not_contains
      .filter((w) => hay.includes(w.toLowerCase()))
      .map((w) => `${label}: has ${JSON.stringify(w)}`),
  ];
}

/**
 * One owner message and what it must leave (owner assistant eval, T-172): the proposal, or the
 * read-only SQL it ran (T-187). A case without `proposal` must leave none.
 */
export const AssistantEvalCase = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    tags: z.array(z.string()).default([]),
    /** The industry of the owner's one business (default retail). */
    industry: z.string().default('retail'),
    message: z.string().min(1),
    expect: z
      .object({
        proposal: z
          .object({
            routeKey: z.string(),
            /** Subset of the proposed draft; `channels` compares as a set. */
            draft: z.record(z.string(), z.unknown()),
          })
          .strict()
          .optional(),
        /** Fragments one SQL query of the turn must contain (lowercased, spaces collapsed). */
        sql: z
          .object({ contains: z.array(z.string().min(1)).min(1) })
          .strict()
          .optional(),
        /** The answer text: every `contains` fragment present, no `not_contains` one (case-insensitive). */
        answer: TextCheck.optional(),
        /** All tool results of the turn together, as the model saw them (same check). */
        tool_results: TextCheck.optional(),
        /** A UI action type (e.g. `navigate`) the answer must not carry. */
        no_ui_action: z.enum(['navigate', 'spotlight', 'fill_form', 'chart']).optional(),
      })
      .strict()
      .refine(
        (e) => e.proposal || e.sql || e.answer || e.tool_results || e.no_ui_action,
        'expect something',
      ),
    /**
     * What the routes answer in this case: `"GET /products"` (method and the exact path the
     * tool calls, without the query) → the JSON body of a 200. Any other route answers 404.
     */
    routes: z.record(z.string().regex(/^(GET|POST|PUT|PATCH|DELETE) \//), z.unknown()).default({}),
    /**
     * The rows every `sql_query` of the case answers, whatever the query (DEC-8): a case that
     * checks the figures in the answer gives the same counts here as in its routes. With it, or
     * with `expect.sql`, the turn has the SQL lane.
     */
    sql_rows: SqlRows.optional(),
    /** The scripted model of fake mode: one entry per model call. */
    fake_turns: z.array(FakeTurn).min(1),
  })
  .strict();
export type AssistantEvalCase = z.infer<typeof AssistantEvalCase>;

/** The `*.yaml` case files of the folder, sorted by name. */
export function assistantEvalFiles(dir = ASSISTANT_EVALS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => path.join(dir, f));
}

export function loadAssistantCases(
  files: string | readonly string[] = assistantEvalFiles(),
): AssistantEvalCase[] {
  const cases = (typeof files === 'string' ? [files] : files).flatMap((file) => {
    const raw = parse(readFileSync(file, 'utf8')) as { cases?: unknown };
    return z.array(AssistantEvalCase).min(1).parse(raw.cases);
  });
  const ids = cases.map((c) => c.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`duplicate assistant eval case id ${dup}`);
  return cases;
}

export interface AssistantEvalResult {
  id: string;
  critical: boolean;
  ok: boolean;
  problems: string[];
}

/** Replays the case's `fake_turns`; no network. */
export function fakeAssistantModel(c: AssistantEvalCase): LlmGatewayPort {
  const turns = [...c.fake_turns];
  return {
    generate(_req: GenerateRequest): Promise<GenerateResponse> {
      const turn = turns.shift() ?? { text: '', tool_calls: [] };
      return Promise.resolve({
        text: turn.text,
        toolCalls: turn.tool_calls.map((t, i) => ({
          id: `call_${i}`,
          name: t.name,
          input: t.input,
        })),
        stopReason: turn.tool_calls.length ? 'tool_use' : 'end',
        usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
        provider: 'fake',
        model: 'fake-pro',
        latencyMs: 0,
      });
    },
  };
}

/** `expected` is a subset of `actual`; arrays named `channels` compare as sets. */
function subsetProblems(expected: unknown, actual: unknown, path: string): string[] {
  if (Array.isArray(expected)) {
    const a = Array.isArray(actual) ? actual : [];
    const sort = (x: unknown[]) => JSON.stringify(path.endsWith('channels') ? [...x].sort() : x);
    return sort(expected) === sort(a) ? [] : [`${path}: ${JSON.stringify(actual)}`];
  }
  if (expected !== null && typeof expected === 'object') {
    const a = (actual ?? {}) as Record<string, unknown>;
    return Object.entries(expected).flatMap(([k, v]) => subsetProblems(v, a[k], `${path}.${k}`));
  }
  return expected === actual ? [] : [`${path}: ${JSON.stringify(actual)}`];
}

const noFigures = (): Promise<never> => Promise.reject(new Error('no report data in evals'));
const squash = (sql: string) => sql.toLowerCase().replace(/\s+/g, ' ');

/** A read-only SQL lane that records the queries and answers the case's fixed rows. */
class RecordingSqlRunner implements SqlRunner {
  readonly queries: string[] = [];
  constructor(private readonly answer: SqlRows) {}
  run(i: Parameters<SqlRunner['run']>[0]): ReturnType<SqlRunner['run']> {
    this.queries.push(i.sql);
    return Promise.resolve({
      columns: this.answer.columns.map((c) => ({ ...c })),
      rows: this.answer.rows.map((r) => [...r]),
      truncated: false,
    });
  }
}

/**
 * Runs one case through the real chat turn (the current `assistant@N` prompt, the platform
 * skills, every tool) on in-memory stores with email on, then checks the one pending proposal.
 */
export async function runAssistantCase(
  c: AssistantEvalCase,
  gateway: LlmGatewayPort,
): Promise<AssistantEvalResult> {
  const accountId = newId();
  const owner: UserId = userId(newId());
  const business: WorkspaceId = workspaceId(newId());
  const memberships: WorkspaceMembership[] = [
    {
      workspaceId: business,
      workspaceName: 'Shop Lan',
      role: 'owner',
      industry: c.industry,
      accountId,
      createdAt: new Date(0),
    },
  ];
  const account = {
    listForUser: () => Promise.resolve([{ accountId, name: 'Lan', role: 'owner' }]),
  } as unknown as AccountFacade;
  const workspace = {
    accountOf: () => Promise.resolve(accountId),
    listMemberships: () => Promise.resolve(memberships),
    getById: (w: WorkspaceId) => Promise.resolve({ id: w, name: 'Shop Lan' }),
  } as unknown as WorkspaceFacade;
  const notifications: NotificationFacade = {
    notify: () => Promise.reject(new Error('no delivery in evals')),
    recipientLocale: () => Promise.resolve('vi'),
    emailAvailable: () => true,
    deliverySummary: () => Promise.resolve(new Map()),
  };
  const strings: ReportStringsSource = () => ({});
  const repo = new InMemoryAssistantRepository();
  const skills = new SkillsService(repo, await SkillCatalog.load());
  const prompts = new ThreadPromptService(workspace, repo, skills);
  const reports = new ReportService(
    {
      revenue: noFigures,
      orders: noFigures,
      lowStock: noFigures,
      awaiting: noFigures,
      newContacts: noFigures,
      industry: noFigures,
      stays: noFigures,
      requests: noFigures,
    },
    strings,
  );
  const schedules = new SchedulesService(account, workspace, repo, notifications, reports, prompts);
  const invoker = {
    invoke: (i: { method: string; path: string }) => {
      const key = `${i.method.toUpperCase()} ${i.path}`;
      return Promise.resolve(
        key in c.routes ? { status: 200, body: c.routes[key] } : { status: 404, body: null },
      );
    },
  };
  const sql =
    c.expect.sql || c.sql_rows ? new RecordingSqlRunner(c.sql_rows ?? DEFAULT_SQL_ROWS) : null;
  const chat = new ChatTurnService(
    repo,
    gateway,
    skills,
    invoker,
    new CompactionService(repo, gateway, prompts),
    schedules,
    sql,
  );
  const scope: OwnerScope = {
    accountId,
    ownerUserId: owner,
    businessId: business,
    businessIds: [business],
  };
  const promptVersion = `${ASSISTANT_PROMPT.name}@${ASSISTANT_PROMPT.version}`;
  const thread = await repo.createThread(scope, {
    id: newId(),
    title: '',
    systemPrompt: await prompts.build(scope, 'Lan', promptVersion),
    promptVersion,
  });

  const problems: string[] = [];
  try {
    const turn = await chat.send(
      scope,
      thread.id,
      { turnId: newId(), text: c.message },
      'Bearer eval',
    );
    const answer = turn.messages.filter((m) => m.role === 'assistant').at(-1);
    if (c.expect.answer)
      problems.push(...textProblems('answer', answer?.content ?? '', c.expect.answer));
    if (c.expect.tool_results) {
      const results = (await repo.listMessages(scope, thread.id))
        .filter((m) => m.role === 'tool')
        .map((m) => m.content)
        .join('\n');
      problems.push(...textProblems('tool_results', results, c.expect.tool_results));
    }
    const banned = c.expect.no_ui_action;
    if (banned && answer?.uiActions.some((a) => (a as { type?: string }).type === banned)) {
      problems.push(`ui action ${banned} on the answer`);
    }
    const proposals = (await repo.listProposals(scope, thread.id)).filter(
      (p) => p.status === 'pending',
    );
    const expected = c.expect.proposal;
    if (proposals.length !== (expected ? 1 : 0))
      problems.push(`expected ${expected ? 1 : 0} pending proposal, got ${proposals.length}`);
    const p = proposals[0];
    if (p && expected) {
      if (p.routeKey !== expected.routeKey) problems.push(`routeKey: ${p.routeKey}`);
      const draft = (p.preview as { draft?: unknown } | null)?.draft;
      problems.push(...subsetProblems(expected.draft, draft, 'draft'));
    }
    if (c.expect.sql && sql) {
      const want = c.expect.sql.contains.map(squash);
      if (!sql.queries.some((q) => want.every((w) => squash(q).includes(w)))) {
        problems.push(`sql: no query contains ${JSON.stringify(c.expect.sql.contains)}`);
      }
    }
    if (repo.schedules.size > 0) problems.push('a schedule was written before approval');
  } catch (e) {
    problems.push(`turn failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { id: c.id, critical: c.tags.includes('critical'), ok: problems.length === 0, problems };
}
