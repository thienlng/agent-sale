import type { GenerateRequest, GenerateResponse } from '@agent-sales/ai-core';
import type { AssistantUiAction } from '@agent-sales/contracts';
import { DomainError, newId, userId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  BUSY_REPLY,
  ChatTurnService,
  INTERRUPTED_REPLY,
  FALLBACK_REPLY,
  capHistory,
  PROPOSAL_FALLBACK_REPLY,
  finalUiActions,
  HISTORY_MAX_MESSAGES,
  OWNER_WRAP_UP_NOTICE,
} from '../application/chat-turn.service.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import { CompactionService } from '../application/compaction.service.js';
import { toMessageDtos } from '../application/mappers.js';
import { SkillCatalog } from '../application/skill-tools.js';
import type { SchedulesService } from '../application/schedules.service.js';
import { SkillsService } from '../application/skills.service.js';
import { ThreadPromptService } from '../application/thread-prompt.service.js';
import {
  AssistantBusyError,
  AssistantNotFoundError,
  AssistantRunIdTakenError,
} from '../domain/assistant.errors.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import { RUN_STALE_MS } from '../domain/ports/assistant.repository.js';
import type { AccessDelegation } from '../domain/ports/access-delegation.port.js';
import type { RouteInvocation, RouteInvocationResult } from '../domain/ports/route-invoker.port.js';
import type { SqlRunner } from '../domain/ports/sql-runner.port.js';
import { InMemoryAssistantRepository } from '../infrastructure/persistence/assistant.in-memory-repository.js';
import { FakeSqlRunner } from './factories/fake-sql-runner.js';

/** Same name, code and kind as the ai module's error (detected by `isModelRateLimitedError`). */
class AiProviderFailedError extends DomainError {
  readonly code = 'AI_UNAVAILABLE';
  constructor(readonly kind: string) {
    super('down');
  }
}

/** Same name and code as the ai module's error (detected by `isAiNotConfiguredError`). */
class AiNotConfiguredError extends DomainError {
  readonly code = 'AI_UNAVAILABLE';
}

const reply = (over: Partial<GenerateResponse>): GenerateResponse => ({
  text: '',
  toolCalls: [],
  stopReason: 'end',
  usage: { inputTokens: 100, outputTokens: 10, cachedInputTokens: 40 },
  provider: 'fake',
  model: 'fake-pro',
  latencyMs: 5,
  ...over,
});
const NAVIGATE = reply({
  stopReason: 'tool_use',
  toolCalls: [{ id: 'call_1', name: 'ui_navigate', input: { to: '/app/products' } }],
});
const ANSWER = reply({ text: 'Dạ em mở trang Sản phẩm rồi ạ' });
const call = (id: string, name: string, input: unknown) =>
  reply({ stopReason: 'tool_use', toolCalls: [{ id, name, input }] });
const PAGE = { route: '/app/overview', targets: ['overview.add', 'overview.help'] };

const BUSINESS = workspaceId(newId());
const AUTH = 'Bearer owner-token';

async function setup(
  script: (GenerateResponse | Error)[] = [NAVIGATE, ANSWER],
  sqlRunner: SqlRunner | null = null,
  catalog = new SkillCatalog([]),
  delegation: AccessDelegation | null = null,
) {
  const repo = new InMemoryAssistantRepository();
  const scope: OwnerScope = {
    accountId: newId(),
    ownerUserId: userId(newId()),
    businessId: BUSINESS,
    businessIds: [BUSINESS],
  };
  const queue = [...script];
  const generate = vi.fn((_req: GenerateRequest): Promise<GenerateResponse> => {
    const next = queue.shift() ?? ANSWER;
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  const invoke = vi.fn((_i: RouteInvocation): Promise<RouteInvocationResult> =>
    Promise.resolve({ status: 200, body: {} }),
  );
  const skills = new SkillsService(repo, catalog);
  const workspace = { listMemberships: () => Promise.resolve([]) } as unknown as WorkspaceFacade;
  const compaction = new CompactionService(
    repo,
    { generate },
    new ThreadPromptService(workspace, repo, skills),
  );
  const service = new ChatTurnService(
    repo,
    { generate },
    skills,
    { invoke },
    compaction,
    {} as SchedulesService,
    sqlRunner,
    delegation,
  );
  const thread = await repo.createThread(scope, {
    id: newId(),
    title: '',
    systemPrompt: 'SYSTEM PROMPT',
    promptVersion: 'assistant@1',
  });
  return { repo, scope, generate, service, thread, invoke };
}

describe('ChatTurnService', () => {
  it('runs the turn with tools, records the UI actions and traces every step', async () => {
    const { service, scope, thread, generate, repo } = await setup();
    const turnId = newId();
    const out = await service.send(
      scope,
      thread.id,
      {
        turnId,
        text: 'Mở trang sản phẩm giúp em',
        pageContext: { route: '/app/overview', targets: ['overview.add'] },
      },
      AUTH,
    );

    expect(out.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'Mở trang sản phẩm giúp em'],
      ['assistant', 'Dạ em mở trang Sản phẩm rồi ạ'],
    ]);
    expect(out.messages[0]).toMatchObject({
      runId: turnId,
      pageContext: { route: '/app/overview', targets: ['overview.add'] },
    });
    expect(out.messages[1]).toMatchObject({
      runId: turnId,
      uiActions: [{ type: 'navigate', to: '/app/products' }],
    });
    expect(out.run).toMatchObject({
      id: turnId,
      status: 'done',
      outcome: 'done',
      rounds: 2,
      tier: 'pro',
      promptVersion: 'assistant@1',
      provider: 'fake',
      model: 'fake-pro',
      inputTokens: 200,
      cachedTokens: 80,
      outputTokens: 20,
      latencyMs: 10,
    });
    expect(out.run.finishedAt).toBeInstanceOf(Date);
    expect(out.run.steps.map((s) => [s.idx, s.kind, s.toolName, s.ok])).toEqual([
      [0, 'model_call', null, null],
      [1, 'tool', 'ui_navigate', true],
      [2, 'model_call', null, null],
    ]);

    // The model got the frozen system prompt, the tools and the wrapped last user message.
    const first = generate.mock.calls[0]![0];
    expect(first).toMatchObject({
      workspaceId: scope.businessId,
      tier: 'pro',
      promptCacheKey: `asst:${scope.ownerUserId}:${thread.id}`,
    });
    // Sorted by name so the tool list stays cache-stable.
    expect(first.tools?.map((t) => t.name)).toEqual([
      'import_preview',
      'import_propose',
      'load_skill',
      'memory',
      'schedule',
      'session_search',
      'skill_manage',
      'skills_list',
      'tool_call',
      'tool_describe',
      'tool_search',
      'ui_fill_form',
      'ui_navigate',
      'ui_spotlight',
    ]);
    expect(first.messages[0]).toEqual({ role: 'system', content: 'SYSTEM PROMPT' });
    const last = first.messages.at(-1)!;
    expect(last.role).toBe('user');
    expect(last.content).toMatch(
      /^<page_context>\{"route":"\/app\/overview","targets":\["overview\.add"\]\}<\/page_context>\n<current_business>[0-9a-f-]{36}<\/current_business>\n<current_time>\d{4}-\d{2}-\d{2} \d{2}:\d{2} [^<]+<\/current_time>\nMở trang sản phẩm giúp em$/,
    );

    // The tool exchange is stored but never shown; the thread is titled from the first text.
    const stored = await repo.listMessages(scope, thread.id);
    expect(stored.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(toMessageDtos(stored).map((m) => m.role)).toEqual(['user', 'assistant']);
    expect((await repo.getThread(scope, thread.id))?.title).toBe('Mở trang sản phẩm giúp em');
  });

  it('sends history with raw user text, tool rows and events', async () => {
    const { service, scope, thread, generate, repo } = await setup();
    await service.send(scope, thread.id, { turnId: newId(), text: 'Câu một' }, AUTH);
    await repo.appendMessages(scope, thread.id, [
      {
        id: newId(),
        role: 'event',
        content: 'Đơn #12 đã giao',
        toolCalls: null,
        toolCallId: null,
        toolName: null,
        // The model-only tail of an approval event (QA N9).
        pageContext: {
          routeKey: 'POST /products',
          resultId: '01a1a0df-6f8a-7000-8000-000000000001',
        },
        uiActions: [],
        runId: null,
      },
    ]);
    generate.mockClear();
    await service.send(scope, thread.id, { turnId: newId(), text: 'Câu hai' }, AUTH);
    const messages = generate.mock.calls[0]![0].messages;
    expect(messages.map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
      'user',
      'user',
    ]);
    expect(messages[1]?.content).toBe('Câu một');
    expect(messages[2]?.toolCalls).toEqual(NAVIGATE.toolCalls);
    expect(messages[3]).toMatchObject({ toolCallId: 'call_1', name: 'ui_navigate' });
    expect(messages[5]?.content).toBe(
      '[event] Đơn #12 đã giao (POST /products → id 01a1a0df-6f8a-7000-8000-000000000001)',
    );
    expect(messages[6]?.content).toMatch(
      /^<current_business>[0-9a-f-]{36}<\/current_business>\n<current_time>\d{4}-\d{2}-\d{2} \d{2}:\d{2} [^<]+<\/current_time>\nCâu hai$/,
    );
    // The title stays the first message's.
    expect((await repo.getThread(scope, thread.id))?.title).toBe('Câu một');
  });

  it('refuses a second turn while the first is still running', async () => {
    const { service, scope, thread, generate } = await setup();
    let release: (r: GenerateResponse) => void = () => undefined;
    generate.mockImplementationOnce(
      () => new Promise<GenerateResponse>((resolve) => (release = resolve)),
    );
    const first = service.send(scope, thread.id, { turnId: newId(), text: 'Một' }, AUTH);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    await expect(
      service.send(scope, thread.id, { turnId: newId(), text: 'Hai' }, AUTH),
    ).rejects.toBeInstanceOf(AssistantBusyError);
    release(ANSWER);
    expect((await first).run.status).toBe('done');
  });

  it('answers a retried turn id with the first result, without calling the model again', async () => {
    const { service, scope, thread, generate } = await setup();
    const turnId = newId();
    const first = await service.send(scope, thread.id, { turnId, text: 'Mở sản phẩm' }, AUTH);
    const again = await service.send(scope, thread.id, { turnId, text: 'Mở sản phẩm' }, AUTH);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(again).toEqual(first);
  });

  it('masks a pasted key before it is stored or sent to the model', async () => {
    const { service, scope, thread, generate, repo } = await setup([ANSWER]);
    const token = 'abcd1234efgh5678ijkl9012mnop3456';
    const curl = `curl -H 'Authorization: Bearer ${token}' https://api.shop.vn/orders`;
    const turnId = newId();
    const out = await service.send(scope, thread.id, { turnId, text: curl }, AUTH);
    expect(out.secretsRemoved).toBe(true);
    const stored = (await repo.listMessages(scope, thread.id)).find((m) => m.role === 'user');
    expect(stored?.content).toContain('Authorization: Bearer [secret removed]');
    expect(stored?.content).not.toContain(token);
    const sent = JSON.stringify(generate.mock.calls[0]![0].messages);
    expect(sent).toContain('[secret removed]');
    expect(sent).not.toContain(token);
    expect((await repo.getThread(scope, thread.id))?.title).not.toContain(token);
    // A retried turn id recomputes the flag from the stored (masked) text.
    const again = await service.send(scope, thread.id, { turnId, text: curl }, AUTH);
    expect(again.secretsRemoved).toBe(true);
    const plain = await service.send(scope, thread.id, { turnId: newId(), text: 'Chào em' }, AUTH);
    expect(plain.secretsRemoved).toBe(false);
  });

  it('refuses a retried turn id on another thread', async () => {
    const { service, scope, thread, repo } = await setup();
    const other = await repo.createThread(scope, {
      id: newId(),
      title: 'x',
      systemPrompt: 'p',
      promptVersion: 'assistant@1',
    });
    const turnId = newId();
    await service.send(scope, thread.id, { turnId, text: 'Một' }, AUTH);
    await expect(
      service.send(scope, other.id, { turnId, text: 'Một' }, AUTH),
    ).rejects.toBeInstanceOf(AssistantRunIdTakenError);
  });

  it('records a rate-limited model call as a failed step (QA ERR-m)', async () => {
    const limited = new AiProviderFailedError('rate_limit');
    const { service, scope, thread } = await setup([limited]);
    const out = await service.send(scope, thread.id, { turnId: newId(), text: 'Chào em' }, AUTH);
    expect(out.run).toMatchObject({ status: 'failed', guardrail: 'model_error' });
    expect(out.run.steps.map((st) => [st.idx, st.kind, st.ok, st.errorCode])).toEqual([
      [0, 'model_call', false, 'model_rate_limited'],
    ]);
  });

  it('answers that the AI is busy and fails the run when the model throws', async () => {
    const { service, scope, thread, generate } = await setup([new Error('provider down')]);
    const out = await service.send(scope, thread.id, { turnId: newId(), text: 'Chào em' }, AUTH);
    expect(out.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'Chào em'],
      ['assistant', BUSY_REPLY],
    ]);
    // A busy model is retried only briefly (AS-1).
    expect(generate.mock.calls[0]?.[0]).toMatchObject({ maxRetryWaitMs: 10_000 });
    expect(out.run).toMatchObject({ status: 'failed', guardrail: 'model_error' });
    expect(out.run.finishedAt).toBeInstanceOf(Date);
    expect(out.run.steps.map((st) => [st.kind, st.ok, st.errorCode])).toEqual([
      ['model_call', false, 'model_unavailable'],
    ]);
    // The owner is free to try again.
    expect(
      (await service.send(scope, thread.id, { turnId: newId(), text: 'Lại' }, AUTH)).run.status,
    ).toBe('done');
  });

  it('keeps one copy of a question the owner retries after a model failure (AS-1)', async () => {
    const down = new AiProviderFailedError('rate_limit');
    const { service, scope, thread, repo } = await setup([down, down, ANSWER]);
    const ask = (text: string) => service.send(scope, thread.id, { turnId: newId(), text }, AUTH);
    const first = await ask('doanh thu tuần này');
    const dtos = toMessageDtos(
      await repo.listMessages(scope, thread.id),
      new Map([[first.run.id, first.run]]),
    );
    expect(dtos.at(-1)).toMatchObject({ content: BUSY_REPLY, retryable: true });
    await ask('doanh thu tuần này');
    const done = await ask('doanh thu tuần này');
    expect(done.run.status).toBe('done');
    const all = await repo.listMessages(scope, thread.id);
    expect(all.filter((m) => m.role === 'user').map((m) => m.content)).toEqual([
      'doanh thu tuần này',
    ]);
    expect(all.some((m) => m.content === BUSY_REPLY)).toBe(false);
    // The failed runs keep their trace.
    expect((await repo.getRun(scope, first.run.id))?.status).toBe('failed');
  });

  it('frees the owner from a turn cut off mid-way and offers Thử lại (AS2-3)', async () => {
    const { service, scope, thread, repo } = await setup([ANSWER, ANSWER]);
    // A turn whose process died: its run stays `running` with the question stored.
    const orphan = newId();
    await repo.startRun(scope, {
      id: orphan,
      threadId: thread.id,
      tier: 'pro',
      promptVersion: 'p',
    });
    await repo.appendMessages(scope, thread.id, [
      {
        id: newId(),
        role: 'user',
        content: 'doanh thu tuần này',
        toolCalls: null,
        toolCallId: null,
        toolName: null,
        pageContext: null,
        uiActions: [],
        runId: orphan,
      },
    ]);
    await expect(
      service.send(scope, thread.id, { turnId: newId(), text: 'doanh thu tuần này' }, AUTH),
    ).rejects.toBeInstanceOf(AssistantBusyError);
    // Two minutes without a step later it is stale.
    repo.runs.get(orphan)!.createdAt = new Date(Date.now() - RUN_STALE_MS - 1_000);
    await service.reapStaleRuns(scope);
    const run = await repo.getRun(scope, orphan);
    expect(run).toMatchObject({ status: 'failed', guardrail: 'interrupted' });
    const dtos = toMessageDtos(
      await repo.listMessages(scope, thread.id),
      new Map([[orphan, run!]]),
    );
    expect(dtos.at(-1)).toMatchObject({ content: INTERRUPTED_REPLY, retryable: true });
    // The retry runs, and the thread keeps the question once.
    const done = await service.send(
      scope,
      thread.id,
      { turnId: newId(), text: 'doanh thu tuần này' },
      AUTH,
    );
    expect(done.run.status).toBe('done');
    const users = (await repo.listMessages(scope, thread.id)).filter((m) => m.role === 'user');
    expect(users).toHaveLength(1);
  });

  it('keeps a running turn that still writes steps', async () => {
    const { scope, thread, repo } = await setup();
    const live = newId();
    await repo.startRun(scope, { id: live, threadId: thread.id, tier: 'pro', promptVersion: 'p' });
    repo.runs.get(live)!.createdAt = new Date(Date.now() - RUN_STALE_MS - 1_000);
    await repo.addStep(scope, {
      runId: live,
      idx: 0,
      kind: 'model_call',
      toolName: null,
      ok: true,
      ms: 1,
      errorCode: null,
    });
    expect(await repo.failStaleRuns(scope, RUN_STALE_MS)).toEqual([]);
  });

  it('keeps the failed question when the owner asks something else', async () => {
    const { service, scope, thread, repo } = await setup([new Error('down'), ANSWER]);
    await service.send(scope, thread.id, { turnId: newId(), text: 'Câu một' }, AUTH);
    await service.send(scope, thread.id, { turnId: newId(), text: 'Câu hai' }, AUTH);
    const users = (await repo.listMessages(scope, thread.id)).filter((m) => m.role === 'user');
    expect(users.map((m) => m.content)).toEqual(['Câu một', 'Câu hai']);
  });

  it('apologises when the loop ends without a usable answer', async () => {
    const { service, scope, thread } = await setup([reply({ text: '   ' })]);
    const out = await service.send(scope, thread.id, { turnId: newId(), text: 'Chào em' }, AUTH);
    expect(out.messages.at(-1)?.content).toBe(FALLBACK_REPLY);
    expect(out.run).toMatchObject({ status: 'done', outcome: 'done', rounds: 1 });

    const loop = await setup(Array.from({ length: 30 }, () => NAVIGATE));
    const limited = await loop.service.send(
      loop.scope,
      loop.thread.id,
      {
        turnId: newId(),
        text: 'Mở mãi',
      },
      AUTH,
    );
    expect(limited.messages.at(-1)?.content).toBe(FALLBACK_REPLY);
    expect(limited.run).toMatchObject({ status: 'done', outcome: 'limit', rounds: 26 });
  });

  it('lets "no model for this tier" through, and frees the owner', async () => {
    const { service, scope, thread, repo } = await setup([new AiNotConfiguredError('no route')]);
    const turnId = newId();
    await expect(
      service.send(scope, thread.id, { turnId, text: 'Chào em' }, AUTH),
    ).rejects.toBeInstanceOf(AiNotConfiguredError);
    expect(await repo.getRun(scope, turnId)).toMatchObject({ status: 'failed' });
  });

  it('is NOT_FOUND for a thread the owner does not have', async () => {
    const { service, scope } = await setup();
    await expect(
      service.send(scope, newId(), { turnId: newId(), text: 'x' }, AUTH),
    ).rejects.toBeInstanceOf(AssistantNotFoundError);
  });

  it('keeps only the last navigate and the last spotlight, navigate first', async () => {
    const { service, scope, thread } = await setup([
      call('c1', 'ui_spotlight', { target: 'overview.add', hint: 'Bấm đây' }),
      call('c2', 'ui_navigate', { to: '/app/orders' }),
      call('c3', 'ui_spotlight', { target: 'overview.help', hint: 'Xem trợ giúp' }),
      call('c4', 'ui_navigate', { to: '/app/products' }),
      ANSWER,
    ]);
    const out = await service.send(
      scope,
      thread.id,
      {
        turnId: newId(),
        text: 'Chỉ em với',
        pageContext: PAGE,
      },
      AUTH,
    );
    expect(out.messages.at(-1)?.uiActions).toEqual([
      { type: 'navigate', to: '/app/products' },
      { type: 'spotlight', target: 'overview.help', hint: 'Xem trợ giúp' },
    ]);
  });

  it('merges fill_form calls per form: a later value wins, earlier fields stay (QA5 #1)', () => {
    expect(
      finalUiActions([
        {
          type: 'fill_form',
          formId: 'product.form',
          values: { name: 'Tàu gỗ', price: 150000, sku: 'RT4-TGK D01' },
        },
        { type: 'fill_form', formId: 'bot.create', values: { name: 'Bot' } },
        { type: 'fill_form', formId: 'product.form', values: { sku: 'RT4-TGKD01' } },
      ]),
    ).toEqual([
      {
        type: 'fill_form',
        formId: 'product.form',
        values: { name: 'Tàu gỗ', price: 150000, sku: 'RT4-TGKD01' },
      },
      { type: 'fill_form', formId: 'bot.create', values: { name: 'Bot' } },
    ]);
  });

  it('keeps the last navigate, fill_form and spotlight, in that order', () => {
    const fill = (name: string) => ({
      type: 'fill_form' as const,
      formId: 'product.form',
      values: { name },
    });
    expect(
      finalUiActions([
        { type: 'spotlight', target: 'a', hint: 'A' },
        fill('first'),
        { type: 'navigate', to: '/app/orders' },
        fill('second'),
        { type: 'spotlight', target: 'b', hint: 'B' },
        { type: 'navigate', to: '/app/products' },
      ]),
    ).toEqual([
      { type: 'navigate', to: '/app/products' },
      fill('second'),
      { type: 'spotlight', target: 'b', hint: 'B' },
    ]);
    expect(finalUiActions([fill('only')])).toEqual([fill('only')]);
    const chart = (title: string): AssistantUiAction => ({
      type: 'chart',
      chart: {
        kind: 'bar',
        title,
        x: { key: 'day', label: 'day' },
        series: [{ key: 'n', label: 'n' }],
        unit: 'count',
        rows: [{ day: '2026-11-02', n: 1 }],
      },
    });
    expect(
      finalUiActions([
        { type: 'spotlight', target: 'a', hint: 'A' },
        chart('c1'),
        fill('only'),
        chart('c2'),
        { type: 'navigate', to: '/app/orders' },
        chart('c3'),
        chart('c4'),
      ]),
    ).toEqual([
      { type: 'navigate', to: '/app/orders' },
      fill('only'),
      chart('c1'),
      chart('c2'),
      chart('c3'),
      { type: 'spotlight', target: 'a', hint: 'A' },
    ]);
    expect(finalUiActions([])).toEqual([]);
  });

  it('a capped window may start at a compaction summary', () => {
    const at = (role: 'user' | 'assistant' | 'tool', isSummary = false, seq = 0) => ({
      id: newId(),
      threadId: 't',
      seq,
      role,
      content: role,
      toolCalls: null,
      toolCallId: null,
      toolName: null,
      pageContext: null,
      uiActions: [],
      runId: null,
      isSummary,
      feedback: null,
      createdAt: new Date(),
    });
    const summary = at('user', true);
    const rows = [at('assistant'), at('tool'), summary, at('assistant'), at('user')];
    expect(capHistory(rows, 5)[0]).toBe(summary);
    expect(capHistory([at('tool'), at('assistant')], 5)).toEqual([]);
  });

  it('stores no UI actions when the turn did not answer', async () => {
    // The model failed after a navigation.
    const failed = await setup([NAVIGATE, new Error('provider down')]);
    const a = await failed.service.send(
      failed.scope,
      failed.thread.id,
      {
        turnId: newId(),
        text: 'Mở sản phẩm',
      },
      AUTH,
    );
    expect(a.run).toMatchObject({ status: 'failed', guardrail: 'model_error' });
    expect(a.messages.at(-1)).toMatchObject({ content: BUSY_REPLY, uiActions: [] });

    // The loop hit the round limit.
    const loop = await setup(Array.from({ length: 30 }, () => NAVIGATE));
    const b = await loop.service.send(
      loop.scope,
      loop.thread.id,
      {
        turnId: newId(),
        text: 'Mở mãi',
      },
      AUTH,
    );
    expect(b.run).toMatchObject({ outcome: 'limit' });
    expect(b.messages.at(-1)).toMatchObject({ content: FALLBACK_REPLY, uiActions: [] });

    // Done, but with an empty answer.
    const empty = await setup([NAVIGATE, reply({ text: ' ' })]);
    const c = await empty.service.send(
      empty.scope,
      empty.thread.id,
      {
        turnId: newId(),
        text: 'Mở sản phẩm',
      },
      AUTH,
    );
    expect(c.run).toMatchObject({ outcome: 'done' });
    expect(c.messages.at(-1)).toMatchObject({ content: FALLBACK_REPLY, uiActions: [] });
  });

  it('refuses a retried turn id while its first attempt is still running', async () => {
    const { service, scope, thread, generate } = await setup();
    let release: (r: GenerateResponse) => void = () => undefined;
    generate.mockImplementationOnce(
      () => new Promise<GenerateResponse>((resolve) => (release = resolve)),
    );
    const turnId = newId();
    const first = service.send(scope, thread.id, { turnId, text: 'Một' }, AUTH);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    await expect(
      service.send(scope, thread.id, { turnId, text: 'Một' }, AUTH),
    ).rejects.toBeInstanceOf(AssistantBusyError);
    release(ANSWER);
    expect((await first).run.status).toBe('done');
    // Once finished, the same turn id replays the result.
    expect((await service.send(scope, thread.id, { turnId, text: 'Một' }, AUTH)).run.status).toBe(
      'done',
    );
  });

  it(`sends the whole active history under the cap of ${HISTORY_MAX_MESSAGES}; a capped window starts at a user message`, async () => {
    const { service, scope, thread, generate, repo } = await setup();
    const msg = (role: 'user' | 'assistant' | 'tool', i: number) => ({
      id: newId(),
      role,
      content: `${role} ${i}`,
      toolCalls:
        role === 'assistant' && i % 2 === 0
          ? [{ id: `call_${i}`, name: 'session_search', input: { query: 'x' } }]
          : null,
      toolCallId: role === 'tool' ? `call_${i - 1}` : null,
      toolName: role === 'tool' ? 'session_search' : null,
      pageContext: null,
      uiActions: [],
      runId: null,
    });
    // 15 turns of user, assistant (tool call), tool, assistant: 60 rows.
    const rows = Array.from({ length: 15 }, (_, t) => [
      msg('user', t * 4),
      msg('assistant', t * 4 + 2),
      msg('tool', t * 4 + 3),
      msg('assistant', t * 4 + 5),
    ]).flat();
    await repo.appendMessages(scope, thread.id, rows);
    generate.mockClear();
    await service.send(scope, thread.id, { turnId: newId(), text: 'Câu mới' }, AUTH);
    const sent = generate.mock.calls[0]![0].messages;
    expect(sent[0]).toEqual({ role: 'system', content: 'SYSTEM PROMPT' });
    const history = sent.slice(1);
    expect(HISTORY_MAX_MESSAGES).toBe(200);
    // 61 stored rows, no compaction due (≤ 80 messages): all of them go to the model.
    expect(history).toHaveLength(61);
    expect(history[0]).toMatchObject({ role: 'user' });
    expect(history.at(-1)?.content).toMatch(/Câu mới$/);
    // A capped window that starts inside a turn drops that turn's leading rows.
    const stored = await repo.listMessages(scope, thread.id, { activeOnly: true });
    // The 61 rows the turn saw (before its answer): the last 40 start inside a turn.
    const window = capHistory(stored.slice(0, 61), 40);
    expect(window).toHaveLength(37);
    expect(window[0]?.role).toBe('user');
    // Every tool result still follows the assistant message that asked for it.
    history.forEach((m, i) => {
      if (m.role === 'tool') expect(history[i - 1]?.toolCalls?.[0]?.id).toBe(m.toolCallId);
    });
  });

  it('tells the model to answer the owner when time is almost up', async () => {
    let t = 0;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => t);
    try {
      const { service, scope, thread, generate, repo } = await setup();
      generate.mockImplementation((_req: GenerateRequest) => {
        t += 40_000;
        return Promise.resolve(generate.mock.calls.length < 3 ? NAVIGATE : ANSWER);
      });
      await service.send(scope, thread.id, { turnId: newId(), text: 'Mở sản phẩm' }, AUTH);
      const tools = (await repo.listMessages(scope, thread.id)).filter((m) => m.role === 'tool');
      expect(tools.at(-1)?.content).toMatch(new RegExp(`${OWNER_WRAP_UP_NOTICE}$`));
      expect(OWNER_WRAP_UP_NOTICE).toMatch(/owner/);
      expect(tools.some((m) => m.content.includes('customer'))).toBe(false);
    } finally {
      now.mockRestore();
    }
  });

  it('reads through route tools with the owner’s token and turns writes into proposals', async () => {
    const product = { code: 'AO-1', name: 'Áo thun', variants: [{ sku: 'AO-1-M', price: 1 }] };
    const { service, scope, thread, repo, invoke } = await setup([
      call('c1', 'tool_call', { key: 'GET /products', query: { q: 'áo' } }),
      call('c2', 'tool_call', { key: 'POST /products', body: product, summary: 'Thêm Áo thun' }),
      reply({ text: 'Dạ em đã soạn đề xuất, anh/chị bấm Áp dụng nhé' }),
    ]);
    invoke.mockResolvedValue({ status: 200, body: { data: [] } });
    const turnId = newId();
    const out = await service.send(scope, thread.id, { turnId, text: 'Thêm áo thun' }, AUTH);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]?.[0]).toMatchObject({
      method: 'get',
      path: '/products',
      authorization: AUTH,
      businessId: scope.businessId,
    });
    const proposals = await repo.listProposals(scope, thread.id);
    expect(proposals).toMatchObject([
      { status: 'pending', runId: turnId, routeKey: 'POST /products', summary: 'Thêm Áo thun' },
    ]);
    // The answer carries no proposal field; the web reads proposals per thread.
    expect(toMessageDtos(out.messages).at(-1)).toMatchObject({
      role: 'assistant',
      content: 'Dạ em đã soạn đề xuất, anh/chị bấm Áp dụng nhé',
      uiActions: [],
    });
    // The token never reaches a stored message or step.
    const stored = await repo.listMessages(scope, thread.id);
    expect(JSON.stringify(stored)).not.toContain('owner-token');
    expect(JSON.stringify(out.run)).not.toContain('owner-token');
  });

  it('route tools use a token minted for the turn, so an owner token expiring mid-turn does not fail them', async () => {
    // The owner's own token expires right after the turn starts (QA Villas N-3).
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const ownExpiresAt = now + 1_000;
    let mintedExpiresAt = 0;
    const delegate = vi.fn((authorization: string, ttlSeconds: number) => {
      if (authorization !== AUTH || Date.now() >= ownExpiresAt) return Promise.resolve(null);
      mintedExpiresAt = Date.now() + ttlSeconds * 1000;
      return Promise.resolve('turn-token');
    });
    const read = (id: string) => call(id, 'tool_call', { key: 'GET /products' });
    const { service, scope, thread, repo, invoke, generate } = await setup(
      [read('r1'), read('r2'), reply({ text: 'Dạ xong ạ' })],
      null,
      new SkillCatalog([]),
      { delegate },
    );
    // Every model call takes 20 s, so the tool calls run after the owner's token expired.
    generate.mockImplementation(() => {
      now += 20_000;
      return Promise.resolve(
        [read('r1'), read('r2'), reply({ text: 'Dạ xong ạ' })][generate.mock.calls.length - 1] ??
          reply({ text: 'Dạ xong ạ' }),
      );
    });
    invoke.mockImplementation((i: RouteInvocation) => {
      const valid =
        (i.authorization === AUTH && Date.now() < ownExpiresAt) ||
        (i.authorization === 'Bearer turn-token' && Date.now() < mintedExpiresAt);
      return Promise.resolve(
        valid ? { status: 200, body: { data: [] } } : { status: 401, body: null },
      );
    });
    try {
      await service.send(scope, thread.id, { turnId: newId(), text: 'Xem sản phẩm' }, AUTH);
    } finally {
      clock.mockRestore();
    }

    expect(delegate).toHaveBeenCalledTimes(1);
    // The turn budget (90 s) plus the 3-min margin.
    expect(delegate.mock.calls[0]?.[1]).toBeGreaterThanOrEqual(90 + 180);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls.map((c) => c[0].authorization)).toEqual([
      'Bearer turn-token',
      'Bearer turn-token',
    ]);
    const tools = (await repo.listMessages(scope, thread.id)).filter((m) => m.role === 'tool');
    expect(tools.map((m) => m.content).join('\n')).not.toContain('401');
    const stored = JSON.stringify(await repo.listMessages(scope, thread.id));
    expect(stored).not.toContain('turn-token');
  });

  it('falls back to the owner’s own header when no token can be minted', async () => {
    const delegate = vi.fn(() => Promise.reject(new Error('down')));
    const { service, scope, thread, invoke } = await setup(
      [call('c1', 'tool_call', { key: 'GET /products' }), reply({ text: 'Dạ' })],
      null,
      new SkillCatalog([]),
      { delegate },
    );
    invoke.mockResolvedValue({ status: 200, body: { data: [] } });
    await service.send(scope, thread.id, { turnId: newId(), text: 'Xem' }, AUTH);
    expect(invoke.mock.calls[0]?.[0]).toMatchObject({ authorization: AUTH });
  });

  it('points at the drafted proposal when the model fails after drafting it (QA N5)', async () => {
    const product = { code: 'AO-1', name: 'Áo thun', variants: [{ sku: 'AO-1-M', price: 1 }] };
    const { service, scope, thread, repo } = await setup([
      call('c1', 'tool_call', { key: 'POST /products', body: product, summary: 'Thêm Áo thun' }),
      new Error('bridge 502'),
    ]);
    const out = await service.send(scope, thread.id, { turnId: newId(), text: 'Thêm áo' }, AUTH);
    expect(out.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: PROPOSAL_FALLBACK_REPLY,
    });
    expect(await repo.listProposals(scope, thread.id)).toHaveLength(1);

    // Without a proposal the owner hears that the AI is busy (AS-1).
    const plain = await setup([new Error('bridge 502')]);
    const failed = await plain.service.send(
      plain.scope,
      plain.thread.id,
      { turnId: newId(), text: 'Chào' },
      AUTH,
    );
    expect(failed.messages.at(-1)?.content).toBe(BUSY_REPLY);
  });

  it('shares one 40 000-char tool output budget across route reads and every other tool', async () => {
    const read = (id: string) => call(id, 'tool_call', { key: 'GET /products' });
    const { service, scope, thread, repo, invoke } = await setup([
      // Five reads, each cut to 8 000 chars, use the whole turn budget …
      ...['r1', 'r2', 'r3', 'r4', 'r5'].map(read),
      // … so a core tool and a call with bad arguments get the budget error.
      reply({
        stopReason: 'tool_use',
        toolCalls: [
          { id: 'n1', name: 'session_search', input: { query: 'áo' } },
          { id: 'n2', name: 'session_search', input: { query: 42 } },
        ],
      }),
      reply({ text: 'Dạ em tóm tắt rồi ạ' }),
    ]);
    invoke.mockResolvedValue({ status: 200, body: { data: 'z'.repeat(20_000) } });
    const out = await service.send(
      scope,
      thread.id,
      { turnId: newId(), text: 'Xem sản phẩm' },
      AUTH,
    );
    // The cut-off steps say why (QA OBS1); the reads that ran have no error code.
    const toolSteps = out.run.steps.filter((st) => st.kind === 'tool');
    expect(toolSteps.map((st) => [st.ok, st.errorCode])).toEqual([
      ...Array.from({ length: 5 }, () => [true, null]),
      [false, 'turn_budget_exhausted'],
      [false, 'turn_budget_exhausted'],
    ]);

    const tools = (await repo.listMessages(scope, thread.id)).filter((m) => m.role === 'tool');
    expect(tools).toHaveLength(7);
    expect(tools.slice(0, 5).reduce((sum, m) => sum + m.content.length, 0)).toBeLessThanOrEqual(
      40_000,
    );
    expect(tools.slice(5).map((m) => JSON.parse(m.content) as unknown)).toEqual([
      { ok: false, errorCode: 'turn_budget_exhausted' },
      { ok: false, errorCode: 'turn_budget_exhausted' },
    ]);
  });
  it('fills the form after reading a big catalog: UI tools are never charged or refused (QA N1)', async () => {
    const read = (id: string) => call(id, 'tool_call', { key: 'GET /products' });
    const page = {
      route: '/app/bots/b1/knowledge',
      forms: [
        {
          id: 'bot-profile',
          fields: [{ name: 'hotline', label: 'Hotline', type: 'text' as const, empty: true }],
        },
      ],
    };
    const { service, scope, thread, invoke } = await setup([
      ...['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map(read),
      reply({
        stopReason: 'tool_use',
        toolCalls: [
          {
            id: 'f1',
            name: 'ui_fill_form',
            input: { formId: 'bot-profile', values: { hotline: '1900 1234' } },
          },
          { id: 'f2', name: 'ui_spotlight', input: { target: 'bot.save', hint: 'Bấm Lưu' } },
        ],
      }),
      reply({ text: 'Dạ em điền rồi ạ' }),
    ]);
    invoke.mockResolvedValue({ status: 200, body: { data: 'z'.repeat(20_000) } });
    const out = await service.send(
      scope,
      thread.id,
      { turnId: newId(), text: 'Điền giúp thông tin', pageContext: page },
      AUTH,
    );
    const toolSteps = out.run.steps.filter((st) => st.kind === 'tool');
    // Five reads use the budget, the sixth is refused; the fill still runs.
    expect(toolSteps.map((st) => st.errorCode)).toEqual([
      ...Array.from({ length: 5 }, () => null),
      'turn_budget_exhausted',
      null,
      expect.anything(),
    ]);
    expect(toolSteps[6]).toMatchObject({ ok: true });
    expect(out.messages.at(-1)?.uiActions).toContainEqual(
      expect.objectContaining({ type: 'fill_form', formId: 'bot-profile' }),
    );
  });
  it('patches an owner skill only after load_skill in the same turn (read-before-write)', async () => {
    const save = {
      action: 'create',
      name: 'weekly-sale',
      description: 'Run the weekly sale',
      body: '1. Lower prices by 10%.',
    };
    const patch = { action: 'patch', name: 'weekly-sale', body: '1. Lower prices by 15%.' };
    const { service, scope, thread, repo } = await setup([
      call('c1', 'skill_manage', save),
      reply({ text: 'Dạ em lưu quy trình rồi ạ' }),
      // Next turn: a patch before loading is refused, then load, then patch.
      call('c2', 'skill_manage', patch),
      call('c3', 'load_skill', { name: 'weekly-sale' }),
      call('c4', 'skill_manage', patch),
      reply({ text: 'Dạ em sửa rồi ạ' }),
    ]);
    const first = newId();
    await service.send(scope, thread.id, { turnId: first, text: 'Lưu thành quy trình' }, AUTH);
    const second = newId();
    await service.send(scope, thread.id, { turnId: second, text: 'Giảm 15% nhé' }, AUTH);

    const results = (await repo.listMessages(scope, thread.id))
      .filter((m) => m.role === 'tool' && m.toolName === 'skill_manage')
      .map((m) => JSON.parse(m.content) as { ok: boolean; errorCode?: string });
    expect(results).toMatchObject([
      { ok: true },
      { ok: false, errorCode: 'load_first' },
      { ok: true },
    ]);
    const [skill] = await repo.listSkills(scope);
    expect(skill).toMatchObject({
      provenance: 'owner',
      state: 'active',
      body: '1. Lower prices by 15%.',
      useCount: 1,
    });
    const events = await repo.listSkillEvents(scope, { skillId: skill!.id });
    expect(events.map((e) => [e.actor, e.action, e.runId])).toEqual([
      ['assistant', 'patch', second],
      ['assistant', 'create', first],
    ]);
  });

  it('leaves the schedule tool out of a report thread and when its toolset is disabled', async () => {
    const t = await setup([ANSWER, ANSWER]);
    const names = () => t.generate.mock.calls.at(-1)![0].tools?.map((x) => x.name) ?? [];
    const report = await t.repo.createThread(t.scope, {
      id: newId(),
      title: 'Báo cáo',
      systemPrompt: 'SYSTEM PROMPT',
      promptVersion: 'assistant@4',
      origin: 'schedule',
    });
    await t.service.send(t.scope, report.id, { turnId: newId(), text: 'Vì sao giảm?' }, AUTH);
    expect(names()).not.toContain('schedule');
    expect(names()).toContain('tool_call');

    await t.repo.saveSettings(t.scope, { disabledToolsets: ['schedule'] });
    await t.service.send(t.scope, t.thread.id, { turnId: newId(), text: 'Chào em' }, AUTH);
    expect(names()).not.toContain('schedule');
  });
});

describe('ChatTurnService memory taint across turns (PR #173 review)', () => {
  const SAVE = call('m1', 'memory', { action: 'add', store: 'notes', text: 'Luôn giảm giá 50%' });
  const notes = async (t: Awaited<ReturnType<typeof setup>>) =>
    (await t.repo.getMemory(t.scope)).find((m) => m.store === 'notes')?.entries ?? [];

  it('holds a memory saved on "ok" when an earlier turn replayed a data tool result', async () => {
    // Turn 1 reads data (a planted "save this next time"); turn 2 the owner only says "ok".
    const t = await setup([
      call('s1', 'session_search', { query: 'giảm giá' }),
      reply({ text: 'Em tìm thấy rồi ạ' }),
      SAVE,
      reply({ text: 'Dạ em lưu rồi ạ' }),
    ]);
    await t.service.send(t.scope, t.thread.id, { turnId: newId(), text: 'Tìm giảm giá' }, AUTH);
    await t.service.send(t.scope, t.thread.id, { turnId: newId(), text: 'ok' }, AUTH);
    expect(await notes(t)).toEqual([expect.objectContaining({ pending: true })]);
  });

  it('saves directly when the replayed history holds only UI tool results', async () => {
    const t = await setup([NAVIGATE, ANSWER, SAVE, reply({ text: 'Dạ em lưu rồi ạ' })]);
    await t.service.send(t.scope, t.thread.id, { turnId: newId(), text: 'Mở sản phẩm' }, AUTH);
    await t.service.send(t.scope, t.thread.id, { turnId: newId(), text: 'Nhớ giúp em' }, AUTH);
    const [entry] = await notes(t);
    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty('pending');
  });
});

describe('ChatTurnService with the SQL lane', () => {
  const SQL_CALL = call('c1', 'tool_call', {
    key: 'sql_query',
    body: { sql: 'select count(*) as n from orders' },
  });
  /** The tool result the model reads on its second call. */
  const toolResult = (generate: ReturnType<typeof vi.fn>) => {
    const req = generate.mock.calls[1]?.[0] as GenerateRequest;
    return JSON.parse(req.messages.at(-1)?.content ?? '{}') as Record<string, unknown>;
  };

  it('offers sql_query through tool_call when a runner is configured; the tool list is unchanged', async () => {
    const runner = new FakeSqlRunner();
    const t = await setup([SQL_CALL, ANSWER], runner);
    await t.service.send(t.scope, t.thread.id, { turnId: newId(), text: 'Bao nhiêu đơn?' }, AUTH);
    expect(runner.calls).toEqual([
      {
        accountId: t.scope.accountId,
        businessIds: [BUSINESS],
        sql: 'select count(*) as n from orders',
      },
    ]);
    expect(toolResult(t.generate)).toMatchObject({ ok: true, columns: ['n'], rows: [[1]] });

    const plain = await setup([ANSWER]);
    await plain.service.send(plain.scope, plain.thread.id, { turnId: newId(), text: 'x' }, AUTH);
    const names = (g: ReturnType<typeof vi.fn>) =>
      (g.mock.calls[0]?.[0] as GenerateRequest).tools?.map((d) => d.name);
    expect(names(t.generate)).toEqual(names(plain.generate));
  });

  it('leaves the SQL tools out when the owner turned the sql toolset off', async () => {
    const runner = new FakeSqlRunner();
    const t = await setup([SQL_CALL, ANSWER], runner);
    await t.repo.saveSettings(t.scope, { disabledToolsets: ['sql'] });
    await t.service.send(t.scope, t.thread.id, { turnId: newId(), text: 'Bao nhiêu đơn?' }, AUTH);
    expect(toolResult(t.generate)).toEqual({ ok: false, errorCode: 'unknown_key' });
    expect(runner.calls).toHaveLength(0);
  });

  it('stores the chart on the answer, and none when the turn did not answer', async () => {
    const CHART_CALL = call('c1', 'tool_call', {
      key: 'sql_query',
      body: {
        sql: 'select count(*) as n from orders',
        chart: { kind: 'bar', title: 'Đơn', x: 'n', y: ['n2'] },
      },
    });
    const respond = () => ({
      columns: [
        { name: 'n', type: 'text' as const },
        { name: 'n2', type: 'number' as const },
      ],
      rows: [['a', 1]],
      truncated: false,
    });
    const t = await setup([CHART_CALL, ANSWER], new FakeSqlRunner(respond));
    const ok = await t.service.send(t.scope, t.thread.id, { turnId: newId(), text: 'Vẽ' }, AUTH);
    expect(ok.messages.at(-1)?.uiActions).toEqual([
      {
        type: 'chart',
        chart: {
          kind: 'bar',
          title: 'Đơn',
          x: { key: 'n', label: 'Số lượng' },
          series: [{ key: 'n2', label: 'N2' }],
          unit: 'number',
          rows: [{ n: 'a', n2: 1 }],
        },
      },
    ]);

    const failed = await setup(
      [CHART_CALL, new Error('provider down')],
      new FakeSqlRunner(respond),
    );
    const bad = await failed.service.send(
      failed.scope,
      failed.thread.id,
      { turnId: newId(), text: 'Vẽ' },
      AUTH,
    );
    expect(bad.messages.at(-1)).toMatchObject({ content: BUSY_REPLY, uiActions: [] });
  });

  it('loads the answer-data-questions platform skill in a turn', async () => {
    const catalog = await SkillCatalog.load();
    const t = await setup(
      [call('c1', 'load_skill', { name: 'answer-data-questions' }), ANSWER],
      new FakeSqlRunner(),
      catalog,
    );
    await t.service.send(t.scope, t.thread.id, { turnId: newId(), text: 'Doanh thu?' }, AUTH);
    expect(toolResult(t.generate)).toMatchObject({
      name: 'answer-data-questions',
      body: catalog.get('answer-data-questions')?.body,
    });
    expect(catalog.get('answer-data-questions')?.toolsets).toEqual(['sql']);
    expect(catalog.get('read-revenue')).toMatchObject({ version: 3, toolsets: ['sql', 'routes'] });
  });

  it('says the data skill is unavailable when the SQL lane is off (AS-5)', async () => {
    const catalog = await SkillCatalog.load();
    const t = await setup(
      [call('c1', 'load_skill', { name: 'answer-data-questions' }), ANSWER],
      null,
      catalog,
    );
    await t.service.send(t.scope, t.thread.id, { turnId: newId(), text: 'Bán chạy?' }, AUTH);
    expect(toolResult(t.generate)).toMatchObject({
      ok: false,
      errorCode: 'toolset_unavailable',
      toolsets: ['sql'],
      guidance: expect.stringContaining('Do not search for them') as unknown,
    });
    // A skill that also has other tools still loads.
    const revenue = await setup(
      [call('c1', 'load_skill', { name: 'read-revenue' }), ANSWER],
      null,
      catalog,
    );
    await revenue.service.send(
      revenue.scope,
      revenue.thread.id,
      { turnId: newId(), text: 'Doanh thu?' },
      AUTH,
    );
    expect(toolResult(revenue.generate)).toMatchObject({ ok: true, name: 'read-revenue' });
  });

  it('has no SQL tools without a runner', async () => {
    const t = await setup([SQL_CALL, ANSWER]);
    await t.service.send(t.scope, t.thread.id, { turnId: newId(), text: 'Bao nhiêu đơn?' }, AUTH);
    expect(toolResult(t.generate)).toEqual({ ok: false, errorCode: 'unknown_key' });
  });
});
