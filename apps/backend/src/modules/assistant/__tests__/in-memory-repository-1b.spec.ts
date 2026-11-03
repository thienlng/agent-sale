import { PRUNED_TOOL_TEXT } from '@agent-sales/ai-core';
import { newId, userId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { AssistantNotFoundError } from '../domain/assistant.errors.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import type { NewMessage, NewProposal } from '../domain/ports/assistant.repository.js';
import { InMemoryAssistantRepository } from '../infrastructure/persistence/assistant.in-memory-repository.js';

const BUSINESS = workspaceId(newId());

const scope = (accountId: string): OwnerScope => ({
  accountId,
  ownerUserId: userId(newId()),
  businessId: BUSINESS,
  businessIds: [BUSINESS],
});
const msg = (role: NewMessage['role'], content: string): NewMessage => ({
  id: newId(),
  role,
  content,
  toolCalls: null,
  toolCallId: role === 'tool' ? 'call_1' : null,
  toolName: role === 'tool' ? 'session_search' : null,
  pageContext: null,
  uiActions: [],
  runId: null,
});
const entry = (text: string) => ({
  id: newId(),
  text,
  origin: 'owner' as const,
  createdAt: new Date().toISOString(),
});
const proposal = (s: OwnerScope, threadId: string, expiresAt: Date): NewProposal => ({
  id: newId(),
  threadId,
  runId: null,
  businessId: s.businessId,
  routeKey: 'PATCH /products/{productId}',
  path: '/products/p1',
  query: null,
  body: { price: 120_000 },
  summary: 'Đổi giá áo thun thành 120.000đ',
  preview: { before: { price: 100_000 } },
  expiresAt,
});

async function setup() {
  const repo = new InMemoryAssistantRepository();
  const s = scope(newId());
  const t = await repo.createThread(s, {
    id: newId(),
    title: '',
    systemPrompt: 'p1',
    promptVersion: 'assistant@1',
  });
  return { repo, s, t };
}

describe('InMemoryAssistantRepository (1b)', () => {
  it('upserts memory stores per owner and keeps other accounts and owners apart', async () => {
    const { repo, s } = await setup();
    const other = scope(newId());
    const sameAccount: OwnerScope = { ...s, ownerUserId: userId(newId()) };
    await repo.saveMemoryStore(s, 'notes', [entry('Thích báo cáo ngắn')]);
    const saved = await repo.saveMemoryStore(s, 'notes', [entry('Báo cáo vào sáng thứ Hai')]);
    await repo.saveMemoryStore(s, `business:${s.businessId}`, [entry('Shop thời trang')]);
    await repo.saveMemoryStore(other, 'notes', [entry('khác')]);

    expect(saved.entries.map((e) => e.text)).toEqual(['Báo cáo vào sáng thứ Hai']);
    const mine = await repo.getMemory(s);
    expect(mine.map((m) => m.store)).toEqual([`business:${s.businessId}`, 'notes']);
    expect(mine.find((m) => m.store === 'notes')?.entries.map((e) => e.text)).toEqual([
      'Báo cáo vào sáng thứ Hai',
    ]);
    expect((await repo.getMemory(other)).map((m) => m.entries[0]?.text)).toEqual(['khác']);
    expect(await repo.getMemory(sameAccount)).toEqual([]);
    await expect(repo.saveMemoryStore(s, 'secrets', [])).rejects.toThrow();
  });

  it('lets exactly one of two concurrent approvals win, and expires stale pending proposals', async () => {
    const { repo, s, t } = await setup();
    const p = await repo.createProposal(s, proposal(s, t.id, new Date(Date.now() + 86_400_000)));
    expect(p.status).toBe('pending');

    const results = await Promise.all([
      repo.transitionProposal(s, p.id, ['pending'], 'executing'),
      repo.transitionProposal(s, p.id, ['pending'], 'executing'),
    ]);
    expect(results.filter((x) => x !== null)).toHaveLength(1);
    const decidedAt = new Date();
    const done = await repo.transitionProposal(s, p.id, ['executing'], 'done', {
      resultPreview: 'ok',
      decidedAt,
    });
    expect(done).toMatchObject({ status: 'done', resultPreview: 'ok', decidedAt });

    const stale = await repo.createProposal(s, proposal(s, t.id, new Date(Date.now() - 1000)));
    const fresh = await repo.createProposal(s, proposal(s, t.id, new Date(Date.now() + 60_000)));
    expect(await repo.expireProposals(s, new Date())).toBe(1);
    expect((await repo.getProposal(s, stale.id))?.status).toBe('expired');
    expect((await repo.getProposal(s, fresh.id))?.status).toBe('pending');
    expect((await repo.listProposals(s, t.id)).map((x) => x.id)).toEqual([
      p.id,
      stale.id,
      fresh.id,
    ]);

    const intruder: OwnerScope = { ...s, ownerUserId: userId(newId()) };
    expect(await repo.getProposal(intruder, fresh.id)).toBeNull();
    expect(await repo.transitionProposal(intruder, fresh.id, ['pending'], 'rejected')).toBeNull();
    expect(await repo.expireProposals(intruder, new Date(Date.now() + 1e9))).toBe(0);
    await expect(repo.listProposals(intruder, t.id)).rejects.toBeInstanceOf(AssistantNotFoundError);
    await expect(
      repo.createProposal(intruder, proposal(intruder, t.id, new Date())),
    ).rejects.toBeInstanceOf(AssistantNotFoundError);
  });

  it('applies a compaction: the summary sorts before the tail, tool output is pruned', async () => {
    const { repo, s, t } = await setup();
    const rows = await repo.appendMessages(s, t.id, [
      msg('user', 'head 1'),
      msg('assistant', 'head 2'),
      msg('user', 'mid 3'),
      msg('tool', 'x'.repeat(500)),
      msg('assistant', 'mid 5'),
      msg('user', 'tail 6'),
      msg('tool', 'y'.repeat(500)),
      msg('assistant', 'tail 8'),
    ]);
    const id = (i: number) => rows[i]!.id;
    const summary = await repo.applyCompaction(s, t.id, {
      deactivateIds: [id(2), id(3), id(4)],
      prunedToolIds: [id(6)],
      summary: msg('user', 'REFERENCE ONLY — summary'),
      savedPct: 40,
      systemPrompt: 'p2',
    });
    expect(summary).toMatchObject({ seq: 9, isSummary: true });

    const active = await repo.listMessages(s, t.id, { activeOnly: true });
    expect(active.map((m) => m.content.slice(0, 12))).toEqual([
      'head 1',
      'head 2',
      'REFERENCE ON',
      'tail 6',
      PRUNED_TOOL_TEXT.slice(0, 12),
      'tail 8',
    ]);
    expect((await repo.listMessages(s, t.id)).map((m) => m.seq)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    const thread = await repo.getThread(s, t.id);
    expect(thread).toMatchObject({ systemPrompt: 'p2', cacheRootId: t.id });
    expect(thread?.compactedAt).toBeInstanceOf(Date);

    // A stale plan (already compacted rows) changes nothing.
    await expect(
      repo.applyCompaction(s, t.id, {
        deactivateIds: [id(2)],
        prunedToolIds: [],
        summary: msg('user', 'again'),
        savedPct: 5,
        systemPrompt: 'p3',
      }),
    ).rejects.toThrow('stale');

    await repo.applyCompaction(s, t.id, {
      deactivateIds: [summary.id, id(5)],
      prunedToolIds: [],
      summary: msg('user', 'second summary'),
      savedPct: 8,
      systemPrompt: 'p3',
    });
    // The second summary folds the first (high seq, low sort_seq) and still sorts before the tail.
    const contents = async () =>
      (await repo.listMessages(s, t.id, { activeOnly: true })).map((m) => m.content.slice(0, 14));
    expect(await contents()).toEqual([
      'head 1',
      'head 2',
      'second summary',
      PRUNED_TOOL_TEXT.slice(0, 14),
      'tail 8',
    ]);
    await repo.applyCompaction(s, t.id, {
      deactivateIds: [id(6)],
      prunedToolIds: [],
      summary: msg('user', 'third summary'),
      savedPct: 9,
      systemPrompt: 'p4',
    });
    expect(await contents()).toEqual([
      'head 1',
      'head 2',
      'second summary',
      'third summary',
      'tail 8',
    ]);
    expect((await repo.getThread(s, t.id))?.compactionSavedPcts).toEqual([8, 9]);

    const at = new Date();
    await repo.markCompactionFailed(s, t.id, at);
    expect((await repo.getThread(s, t.id))?.compactionFailedAt).toEqual(at);
    const intruder: OwnerScope = { ...s, ownerUserId: userId(newId()) };
    await expect(repo.markCompactionFailed(intruder, t.id, at)).rejects.toBeInstanceOf(
      AssistantNotFoundError,
    );
  });
});
