import { newId, userId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import {
  AssistantNotFoundError,
  AssistantSkillNameTakenError,
} from '../domain/assistant.errors.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import type { NewMessage, NewSkill } from '../domain/ports/assistant.repository.js';
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
  toolCallId: null,
  toolName: null,
  pageContext: null,
  uiActions: [],
  runId: null,
});
const skill = (name: string, over: Partial<NewSkill> = {}): NewSkill => ({
  id: newId(),
  name,
  description: `How to ${name}`,
  body: `Steps for ${name}`,
  toolsets: [],
  provenance: 'owner',
  shadowOf: null,
  state: 'active',
  ...over,
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

describe('InMemoryAssistantRepository skills (1c)', () => {
  it('creates skills with a ledger entry and keeps names unique among non-archived skills', async () => {
    const { repo, s } = await setup();
    const created = await repo.createSkill(s, skill('weekly-report'), {
      id: newId(),
      actor: 'assistant',
      action: 'create',
      runId: null,
    });
    expect(created).toMatchObject({ name: 'weekly-report', useCount: 0, pinned: false });
    await expect(repo.createSkill(s, skill('weekly-report'))).rejects.toBeInstanceOf(
      AssistantSkillNameTakenError,
    );
    await expect(repo.createSkill(s, skill('Bad Name'))).rejects.toThrow();
    await expect(
      repo.createSkill(s, skill('shadow-without-target', { provenance: 'shadow' })),
    ).rejects.toThrow();

    const archived = await repo.updateSkill(s, created.id, { state: 'archived' });
    expect(archived?.state).toBe('archived');
    // The archived skill frees its name.
    const again = await repo.createSkill(s, skill('weekly-report'));
    expect((await repo.getSkillByName(s, 'weekly-report'))?.id).toBe(again.id);
    const [event] = await repo.listSkillEvents(s, { skillId: created.id });
    expect(event).toMatchObject({ action: 'create', before: null });
    expect(event?.after).toEqual({
      name: 'weekly-report',
      description: 'How to weekly-report',
      body: 'Steps for weekly-report',
      state: 'active',
    });
  });

  it('applies the optimistic lock, the patch counter and before/after snapshots', async () => {
    const { repo, s } = await setup();
    const created = await repo.createSkill(s, skill('import-products'));
    const patched = await repo.updateSkill(
      s,
      created.id,
      { body: 'New steps', countPatch: true },
      {
        expectedUpdatedAt: created.updatedAt,
        event: { id: newId(), actor: 'review', action: 'patch', runId: null },
      },
    );
    expect(patched).toMatchObject({ body: 'New steps', patchCount: 1 });
    expect(patched?.lastPatchedAt).toBeInstanceOf(Date);
    expect(patched!.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
    // A stale token changes nothing.
    expect(
      await repo.updateSkill(
        s,
        created.id,
        { body: 'Lost' },
        { expectedUpdatedAt: created.updatedAt },
      ),
    ).toBeNull();
    const [event] = await repo.listSkillEvents(s, { skillId: created.id });
    expect(event?.before?.body).toBe('Steps for import-products');
    expect(event?.after?.body).toBe('New steps');
    expect((await repo.markSkillEventUndone(s, event!.id, new Date()))?.undoneAt).toBeInstanceOf(
      Date,
    );
    expect(await repo.markSkillEventUndone(s, event!.id, new Date())).toBeNull();

    await repo.bumpSkillCounter(s, created.id, 'use');
    await repo.bumpSkillCounter(s, created.id, 'view');
    const read = await repo.getSkill(s, created.id);
    expect(read).toMatchObject({ useCount: 1, viewCount: 1 });
    expect(read?.updatedAt.getTime()).toBe(patched!.updatedAt.getTime());
  });

  it("hides one owner's skills, events and suggestions from another", async () => {
    const { repo, s } = await setup();
    const other = scope(newId());
    const created = await repo.createSkill(s, skill('mine'));
    expect(await repo.getSkill(other, created.id)).toBeNull();
    expect(await repo.listSkills(other)).toEqual([]);
    expect(await repo.updateSkill(other, created.id, { body: 'x' })).toBeNull();
    await expect(
      repo.appendSkillEvent(other, {
        id: newId(),
        skillId: created.id,
        actor: 'owner',
        action: 'archive',
        before: null,
        after: null,
        runId: null,
      }),
    ).rejects.toBeInstanceOf(AssistantNotFoundError);
    await repo.upsertSuggestion(s, {
      id: newId(),
      kind: 'schedule',
      dedupKey: 'weekly-revenue',
      title: 'Báo cáo doanh thu mỗi thứ Hai',
      payload: {},
    });
    expect(await repo.listSuggestions(other)).toEqual([]);
    // The same key is free for another owner.
    expect(
      await repo.upsertSuggestion(other, {
        id: newId(),
        kind: 'schedule',
        dedupKey: 'weekly-revenue',
        title: 'x',
        payload: {},
      }),
    ).not.toBeNull();
  });
});

describe('InMemoryAssistantRepository suggestions, settings, feedback, counters (1c)', () => {
  it('ignores a dedup key the owner already has, in any status', async () => {
    const { repo, s } = await setup();
    const first = await repo.upsertSuggestion(s, {
      id: newId(),
      kind: 'setup',
      dedupKey: 'connect-zalo',
      title: 'Kết nối Zalo OA',
      payload: { route: '/app/channels' },
    });
    expect(first?.status).toBe('pending');
    expect((await repo.decideSuggestion(s, first!.id, 'dismissed', new Date()))?.status).toBe(
      'dismissed',
    );
    expect(await repo.decideSuggestion(s, first!.id, 'accepted', new Date())).toBeNull();
    expect(
      await repo.upsertSuggestion(s, {
        id: newId(),
        kind: 'setup',
        dedupKey: 'connect-zalo',
        title: 'again',
        payload: {},
      }),
    ).toBeNull();
    expect(await repo.listSuggestions(s, { status: 'pending' })).toEqual([]);
  });

  it('returns default settings, then saves a patch', async () => {
    const { repo, s } = await setup();
    expect(await repo.getSettings(s)).toEqual({
      reviewEnabled: true,
      disabledToolsets: [],
      curatorRanAt: null,
      updatedAt: null,
    });
    await repo.saveSettings(s, { reviewEnabled: false });
    const saved = await repo.saveSettings(s, { disabledToolsets: ['routes'] });
    expect(saved).toMatchObject({ reviewEnabled: false, disabledToolsets: ['routes'] });
  });

  it("sets feedback only on the owner's own assistant messages", async () => {
    const { repo, s, t } = await setup();
    const [user, answer] = await repo.appendMessages(s, t.id, [
      msg('user', 'Doanh thu?'),
      msg('assistant', '10 triệu'),
    ]);
    await repo.setFeedback(s, answer!.id, -1);
    expect((await repo.listMessages(s, t.id))[1]?.feedback).toBe(-1);
    await repo.setFeedback(s, answer!.id, null);
    expect((await repo.listMessages(s, t.id))[1]?.feedback).toBeNull();
    await expect(repo.setFeedback(s, user!.id, 1)).rejects.toBeInstanceOf(AssistantNotFoundError);
    await expect(repo.setFeedback(scope(s.accountId), answer!.id, 1)).rejects.toBeInstanceOf(
      AssistantNotFoundError,
    );
  });

  it('bumps and resets the review counters', async () => {
    const { repo, s, t } = await setup();
    await repo.bumpReviewCounters(s, t.id, { ownerTurns: 1, toolRounds: 3 });
    expect(await repo.bumpReviewCounters(s, t.id, { ownerTurns: 1, toolRounds: 2 })).toEqual({
      ownerTurns: 2,
      toolRounds: 5,
      lastReviewAt: null,
    });
    expect(await repo.resetReviewCounters(s, t.id, { only: 'toolRounds' })).toMatchObject({
      ownerTurns: 2,
      toolRounds: 0,
    });
    const at = new Date();
    expect(await repo.resetReviewCounters(s, t.id, { reviewedAt: at })).toEqual({
      ownerTurns: 0,
      toolRounds: 0,
      lastReviewAt: at,
    });
    await expect(
      repo.bumpReviewCounters(scope(s.accountId), t.id, { ownerTurns: 1, toolRounds: 0 }),
    ).rejects.toBeInstanceOf(AssistantNotFoundError);
  });
});

describe('InMemoryAssistantRepository jobs and curator (1c)', () => {
  it('keeps one queued job per thread and kind, claims due jobs and fences finish', async () => {
    const { repo, s, t } = await setup();
    const now = new Date('2026-11-02T10:00:00Z');
    const first = await repo.enqueueJob(s, {
      id: newId(),
      threadId: t.id,
      kind: 'review',
      reviewScope: 'memory',
      runAfter: now,
    });
    const merged = await repo.enqueueJob(s, {
      id: newId(),
      threadId: t.id,
      kind: 'review',
      reviewScope: 'combined',
      runAfter: new Date(now.getTime() + 60_000),
    });
    expect(merged).toMatchObject({ id: first.id, reviewScope: 'combined' });
    expect(await repo.claimJobs(now, 10, 30_000)).toEqual([]);

    const later = new Date(now.getTime() + 60_000);
    const [claimed] = await repo.claimJobs(later, 10, 30_000);
    expect(claimed).toMatchObject({ id: first.id, status: 'running', attempts: 1 });
    expect(claimed).toMatchObject({ accountId: s.accountId, ownerUserId: s.ownerUserId });
    expect(await repo.claimJobs(later, 10, 30_000)).toEqual([]);

    // The lease lapses: another claimer takes it, and the first holder's finish is fenced off.
    const lapsed = new Date(later.getTime() + 31_000);
    const [again] = await repo.claimJobs(lapsed, 10, 30_000);
    expect(again?.attempts).toBe(2);
    expect(await repo.finishJob(s, { id: first.id, attempts: 1 }, { status: 'done' })).toBe(false);
    expect(await repo.finishJob(s, { id: first.id, attempts: 2 }, { status: 'done' })).toBe(true);
    expect((await repo.getJob(s, first.id))?.status).toBe('done');
  });

  it('fails a job whose lease lapsed too often, and cancels queued jobs of a thread', async () => {
    const { repo, s, t } = await setup();
    let now = new Date('2026-11-02T10:00:00Z');
    const job = await repo.enqueueJob(s, {
      id: newId(),
      threadId: t.id,
      kind: 'review',
      reviewScope: 'skills',
      runAfter: now,
    });
    for (let i = 0; i < 3; i++) {
      expect(await repo.claimJobs(now, 1, 1_000)).toHaveLength(1);
      now = new Date(now.getTime() + 2_000);
    }
    expect(await repo.claimJobs(now, 1, 1_000)).toEqual([]);
    expect(await repo.getJob(s, job.id)).toMatchObject({
      status: 'failed',
      errorCode: 'lease_expired',
    });

    const queued = await repo.enqueueJob(s, {
      id: newId(),
      threadId: t.id,
      kind: 'review',
      reviewScope: 'memory',
      runAfter: now,
    });
    expect(await repo.cancelJob(scope(s.accountId), { id: queued.id })).toBe(0);
    expect(await repo.cancelJob(s, { threadId: t.id, kind: 'review' })).toBe(1);
    expect((await repo.getJob(s, queued.id))?.status).toBe('cancelled');
  });

  it('lists learned skills and the owners the curator should scan', async () => {
    const { repo, s } = await setup();
    const other = scope(newId());
    await repo.createSkill(s, skill('learned-one', { provenance: 'learned' }));
    await repo.createSkill(s, skill('owner-one'));
    await repo.createSkill(
      s,
      skill('pending-one', { provenance: 'learned', state: 'pending_approval' }),
    );
    await repo.createSkill(other, skill('owner-two'));

    expect((await repo.listLearnedSkillsForCurator(s)).map((x) => x.name)).toEqual(['learned-one']);
    expect(await repo.ownersWithLearnedSkills()).toEqual([
      { accountId: s.accountId, ownerUserId: s.ownerUserId },
    ]);
    const ran = new Date();
    await repo.saveSettings(s, { curatorRanAt: ran });
    expect(await repo.ownersWithLearnedSkills({ ranBefore: ran })).toEqual([]);
    expect(
      await repo.ownersWithLearnedSkills({ ranBefore: new Date(ran.getTime() + 1) }),
    ).toHaveLength(1);
  });
});
