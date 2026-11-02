import {
  COMPACTION_SUMMARY_PREFIX,
  PRUNED_TOOL_TEXT,
  type GenerateRequest,
  type GenerateResponse,
} from '@agent-sales/ai-core';
import { newId, userId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import type { WorkspaceFacade } from '../../workspace/api/index.js';
import { ChatTurnService, FALLBACK_REPLY } from '../application/chat-turn.service.js';
import {
  COMPACTION_COOLDOWN_MS,
  COMPACTION_THRASH_EXPIRES_MS,
  CompactionService,
  lastPromptTokens,
} from '../application/compaction.service.js';
import { isVisibleMessage, toMessageDtos } from '../application/mappers.js';
import { SkillCatalog } from '../application/skill-tools.js';
import { SkillsService } from '../application/skills.service.js';
import { ThreadPromptService } from '../application/thread-prompt.service.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import type { NewMessage, RunRecord } from '../domain/ports/assistant.repository.js';
import { InMemoryAssistantRepository } from '../infrastructure/persistence/assistant.in-memory-repository.js';

const BUSINESS = workspaceId(newId());
const SUMMARY_TEXT = '## Goal\nBán áo thun\n## Open questions\nNone';
const ANSWER = 'Dạ em đây ạ';

const reply = (text: string, over: Partial<GenerateResponse> = {}): GenerateResponse => ({
  text,
  toolCalls: [],
  stopReason: 'end',
  usage: { inputTokens: 1_000, outputTokens: 200, cachedInputTokens: 0 },
  provider: 'fake',
  model: 'fake-basic',
  latencyMs: 3,
  ...over,
});

const msg = (role: NewMessage['role'], content: string): NewMessage => ({
  id: newId(),
  role,
  content,
  toolCalls: null,
  toolCallId: null,
  toolName: null,
  pageContext: null,
  uiActions: [],
  runId: null,
});

/** `turns` owner/assistant pairs with long-ish text, so the summary saves space. */
const conversation = (turns: number, from = 0): NewMessage[] =>
  Array.from({ length: turns }, (_, i) => [
    msg('user', `câu hỏi ${from + i} ${'x'.repeat(200)}`),
    msg('assistant', `trả lời ${from + i} ${'y'.repeat(200)}`),
  ]).flat();

const lastRun = (over: Partial<RunRecord>): RunRecord => ({
  id: newId(),
  threadId: null,
  kind: 'chat',
  status: 'done',
  tier: 'pro',
  provider: null,
  model: null,
  promptVersion: 'assistant@2',
  inputTokens: 0,
  cachedTokens: 0,
  outputTokens: 0,
  latencyMs: 0,
  rounds: 1,
  outcome: 'done',
  guardrail: null,
  createdAt: new Date(),
  finishedAt: new Date(),
  ...over,
});

async function setup(opts: { summary?: () => Promise<GenerateResponse> } = {}) {
  const repo = new InMemoryAssistantRepository();
  const scope: OwnerScope = {
    accountId: newId(),
    ownerUserId: userId(newId()),
    businessId: BUSINESS,
    businessIds: [BUSINESS],
  };
  const generate = vi.fn((req: GenerateRequest): Promise<GenerateResponse> => {
    if (req.tier === 'basic')
      return opts.summary ? opts.summary() : Promise.resolve(reply(SUMMARY_TEXT));
    return Promise.resolve(reply(ANSWER, { model: 'fake-pro' }));
  });
  const workspace = {
    listMemberships: () =>
      Promise.resolve([
        { accountId: scope.accountId, workspaceName: 'Shop Lan', industry: 'fashion' },
      ]),
  } as unknown as WorkspaceFacade;
  const skills = new SkillsService(repo, new SkillCatalog([]));
  const prompts = new ThreadPromptService(workspace, repo, skills);
  const compaction = new CompactionService(repo, { generate }, prompts);
  const chat = new ChatTurnService(repo, { generate }, skills, { invoke: vi.fn() }, compaction);
  const thread = await repo.createThread(scope, {
    id: newId(),
    title: 'Áo thun',
    systemPrompt: 'OLD PROMPT',
    promptVersion: 'assistant@2',
  });
  const active = () => repo.listMessages(scope, thread.id, { activeOnly: true });
  const basicCalls = () => generate.mock.calls.filter(([r]) => r.tier === 'basic');
  return { repo, scope, generate, compaction, chat, thread, active, basicCalls };
}

describe('CompactionService', () => {
  it('compacts a thread with more than 80 active messages: head, summary, tail', async () => {
    const { repo, scope, thread, compaction, active, basicCalls } = await setup();
    await repo.appendMessages(scope, thread.id, conversation(42)); // 84 messages
    await repo.saveMemoryStore(scope, 'notes', [
      { id: newId(), text: 'Anh Lan thích báo cáo ngắn', origin: 'owner', createdAt: '' },
    ]);
    const proposal = await repo.createProposal(scope, {
      id: newId(),
      threadId: thread.id,
      runId: null,
      businessId: BUSINESS,
      routeKey: 'PATCH /products/{productId}',
      path: '/products/p1',
      query: null,
      body: { price: 120_000 },
      summary: 'Đổi giá áo thun thành 120.000đ',
      preview: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const before = await active();

    const updated = await compaction.maybeCompact(scope, thread, null, {
      ownerName: () => Promise.resolve('Lan'),
    });

    expect(basicCalls()).toHaveLength(1);
    const req = basicCalls()[0]![0];
    expect(req).toMatchObject({
      tier: 'basic',
      workspaceId: BUSINESS,
      promptCacheKey: `asst:${scope.ownerUserId}:${thread.id}`,
    });
    expect(req.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(req.messages[1]?.content).toContain('câu hỏi 5 ');

    const after = await active();
    const summaryIdx = after.findIndex((m) => m.isSummary);
    // The head (first 3 messages) stays, then the summary, then the tail (≥ 20, from a user message).
    expect(summaryIdx).toBe(3);
    expect(after.slice(0, 3).map((m) => m.id)).toEqual(before.slice(0, 3).map((m) => m.id));
    expect(after.length - summaryIdx - 1).toBeGreaterThanOrEqual(20);
    expect(after[summaryIdx + 1]?.role).toBe('user');
    expect(after.at(-1)?.id).toBe(before.at(-1)?.id);
    const summary = after[summaryIdx]!;
    expect(summary.role).toBe('user');
    expect(summary.content.startsWith(COMPACTION_SUMMARY_PREFIX + SUMMARY_TEXT)).toBe(true);
    // Pending proposals are re-injected with their id.
    expect(summary.content).toContain(`- Đổi giá áo thun thành 120.000đ (id: ${proposal.id})`);
    // The owner never sees the summary.
    expect(isVisibleMessage(summary)).toBe(false);
    const dtos = toMessageDtos(await repo.listMessages(scope, thread.id));
    expect(dtos.some((d) => d.content.startsWith(COMPACTION_SUMMARY_PREFIX))).toBe(false);
    expect(await repo.searchMessages(scope, 'REFERENCE ONLY', 5)).toEqual([]);

    // The thread's prompt is rebuilt with fresh memory; the cache root stays the thread id.
    expect(updated?.systemPrompt).not.toBe('OLD PROMPT');
    expect(updated?.systemPrompt).toContain('Anh Lan thích báo cáo ngắn');
    expect(updated?.systemPrompt).toContain('Shop Lan (fashion)');
    expect(updated?.cacheRootId).toBe(thread.id);
    expect(updated?.compactionSavedPcts[0]).toBeGreaterThan(50);

    const runs = [...repo.runs.values()];
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      kind: 'compaction',
      tier: 'basic',
      status: 'done',
      threadId: thread.id,
      inputTokens: 1_000,
      outputTokens: 200,
      rounds: 1,
    });
  });

  it('leaves a short thread alone, and triggers on the last prompt size', async () => {
    const { repo, scope, thread, compaction, basicCalls } = await setup();
    await repo.appendMessages(scope, thread.id, conversation(20)); // 40 messages
    expect(await compaction.maybeCompact(scope, thread, null)).toBeNull();
    // 90k summed over two model calls is 45k per call: under 75 % of (128k − 16k) = 84k.
    expect(
      await compaction.maybeCompact(
        scope,
        thread,
        lastRun({ inputTokens: 80_000, cachedTokens: 10_000, rounds: 2 }),
      ),
    ).toBeNull();
    expect(basicCalls()).toHaveLength(0);
    expect(
      lastPromptTokens(lastRun({ inputTokens: 80_000, cachedTokens: 10_000, rounds: 1 })),
    ).toBe(90_000);
    const updated = await compaction.maybeCompact(
      scope,
      thread,
      lastRun({ inputTokens: 80_000, cachedTokens: 10_000, rounds: 1 }),
    );
    expect(updated?.compactedAt).toBeInstanceOf(Date);
    expect(basicCalls()).toHaveLength(1);
  });

  it('a later compaction folds and updates the previous summary, still before the tail', async () => {
    const { repo, scope, thread, compaction, active, basicCalls } = await setup();
    await repo.appendMessages(scope, thread.id, conversation(42));
    const first = await compaction.maybeCompact(scope, thread, null);
    const firstSummary = (await active()).find((m) => m.isSummary)!;

    await repo.appendMessages(scope, thread.id, conversation(40, 100));
    const second = await compaction.maybeCompact(scope, first!, null);
    expect(second?.compactionSavedPcts).toHaveLength(2);

    expect(basicCalls()).toHaveLength(2);
    expect(basicCalls()[1]![0].messages[1]?.content).toContain(
      `<previous_summary>\n${SUMMARY_TEXT}\n</previous_summary>`,
    );
    const after = await active();
    const summaries = after.filter((m) => m.isSummary);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.id).not.toBe(firstSummary.id);
    // Head (3), the new summary, then the tail; the newest message is last.
    expect(after.findIndex((m) => m.isSummary)).toBe(3);
    expect(after[4]?.role).toBe('user');
    expect(after.at(-1)?.content).toMatch(/^trả lời 139 /);
  });

  it('skips when the last two compactions each saved under 10 %', async () => {
    const { repo, scope, thread, compaction, basicCalls } = await setup();
    await repo.appendMessages(scope, thread.id, conversation(42));
    const now = new Date();
    repo.threads.get(thread.id)!.compactionSavedPcts = [5, 9];
    repo.threads.get(thread.id)!.compactedAt = new Date(now.getTime() - 60_000);
    const stale = (await repo.getThread(scope, thread.id))!;
    expect(await compaction.maybeCompact(scope, stale, null, { now })).toBeNull();
    expect(basicCalls()).toHaveLength(0);

    repo.threads.get(thread.id)!.compactionSavedPcts = [5, 40];
    const ok = (await repo.getThread(scope, thread.id))!;
    expect(await compaction.maybeCompact(scope, ok, null, { now })).not.toBeNull();
  });

  it('the low-savings skip expires 24 h after the last compaction', async () => {
    const { repo, scope, thread, compaction, basicCalls } = await setup();
    await repo.appendMessages(scope, thread.id, conversation(42));
    const compactedAt = new Date();
    repo.threads.get(thread.id)!.compactionSavedPcts = [5, 9];
    repo.threads.get(thread.id)!.compactedAt = compactedAt;
    const stale = (await repo.getThread(scope, thread.id))!;
    const almost = new Date(compactedAt.getTime() + COMPACTION_THRASH_EXPIRES_MS - 1_000);
    expect(await compaction.maybeCompact(scope, stale, null, { now: almost })).toBeNull();
    expect(basicCalls()).toHaveLength(0);
    const after = new Date(compactedAt.getTime() + COMPACTION_THRASH_EXPIRES_MS + 1_000);
    expect(await compaction.maybeCompact(scope, stale, null, { now: after })).not.toBeNull();
    expect(basicCalls()).toHaveLength(1);
  });

  it('the low-savings skip expires when the thread has more than 160 active messages', async () => {
    const { repo, scope, thread, compaction, basicCalls } = await setup();
    await repo.appendMessages(scope, thread.id, conversation(80)); // 160 messages
    const now = new Date();
    repo.threads.get(thread.id)!.compactionSavedPcts = [5, 9];
    repo.threads.get(thread.id)!.compactedAt = now;
    const stale = (await repo.getThread(scope, thread.id))!;
    expect(await compaction.maybeCompact(scope, stale, null, { now })).toBeNull();
    await repo.appendMessages(scope, thread.id, [msg('user', 'thêm một câu')]); // 161
    expect(await compaction.maybeCompact(scope, stale, null, { now })).not.toBeNull();
    expect(basicCalls()).toHaveLength(1);
  });

  it('a failed read-back after a saved compaction does not start the cooldown', async () => {
    const { repo, scope, thread, compaction, active } = await setup();
    await repo.appendMessages(scope, thread.id, conversation(42));
    const getThread = vi
      .spyOn(repo, 'getThread')
      .mockRejectedValueOnce(new Error('connection reset'));
    const now = new Date();

    const updated = await compaction.maybeCompact(scope, thread, null, { now });

    expect(getThread).toHaveBeenCalledTimes(1);
    expect((await active()).some((m) => m.isSummary)).toBe(true);
    // The turn still gets the new prompt from what was just saved.
    expect(updated?.systemPrompt).not.toBe('OLD PROMPT');
    expect(updated?.compactedAt).toEqual(now);
    expect((await repo.getThread(scope, thread.id))?.compactionFailedAt).toBeNull();
  });

  it('prunes long tool results that stay active and leaves recent ones whole', async () => {
    const { repo, scope, thread, compaction, active } = await setup();
    const tool = (content: string): NewMessage => ({
      ...msg('tool', content),
      toolCallId: 'c1',
      toolName: 'x',
    });
    const call = (): NewMessage => ({
      ...msg('assistant', ''),
      toolCalls: [{ id: 'c1', name: 'x', arguments: {} }],
    });
    const middleTool = tool(`middle ${'m'.repeat(300)}`);
    const olderTailTool = tool(`older ${'o'.repeat(300)}`);
    const recentTailTool = tool(`recent ${'r'.repeat(300)}`);
    await repo.appendMessages(scope, thread.id, [
      ...conversation(20),
      msg('user', 'xem tồn kho'),
      call(),
      middleTool,
      ...conversation(20, 100),
      // The tail: ≥ 20 messages from here.
      msg('user', 'xem đơn'),
      call(),
      olderTailTool,
      ...conversation(4, 200),
      msg('user', 'xem khách'),
      call(),
      recentTailTool,
      ...conversation(3, 300),
    ]);

    await compaction.maybeCompact(scope, thread, null);

    const after = await active();
    const byId = (id: string) => after.find((m) => m.id === id);
    expect(byId(middleTool.id)).toBeUndefined();
    expect(byId(olderTailTool.id)?.content).toBe(PRUNED_TOOL_TEXT);
    expect(byId(recentTailTool.id)?.content).toBe(recentTailTool.content);
  });

  it('on failure keeps the history, records the failed run and cools down for 10 minutes', async () => {
    const { repo, scope, thread, compaction, active, basicCalls } = await setup({
      summary: () => Promise.reject(new Error('provider down')),
    });
    await repo.appendMessages(scope, thread.id, conversation(42));
    const before = await active();
    const now = new Date();

    expect(await compaction.maybeCompact(scope, thread, null, { now })).toBeNull();
    expect((await active()).map((m) => m.id)).toEqual(before.map((m) => m.id));
    const failed = (await repo.getThread(scope, thread.id))!;
    expect(failed.compactionFailedAt).toEqual(now);
    expect(failed.systemPrompt).toBe('OLD PROMPT');
    expect([...repo.runs.values()]).toMatchObject([
      { kind: 'compaction', status: 'failed', guardrail: 'model_error' },
    ]);

    // Within the cooldown nothing is tried; after it, compaction runs again.
    const soon = new Date(now.getTime() + COMPACTION_COOLDOWN_MS - 1_000);
    expect(await compaction.maybeCompact(scope, failed, null, { now: soon })).toBeNull();
    expect(basicCalls()).toHaveLength(1);
    const later = new Date(now.getTime() + COMPACTION_COOLDOWN_MS + 1_000);
    await compaction.maybeCompact(scope, failed, null, { now: later });
    expect(basicCalls()).toHaveLength(2);
  });

  it('treats an empty summary as a failure', async () => {
    const { repo, scope, thread, compaction } = await setup({
      summary: () => Promise.resolve(reply('  ')),
    });
    await repo.appendMessages(scope, thread.id, conversation(42));
    expect(await compaction.maybeCompact(scope, thread, null)).toBeNull();
    expect((await repo.getThread(scope, thread.id))?.compactionFailedAt).toBeInstanceOf(Date);
    expect([...repo.runs.values()]).toMatchObject([
      { kind: 'compaction', status: 'failed', guardrail: 'empty_summary' },
    ]);
  });
});

describe('ChatTurnService with compaction', () => {
  it('compacts before answering: new prompt, summary in the history, hidden from the owner', async () => {
    const { repo, scope, thread, chat, generate } = await setup();
    await repo.appendMessages(scope, thread.id, conversation(42));

    const out = await chat.send(
      scope,
      thread.id,
      { turnId: newId(), text: 'Còn gì nữa?' },
      'Bearer t',
    );

    expect(out.messages.map((m) => m.content)).toEqual(['Còn gì nữa?', ANSWER]);
    const turn = generate.mock.calls.find(([r]) => r.tier === 'pro')![0];
    expect(turn.messages[0]?.content).not.toBe('OLD PROMPT');
    expect(turn.promptCacheKey).toBe(`asst:${scope.ownerUserId}:${thread.id}`);
    const history = turn.messages.slice(1);
    // Head (3), then the summary as a user message, then the tail ending with the new message.
    expect(history[3]).toMatchObject({ role: 'user' });
    expect(history[3]?.content.startsWith(COMPACTION_SUMMARY_PREFIX)).toBe(true);
    expect(history.length).toBeLessThan(40);
    expect(history.at(-1)?.content).toMatch(/Còn gì nữa\?$/);
    const visible = toMessageDtos(await repo.listMessages(scope, thread.id));
    expect(visible.some((m) => m.content.startsWith(COMPACTION_SUMMARY_PREFIX))).toBe(false);
  });

  it('still answers when the compaction fails, with the full history', async () => {
    const { repo, scope, thread, chat, generate } = await setup({
      summary: () => Promise.reject(new Error('provider down')),
    });
    await repo.appendMessages(scope, thread.id, conversation(42));

    const out = await chat.send(
      scope,
      thread.id,
      { turnId: newId(), text: 'Còn gì nữa?' },
      'Bearer t',
    );

    expect(out.messages.at(-1)?.content).toBe(ANSWER);
    expect(out.messages.at(-1)?.content).not.toBe(FALLBACK_REPLY);
    expect(out.run).toMatchObject({ status: 'done', kind: 'chat' });
    const turn = generate.mock.calls.find(([r]) => r.tier === 'pro')![0];
    expect(turn.messages[0]?.content).toBe('OLD PROMPT');
    expect(turn.messages).toHaveLength(1 + 85);
    expect((await repo.getThread(scope, thread.id))?.compactionFailedAt).toBeInstanceOf(Date);
  });

  it('feeds the last finished chat run into the trigger', async () => {
    const { repo, scope, thread, chat, basicCalls } = await setup();
    await repo.appendMessages(scope, thread.id, conversation(15)); // 30 messages
    const first = newId();
    await chat.send(scope, thread.id, { turnId: first, text: 'Một' }, 'Bearer t');
    expect(basicCalls()).toHaveLength(0);
    // Pretend the last turn's prompt was near the window.
    repo.runs.get(first)!.inputTokens = 85_000;
    await chat.send(scope, thread.id, { turnId: newId(), text: 'Hai' }, 'Bearer t');
    expect(basicCalls()).toHaveLength(1);
    expect(await repo.getLastChatRun(scope, thread.id)).toMatchObject({ kind: 'chat' });
  });
});
