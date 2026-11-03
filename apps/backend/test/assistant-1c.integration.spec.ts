import {
  createDb,
  ensureLoginRoles,
  migrate,
  schema,
  sql,
  withAccount,
  withCredentials,
  withSystem,
  type Database,
} from '@agent-sales/db';
import { newId, userId, workspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AssistantNotFoundError,
  AssistantSkillNameTakenError,
} from '../src/modules/assistant/domain/assistant.errors.js';
import type { OwnerScope } from '../src/modules/assistant/domain/owner-scope.js';
import type { NewSkill } from '../src/modules/assistant/domain/ports/assistant.repository.js';
import { DrizzleAssistantRepository } from '../src/modules/assistant/infrastructure/persistence/assistant.drizzle-repository.js';

/**
 * Owner assistant 1c storage on Postgres (0058, ADR-023): skills, the ledger, suggestions,
 * settings, feedback, review counters and leased jobs, through the Drizzle repository under
 * account RLS. One connection per client (`max: 1`) mimics PgBouncer; two repositories on two
 * system connections stand for two worker processes.
 */
let pg: TestPostgres;
const handles: { db: Database; close: () => Promise<void> }[] = [];
let repo: DrizzleAssistantRepository;
let repo2: DrizzleAssistantRepository;
let tenant: Database;
let system: Database;

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  const tenantUrl = withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password);
  const systemUrl = withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password);
  const open = (url: string) => {
    const h = createDb({ url, max: 1 });
    handles.push(h);
    return h.db;
  };
  tenant = open(tenantUrl);
  system = open(systemUrl);
  repo = new DrizzleAssistantRepository(tenant, system);
  repo2 = new DrizzleAssistantRepository(open(tenantUrl), open(systemUrl));
});

afterAll(async () => {
  await Promise.all(handles.map((h) => h.close()));
  await pg?.stop();
});

/** A user, their account and business, and one thread of theirs. */
async function owner(): Promise<{ s: OwnerScope; threadId: string }> {
  const account = newId();
  const user = userId(newId());
  const business = workspaceId(newId());
  const threadId = newId();
  await withSystem(system, async (tx) => {
    await tx.insert(schema.users).values({ id: user, email: `${user}@example.test`, name: 'O' });
    await tx.insert(schema.accounts).values({ id: account, name: 'acc', createdByUserId: user });
    await tx.insert(schema.workspaces).values({
      id: business,
      workspaceId: business,
      name: 'Shop',
      industry: 'fashion',
      ownerUserId: user,
      accountId: account,
    });
    await tx.insert(schema.assistantThreads).values({
      id: threadId,
      accountId: account,
      ownerUserId: user,
      systemPrompt: 'p',
      promptVersion: 'v1',
    });
  });
  return {
    s: { accountId: account, ownerUserId: user, businessId: business, businessIds: [business] },
    threadId,
  };
}

const skill = (name: string, over: Partial<NewSkill> = {}): NewSkill => ({
  id: newId(),
  name,
  description: `How to ${name}`,
  body: `Steps for ${name}`,
  toolsets: ['routes'],
  provenance: 'owner',
  shadowOf: null,
  state: 'active',
  ...over,
});

describe('assistant skills and the ledger on Postgres (1c)', () => {
  it('keeps skills and suggestions per account under RLS', async () => {
    const a = await owner();
    const b = await owner();
    const sa = await repo.createSkill(a.s, skill('weekly-report'));
    await repo.createSkill(b.s, skill('weekly-report'));
    await repo.upsertSuggestion(a.s, {
      id: newId(),
      kind: 'schedule',
      dedupKey: 'weekly-revenue',
      title: 'Báo cáo doanh thu mỗi thứ Hai',
      payload: { cron: '0 8 * * 1' },
    });

    expect((await repo.listSkills(a.s)).map((x) => x.id)).toEqual([sa.id]);
    expect(await repo.getSkill(b.s, sa.id)).toBeNull();
    // Same owner id under the other account: RLS and the explicit filter both hide A's rows.
    const crossed = { ...b.s, ownerUserId: a.s.ownerUserId };
    expect(await repo.getSkill(crossed, sa.id)).toBeNull();
    expect(await repo.listSuggestions(crossed)).toEqual([]);
    expect(await repo.listSuggestions(b.s)).toEqual([]);
    expect(await repo.updateSkill(b.s, sa.id, { body: 'hijack' })).toBeNull();

    // Raw reads under account B's RLS context see none of account A's rows.
    for (const table of [schema.assistantSkills, schema.assistantSuggestions]) {
      const rows = await withAccount(tenant, b.s.accountId, (tx) =>
        tx.select({ accountId: table.accountId }).from(table),
      );
      expect(rows.every((r) => r.accountId === b.s.accountId)).toBe(true);
    }
    // And a write naming account A from B's context is refused.
    await expect(
      withAccount(tenant, b.s.accountId, (tx) =>
        tx.insert(schema.assistantSkills).values({
          ...skill('smuggled'),
          accountId: a.s.accountId,
          ownerUserId: a.s.ownerUserId,
        }),
      ),
    ).rejects.toThrow();
  });

  it('enforces names, the optimistic lock and the ledger snapshots', async () => {
    const { s } = await owner();
    const created = await repo.createSkill(s, skill('import-products'), {
      id: newId(),
      actor: 'assistant',
      action: 'create',
      runId: null,
    });
    await expect(repo.createSkill(s, skill('import-products'))).rejects.toBeInstanceOf(
      AssistantSkillNameTakenError,
    );
    await expect(repo.createSkill(s, skill('Bad Name'))).rejects.toThrow();
    await expect(
      repo.createSkill(s, skill('no-target', { provenance: 'shadow' })),
    ).rejects.toThrow();
    const shadow = await repo.createSkill(
      s,
      skill('read-revenue', { provenance: 'shadow', shadowOf: 'read-revenue' }),
    );
    expect(shadow.shadowOf).toBe('read-revenue');

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
    expect(patched!.updatedAt.getTime()).toBeGreaterThan(created.updatedAt.getTime());
    expect(
      await repo.updateSkill(
        s,
        created.id,
        { body: 'Lost' },
        { expectedUpdatedAt: created.updatedAt },
      ),
    ).toBeNull();
    // Two immediate updates still give two distinct tokens.
    const next = await repo.updateSkill(s, created.id, { pinned: true });
    expect(next!.updatedAt.getTime()).toBeGreaterThan(patched!.updatedAt.getTime());
    expect(
      await repo.updateSkill(
        s,
        created.id,
        { pinned: false },
        { expectedUpdatedAt: next!.updatedAt },
      ),
    ).not.toBeNull();

    const events = await repo.listSkillEvents(s, { skillId: created.id });
    expect(events.map((e) => e.action)).toEqual(['patch', 'create']);
    expect(events[0]?.before).toEqual({
      name: 'import-products',
      description: 'How to import-products',
      body: 'Steps for import-products',
      state: 'active',
    });
    expect(events[0]?.after?.body).toBe('New steps');
    expect(await repo.listSkillEvents(s, { since: new Date(Date.now() + 60_000) })).toEqual([]);
    expect(await repo.listSkillEvents(s, { actor: 'review' })).toHaveLength(1);
    const undone = await repo.markSkillEventUndone(s, events[0]!.id, new Date());
    expect(undone?.undoneAt).toBeInstanceOf(Date);
    expect(await repo.markSkillEventUndone(s, events[0]!.id, new Date())).toBeNull();

    // Archiving frees the name; the archived row stays for restore.
    await repo.updateSkill(s, created.id, { state: 'archived' });
    const again = await repo.createSkill(s, skill('import-products'));
    expect((await repo.getSkillByName(s, 'import-products'))?.id).toBe(again.id);
    await expect(repo.updateSkill(s, created.id, { state: 'active' })).rejects.toBeInstanceOf(
      AssistantSkillNameTakenError,
    );

    await repo.bumpSkillCounter(s, again.id, 'use');
    await repo.bumpSkillCounter(s, again.id, 'view');
    const read = await repo.getSkill(s, again.id);
    expect(read).toMatchObject({ useCount: 1, viewCount: 1 });
    expect(read?.lastUsedAt).toBeInstanceOf(Date);
    expect(read?.updatedAt.getTime()).toBe(again.updatedAt.getTime());
  });
});

describe('assistant suggestions, settings, feedback and counters on Postgres (1c)', () => {
  it('keeps a dedup key taken in every status', async () => {
    const { s } = await owner();
    const first = await repo.upsertSuggestion(s, {
      id: newId(),
      kind: 'setup',
      dedupKey: 'connect-zalo',
      title: 'Kết nối Zalo OA',
      payload: {},
    });
    expect(first?.status).toBe('pending');
    expect(
      await repo.upsertSuggestion(s, {
        id: newId(),
        kind: 'setup',
        dedupKey: 'connect-zalo',
        title: 'duplicate',
        payload: {},
      }),
    ).toBeNull();
    expect((await repo.decideSuggestion(s, first!.id, 'dismissed', new Date()))?.status).toBe(
      'dismissed',
    );
    expect(await repo.decideSuggestion(s, first!.id, 'accepted', new Date())).toBeNull();
    expect(
      await repo.upsertSuggestion(s, {
        id: newId(),
        kind: 'setup',
        dedupKey: 'connect-zalo',
        title: 'after dismissal',
        payload: {},
      }),
    ).toBeNull();
    expect((await repo.listSuggestions(s)).map((x) => x.title)).toEqual(['Kết nối Zalo OA']);
  });

  it('returns default settings and upserts a patch', async () => {
    const { s } = await owner();
    expect(await repo.getSettings(s)).toEqual({
      reviewEnabled: true,
      disabledToolsets: [],
      curatorRanAt: null,
      updatedAt: null,
    });
    await repo.saveSettings(s, { reviewEnabled: false });
    const saved = await repo.saveSettings(s, { disabledToolsets: ['routes', 'skills'] });
    expect(saved).toMatchObject({ reviewEnabled: false, disabledToolsets: ['routes', 'skills'] });
    expect(await repo.getSettings(s)).toEqual(saved);
  });

  it("sets feedback only on the owner's own assistant message", async () => {
    const a = await owner();
    const b = await owner();
    const [question, answer] = await repo.appendMessages(a.s, a.threadId, [
      {
        id: newId(),
        role: 'user',
        content: 'Doanh thu?',
        toolCalls: null,
        toolCallId: null,
        toolName: null,
        pageContext: null,
        uiActions: [],
        runId: null,
      },
      {
        id: newId(),
        role: 'assistant',
        content: '10 triệu',
        toolCalls: null,
        toolCallId: null,
        toolName: null,
        pageContext: null,
        uiActions: [],
        runId: null,
      },
    ]);
    await repo.setFeedback(a.s, answer!.id, 1);
    expect((await repo.listMessages(a.s, a.threadId))[1]?.feedback).toBe(1);
    await repo.setFeedback(a.s, answer!.id, null);
    expect((await repo.listMessages(a.s, a.threadId))[1]?.feedback).toBeNull();

    await expect(repo.setFeedback(a.s, question!.id, 1)).rejects.toBeInstanceOf(
      AssistantNotFoundError,
    );
    await expect(repo.setFeedback(b.s, answer!.id, -1)).rejects.toBeInstanceOf(
      AssistantNotFoundError,
    );
    const sameAccountOtherOwner = { ...a.s, ownerUserId: b.s.ownerUserId };
    await expect(repo.setFeedback(sameAccountOtherOwner, answer!.id, -1)).rejects.toBeInstanceOf(
      AssistantNotFoundError,
    );
    await expect(
      withAccount(tenant, a.s.accountId, (tx) =>
        tx.execute(sql`update assistant_messages set feedback = 2 where id = ${answer!.id}`),
      ),
    ).rejects.toThrow();
    expect((await repo.listMessages(a.s, a.threadId))[1]?.feedback).toBeNull();
  });

  it('bumps and resets the review counters of the owner thread only', async () => {
    const a = await owner();
    const b = await owner();
    await repo.bumpReviewCounters(a.s, a.threadId, { ownerTurns: 1, toolRounds: 4 });
    expect(
      await repo.bumpReviewCounters(a.s, a.threadId, { ownerTurns: 1, toolRounds: 2 }),
    ).toEqual({ ownerTurns: 2, toolRounds: 6, lastReviewAt: null });
    expect(await repo.resetReviewCounters(a.s, a.threadId, { only: 'ownerTurns' })).toMatchObject({
      ownerTurns: 0,
      toolRounds: 6,
    });
    const at = new Date('2026-11-02T10:00:00.000Z');
    expect(await repo.resetReviewCounters(a.s, a.threadId, { reviewedAt: at })).toEqual({
      ownerTurns: 0,
      toolRounds: 0,
      lastReviewAt: at,
    });
    expect((await repo.getThread(a.s, a.threadId))?.lastReviewAt).toEqual(at);
    await expect(
      repo.bumpReviewCounters(b.s, a.threadId, { ownerTurns: 1, toolRounds: 0 }),
    ).rejects.toBeInstanceOf(AssistantNotFoundError);
  });
});

describe('assistant jobs and the curator on Postgres (1c)', () => {
  it('keeps one queued job per thread and kind, curator jobs included', async () => {
    const { s, threadId } = await owner();
    const runAfter = new Date(Date.now() + 60 * 60_000);
    const first = await repo.enqueueJob(s, {
      id: newId(),
      threadId,
      kind: 'review',
      reviewScope: 'memory',
      runAfter,
    });
    const merged = await repo.enqueueJob(s, {
      id: newId(),
      threadId,
      kind: 'review',
      reviewScope: 'combined',
      runAfter: new Date(runAfter.getTime() + 60_000),
    });
    expect(merged).toMatchObject({ id: first.id, reviewScope: 'combined', status: 'queued' });
    expect(merged.runAfter.getTime()).toBe(runAfter.getTime() + 60_000);
    // A due review keeps its time on a later (idle) enqueue; two scopes merge into combined.
    const busy = await owner();
    const due = await repo.enqueueJob(busy.s, {
      id: newId(),
      threadId: busy.threadId,
      kind: 'review',
      reviewScope: 'memory',
      runAfter: new Date(Date.now() - 1000),
    });
    const pushed = await repo.enqueueJob(busy.s, {
      id: newId(),
      threadId: busy.threadId,
      kind: 'review',
      reviewScope: 'skills',
      runAfter: new Date(Date.now() + 30 * 60_000),
    });
    expect(pushed).toMatchObject({ id: due.id, reviewScope: 'combined' });
    expect(pushed.runAfter.getTime()).toBe(due.runAfter.getTime());
    expect(await repo.cancelJob(busy.s, { id: due.id })).toBe(1);

    const c1 = await repo.enqueueJob(s, {
      id: newId(),
      threadId: null,
      kind: 'curator',
      reviewScope: null,
      runAfter,
    });
    const c2 = await repo.enqueueJob(s, {
      id: newId(),
      threadId: null,
      kind: 'curator',
      reviewScope: null,
      runAfter,
    });
    expect(c2.id).toBe(c1.id);
    await expect(
      repo.enqueueJob(s, {
        id: newId(),
        threadId,
        kind: 'curator',
        reviewScope: 'memory',
        runAfter,
      }),
    ).rejects.toThrow();

    const other = await owner();
    await expect(
      repo.enqueueJob(other.s, {
        id: newId(),
        threadId,
        kind: 'review',
        reviewScope: 'memory',
        runAfter,
      }),
    ).rejects.toBeInstanceOf(AssistantNotFoundError);

    expect(await repo.cancelJob(other.s, { id: first.id })).toBe(0);
    expect(await repo.cancelJob(s, { threadId, kind: 'review' })).toBe(1);
    expect(await repo.cancelJob(s, { id: c1.id })).toBe(1);
    expect((await repo.getJob(s, first.id))?.status).toBe('cancelled');
  });

  it('gives two concurrent claimers disjoint jobs across accounts and fences finish', async () => {
    // Only this test's jobs are due: earlier tests' jobs are cancelled or far in the future.
    const now = new Date('2030-01-01T00:00:00.000Z');
    const owners = await Promise.all([owner(), owner(), owner()]);
    const ids: string[] = [];
    for (const o of owners) {
      for (const kind of ['review', 'curator'] as const) {
        const job = await repo.enqueueJob(o.s, {
          id: newId(),
          threadId: kind === 'review' ? o.threadId : null,
          kind,
          reviewScope: kind === 'review' ? 'combined' : null,
          runAfter: new Date(now.getTime() - 1_000),
        });
        ids.push(job.id);
      }
    }
    const [x, y] = await Promise.all([
      repo.claimJobs(now, 4, 60_000),
      repo2.claimJobs(now, 4, 60_000),
    ]);
    const claimedIds = [...x, ...y].map((j) => j.id);
    expect(new Set(claimedIds).size).toBe(claimedIds.length);
    expect(claimedIds.sort()).toEqual([...ids].sort());
    const job = x[0] ?? y[0]!;
    expect(job).toMatchObject({ status: 'running', attempts: 1 });
    const holder = owners.find((o) => o.s.accountId === job.accountId)!;
    expect(job.ownerUserId).toBe(holder.s.ownerUserId);
    expect(await repo.claimJobs(now, 10, 60_000)).toEqual([]);

    // The lease lapses: it is claimed again, and the old holder's finish is fenced off.
    const lapsed = new Date(now.getTime() + 61_000);
    const reclaimed = await repo2.claimJobs(lapsed, 10, 60_000);
    expect(reclaimed).toHaveLength(ids.length);
    const key = { accountId: job.accountId, ownerUserId: holder.s.ownerUserId };
    // The old holder cannot cancel the new attempt's run either.
    expect(await repo.cancelJob(key, { id: job.id, attempts: 1 })).toBe(0);
    expect(await repo.getJob(key, job.id)).toMatchObject({ status: 'running', attempts: 2 });
    expect(await repo.finishJob(key, { id: job.id, attempts: 1 }, { status: 'done' })).toBe(false);
    expect(
      await repo.finishJob(key, { id: job.id, attempts: 2 }, { status: 'failed', errorCode: 'x' }),
    ).toBe(true);
    expect(await repo.getJob(key, job.id)).toMatchObject({ status: 'failed', errorCode: 'x' });
    // Another account cannot finish it.
    const stranger = owners.find((o) => o !== holder)!;
    expect(await repo.finishJob(stranger.s, { id: job.id, attempts: 2 }, { status: 'done' })).toBe(
      false,
    );

    // A job whose lease lapsed JOB_MAX_ATTEMPTS times is failed instead of claimed again.
    const later = new Date(lapsed.getTime() + 61_000);
    expect((await repo.claimJobs(later, 10, 60_000)).length).toBe(ids.length - 1);
    const last = new Date(later.getTime() + 61_000);
    expect(await repo.claimJobs(last, 10, 60_000)).toEqual([]);
    for (const id of ids.filter((i) => i !== job.id)) {
      const [row] = await withSystem(system, (tx) =>
        tx.execute<{ status: string; error_code: string | null }>(
          sql`select status, error_code from assistant_jobs where id = ${id}`,
        ),
      );
      expect(row).toMatchObject({ status: 'failed', error_code: 'lease_expired' });
    }
  });

  it('lists learned skills and the owners due for the curator', async () => {
    const a = await owner();
    const b = await owner();
    await repo.createSkill(a.s, skill('learned-one', { provenance: 'learned' }));
    await repo.createSkill(a.s, skill('learned-stale', { provenance: 'learned', state: 'stale' }));
    await repo.createSkill(
      a.s,
      skill('learned-pending', { provenance: 'learned', state: 'pending_approval' }),
    );
    await repo.createSkill(a.s, skill('owner-one'));
    await repo.createSkill(b.s, skill('owner-two'));

    expect((await repo.listLearnedSkillsForCurator(a.s)).map((x) => x.name)).toEqual([
      'learned-one',
      'learned-stale',
    ]);
    const owners = await repo.ownersWithLearnedSkills();
    expect(owners).toContainEqual({ accountId: a.s.accountId, ownerUserId: a.s.ownerUserId });
    expect(owners.some((o) => o.accountId === b.s.accountId)).toBe(false);

    const ran = new Date('2026-11-02T10:00:00.000Z');
    await repo.saveSettings(a.s, { curatorRanAt: ran });
    expect(
      (await repo.ownersWithLearnedSkills({ ranBefore: ran })).some(
        (o) => o.accountId === a.s.accountId,
      ),
    ).toBe(false);
    expect(
      (await repo.ownersWithLearnedSkills({ ranBefore: new Date(ran.getTime() + 1) })).some(
        (o) => o.accountId === a.s.accountId,
      ),
    ).toBe(true);
    // Without the system connection the cross-account calls refuse to run.
    const tenantOnly = new DrizzleAssistantRepository(tenant);
    await expect(tenantOnly.ownersWithLearnedSkills()).rejects.toThrow(/system connection/);
    await expect(tenantOnly.claimJobs(new Date(), 1, 1_000)).rejects.toThrow(/system connection/);
  });
});

describe('review job retry and enqueue time on Postgres (1c)', () => {
  const running = (id: string, attempts: number) =>
    withSystem(system, (tx) =>
      tx.execute(sql`update assistant_jobs set status = 'running', attempts = ${attempts},
        lease_until = now() + interval '5 minutes' where id = ${id}`),
    );

  it('moves created_at on a re-enqueue, and reads the thread origin', async () => {
    const { s, threadId } = await owner();
    expect((await repo.getThread(s, threadId))?.origin).toBe('chat');
    const runAfter = new Date('2100-01-01T00:00:00.000Z');
    const job = { threadId, kind: 'review' as const, reviewScope: 'combined' as const, runAfter };
    const first = await repo.enqueueJob(s, { id: newId(), ...job });
    await new Promise((r) => setTimeout(r, 5));
    const again = await repo.enqueueJob(s, { id: newId(), ...job });
    expect(again.id).toBe(first.id);
    expect(again.createdAt.getTime()).toBeGreaterThan(first.createdAt.getTime());
    await repo.cancelJob(s, { id: first.id });
  });

  it('re-queues a failed attempt once (fenced), or merges it into the job already queued', async () => {
    const { s, threadId } = await owner();
    const runAfter = new Date('2100-01-01T00:00:00.000Z');
    const retryAt = new Date('2100-01-01T00:10:00.000Z');
    const job = await repo.enqueueJob(s, {
      id: newId(),
      threadId,
      kind: 'review',
      reviewScope: 'memory',
      runAfter,
    });
    await running(job.id, 1);
    const retry = { runAfter: retryAt, errorCode: 'review_failed' };
    expect(await repo.retryJob(s, { id: job.id, attempts: 2 }, retry)).toBe(false);
    const other = await owner();
    expect(await repo.retryJob(other.s, { id: job.id, attempts: 1 }, retry)).toBe(false);
    expect(await repo.retryJob(s, { id: job.id, attempts: 1 }, retry)).toBe(true);
    expect(await repo.getJob(s, job.id)).toMatchObject({
      status: 'queued',
      attempts: 1,
      errorCode: 'review_failed',
      leaseUntil: null,
      runAfter: retryAt,
    });

    // Running again while a newer job of the thread is queued: merged into it, not a second
    // queued row. The queued job takes the retry's earlier run_after and both scopes.
    await running(job.id, 2);
    const later = new Date(retryAt.getTime() + 30 * 60_000);
    const newer = await repo.enqueueJob(s, {
      id: newId(),
      threadId,
      kind: 'review',
      reviewScope: 'skills',
      runAfter: later,
    });
    expect(newer.id).not.toBe(job.id);
    expect(await repo.retryJob(s, { id: job.id, attempts: 2 }, retry)).toBe(true);
    expect(await repo.getJob(s, job.id)).toMatchObject({ status: 'failed', leaseUntil: null });
    expect(await repo.getJob(s, newer.id)).toMatchObject({
      status: 'queued',
      runAfter: retryAt,
      reviewScope: 'combined',
    });
    await repo.cancelJob(s, { id: newer.id });
  });
});
