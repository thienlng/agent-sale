import type { GenerateRequest, GenerateResponse } from '@agent-sales/ai-core';
import { DomainError, newId, userId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  ChatTurnService,
  FALLBACK_REPLY,
  capHistory,
  finalUiActions,
  HISTORY_MAX_MESSAGES,
  OWNER_WRAP_UP_NOTICE,
} from '../application/chat-turn.service.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import { CompactionService } from '../application/compaction.service.js';
import { toMessageDtos } from '../application/mappers.js';
import { SkillCatalog } from '../application/skill-tools.js';
import { ThreadPromptService } from '../application/thread-prompt.service.js';
import {
  AssistantBusyError,
  AssistantNotFoundError,
  AssistantRunIdTakenError,
} from '../domain/assistant.errors.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import type { RouteInvocation, RouteInvocationResult } from '../domain/ports/route-invoker.port.js';
import { InMemoryAssistantRepository } from '../infrastructure/persistence/assistant.in-memory-repository.js';

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

async function setup(script: (GenerateResponse | Error)[] = [NAVIGATE, ANSWER]) {
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
  const skills = new SkillCatalog([]);
  const workspace = { listMemberships: () => Promise.resolve([]) } as unknown as WorkspaceFacade;
  const compaction = new CompactionService(
    repo,
    { generate },
    new ThreadPromptService(workspace, repo, skills),
  );
  const service = new ChatTurnService(repo, { generate }, skills, { invoke }, compaction);
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
      'load_skill',
      'memory',
      'session_search',
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
      /^<page_context>\{"route":"\/app\/overview","targets":\["overview\.add"\]\}<\/page_context>\n<current_business>[0-9a-f-]{36}<\/current_business>\n<current_time>\d{2}:\d{2}<\/current_time>\nMở trang sản phẩm giúp em$/,
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
        pageContext: null,
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
    expect(messages[5]?.content).toBe('[event] Đơn #12 đã giao');
    expect(messages[6]?.content).toMatch(
      /^<current_business>[0-9a-f-]{36}<\/current_business>\n<current_time>\d{2}:\d{2}<\/current_time>\nCâu hai$/,
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

  it('answers with an apology and fails the run when the model throws', async () => {
    const { service, scope, thread } = await setup([new Error('provider down')]);
    const out = await service.send(scope, thread.id, { turnId: newId(), text: 'Chào em' }, AUTH);
    expect(out.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'Chào em'],
      ['assistant', FALLBACK_REPLY],
    ]);
    expect(out.run).toMatchObject({ status: 'failed', guardrail: 'model_error' });
    expect(out.run.finishedAt).toBeInstanceOf(Date);
    // The owner is free to try again.
    expect(
      (await service.send(scope, thread.id, { turnId: newId(), text: 'Lại' }, AUTH)).run.status,
    ).toBe('done');
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
    expect(a.messages.at(-1)).toMatchObject({ content: FALLBACK_REPLY, uiActions: [] });

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

  it('shares one 40 000-char tool output budget across route reads and every other tool', async () => {
    const read = (id: string) => call(id, 'tool_call', { key: 'GET /products' });
    const { service, scope, thread, repo, invoke } = await setup([
      // Five reads, each cut to 8 000 chars, use the whole turn budget …
      ...['r1', 'r2', 'r3', 'r4', 'r5'].map(read),
      // … so a core tool and a call with bad arguments get the budget error.
      reply({
        stopReason: 'tool_use',
        toolCalls: [
          { id: 'n1', name: 'ui_navigate', input: { to: '/app/products' } },
          { id: 'n2', name: 'ui_navigate', input: { to: 42 } },
        ],
      }),
      reply({ text: 'Dạ em tóm tắt rồi ạ' }),
    ]);
    invoke.mockResolvedValue({ status: 200, body: { data: 'z'.repeat(20_000) } });
    await service.send(scope, thread.id, { turnId: newId(), text: 'Xem sản phẩm' }, AUTH);

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
});
