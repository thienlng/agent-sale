import type { GenerateRequest, GenerateResponse } from '@agent-sales/ai-core';
import { newId, userId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import { AssistantJobRunner, CURATOR_SCAN_MS } from '../application/assistant-runner.js';
import { ChatTurnService, TURN_TOOL_DEFINITIONS } from '../application/chat-turn.service.js';
import { CompactionService } from '../application/compaction.service.js';
import { CuratorService, curatorStep } from '../application/curator.service.js';
import { ReviewService, suggestTool } from '../application/review.service.js';
import { AssistantSettingsService } from '../application/settings.service.js';
import { SkillCatalog } from '../application/skill-tools.js';
import { SkillsService } from '../application/skills.service.js';
import { setupPath, SuggestionsService } from '../application/suggestions.service.js';
import { ThreadPromptService } from '../application/thread-prompt.service.js';
import { TOOLSETS, toolsetCacheSuffix } from '../application/toolsets.js';
import type { AccountFacade } from '../../account/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import {
  AssistantNotFoundError,
  AssistantSettingsInvalidError,
  AssistantSkillInvalidError,
  AssistantSuggestionConflictError,
} from '../domain/assistant.errors.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import type { SkillRecord, SkillState } from '../domain/ports/assistant.repository.js';
import { InMemoryAssistantRepository } from '../infrastructure/persistence/assistant.in-memory-repository.js';

const DAY = 24 * 60 * 60_000;
const NOW = new Date();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

function owner(): OwnerScope {
  const business = workspaceId(newId());
  return {
    accountId: newId(),
    ownerUserId: userId(newId()),
    businessId: business,
    businessIds: [business],
  };
}

function setup() {
  const repo = new InMemoryAssistantRepository();
  const skills = new SkillsService(repo, new SkillCatalog([]));
  const scope = owner();
  /** Users who are active owners of the scope's account (the curator checks). */
  const owners = new Set<string>([scope.ownerUserId]);
  const account = {
    listForUser: (u: string) =>
      Promise.resolve(
        owners.has(u) ? [{ accountId: scope.accountId, name: 'A', role: 'owner' }] : [],
      ),
  } as unknown as AccountFacade;
  const curator = new CuratorService(repo, account);
  const generate = vi.fn((_r: GenerateRequest): Promise<GenerateResponse> => {
    throw new Error('no model call expected');
  });
  const review = new ReviewService(
    repo,
    { generate },
    skills,
    {} as AccountFacade,
    {} as WorkspaceFacade,
  );
  const runner = new AssistantJobRunner(repo, review, curator);
  const settings = new AssistantSettingsService(repo);
  const suggestions = new SuggestionsService(repo, skills);
  return { repo, skills, curator, runner, settings, suggestions, scope, owners, generate };
}

/** A learned skill whose clocks (created, last used, updated) are set back. */
async function learned(
  s: ReturnType<typeof setup>,
  name: string,
  over: {
    state?: SkillState;
    created: number;
    used?: number;
    updated?: number;
    pinned?: boolean;
  },
): Promise<SkillRecord> {
  const row = await s.repo.createSkill(s.scope, {
    id: newId(),
    name,
    description: 'd',
    body: 'b',
    toolsets: [],
    provenance: 'learned',
    shadowOf: null,
    state: over.state ?? 'active',
    pinned: over.pinned ?? false,
  });
  const stored = s.repo.skills.get(row.id)!;
  stored.createdAt = daysAgo(over.created);
  stored.lastUsedAt = over.used === undefined ? null : daysAgo(over.used);
  stored.updatedAt = daysAgo(over.updated ?? over.used ?? over.created);
  return (await s.repo.getSkill(s.scope, row.id))!;
}

describe('curator', () => {
  it('turns an active learned skill stale after 30 idle days, a stale one archived after 90', async () => {
    const s = setup();
    await learned(s, 'idle-29', { created: 29 });
    await learned(s, 'idle-31', { created: 31 });
    await learned(s, 'used-29', { created: 200, used: 29 });
    await learned(s, 'used-31', { created: 200, used: 31 });
    await learned(s, 'stale-89', { state: 'stale', created: 200, used: 89, updated: 10 });
    await learned(s, 'stale-91', { state: 'stale', created: 200, used: 91, updated: 10 });
    await learned(s, 'pinned', { created: 300, pinned: true });
    await learned(s, 'pinned-stale', { state: 'stale', created: 300, pinned: true });
    // Approved or restored lately: the owner just touched it.
    await learned(s, 'touched', { created: 200, used: 100, updated: 3 });
    const job = await s.repo.enqueueJob(s.scope, {
      id: newId(),
      threadId: null,
      kind: 'curator',
      reviewScope: null,
      runAfter: NOW,
    });
    const [claimed] = await s.repo.claimJobs(new Date(), 1, 60_000);
    expect(claimed?.id).toBe(job.id);

    expect(await s.curator.run(claimed!, NOW)).toBe('done');

    const states = Object.fromEntries(
      (await s.repo.listSkills(s.scope)).map((x) => [x.name, x.state]),
    );
    expect(states).toEqual({
      'idle-29': 'active',
      'idle-31': 'stale',
      'used-29': 'active',
      'used-31': 'stale',
      'stale-89': 'stale',
      'stale-91': 'archived',
      pinned: 'active',
      'pinned-stale': 'stale',
      touched: 'active',
    });
    const events = await s.repo.listSkillEvents(s.scope, { actor: 'curator' });
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.action === 'archive' && e.runId === null)).toBe(true);
    expect(events.map((e) => e.after?.state).sort()).toEqual(['archived', 'stale', 'stale']);
    expect(await s.repo.getJob(s.scope, job.id)).toMatchObject({ status: 'done' });
    expect(s.generate).not.toHaveBeenCalled();
  });

  it('skips skills younger than 30 days, owner and shadow skills', () => {
    const base: SkillRecord = {
      id: newId(),
      name: 'x',
      description: 'd',
      body: 'b',
      toolsets: [],
      provenance: 'learned',
      shadowOf: null,
      state: 'active',
      pinned: false,
      useCount: 0,
      viewCount: 0,
      patchCount: 0,
      lastUsedAt: null,
      lastPatchedAt: null,
      createdAt: daysAgo(29),
      updatedAt: daysAgo(29),
    };
    expect(curatorStep(base, NOW)).toBeNull();
    expect(curatorStep({ ...base, createdAt: daysAgo(31), updatedAt: daysAgo(31) }, NOW)).toBe(
      'stale',
    );
    const old = { ...base, createdAt: daysAgo(120), updatedAt: daysAgo(120) };
    expect(curatorStep({ ...old, provenance: 'owner' }, NOW)).toBeNull();
    expect(curatorStep({ ...old, provenance: 'shadow' }, NOW)).toBeNull();
    expect(curatorStep({ ...old, state: 'pending_approval' }, NOW)).toBeNull();
    // One step per run: an active skill idle for 120 days goes stale first.
    expect(curatorStep(old, NOW)).toBe('stale');
  });

  it('undoes a curator change from the ledger', async () => {
    const s = setup();
    const skill = await learned(s, 'idle', { created: 40 });
    const [job] = [
      await s.repo.enqueueJob(s.scope, {
        id: newId(),
        threadId: null,
        kind: 'curator',
        reviewScope: null,
        runAfter: NOW,
      }),
    ];
    const [claimed] = await s.repo.claimJobs(new Date(), 1, 60_000);
    await s.curator.run(claimed ?? job!, NOW);
    const [event] = await s.repo.listSkillEvents(s.scope, { actor: 'curator' });
    expect((await s.skills.undo(s.scope, event!.id)).state).toBe('active');
    expect((await s.repo.getSkill(s.scope, skill.id))?.state).toBe('active');
  });

  it('is scheduled once a day per owner with learned skills, from the runner tick', async () => {
    const s = setup();
    const other = owner();
    await learned(s, 'idle', { created: 40 });
    // An owner with only pending or owner skills has nothing to curate.
    await s.repo.createSkill(other, {
      id: newId(),
      name: 'mine',
      description: 'd',
      body: 'b',
      toolsets: [],
      provenance: 'owner',
      shadowOf: null,
      state: 'active',
    });

    const t0 = new Date();
    await s.runner.tick(t0);
    expect((await s.repo.getSkillByName(s.scope, 'idle'))?.state).toBe('stale');
    expect((await s.repo.getSettings(s.scope)).curatorRanAt).toEqual(t0);
    expect((await s.repo.getSettings(other)).curatorRanAt).toBeNull();
    const curatorJobs = () => [...s.repo.jobs.values()].filter((j) => j.kind === 'curator');
    expect(curatorJobs().map((j) => j.status)).toEqual(['done']);

    // Later the same day (after the scan interval): not again.
    await s.runner.tick(new Date(t0.getTime() + CURATOR_SCAN_MS + 1));
    expect(curatorJobs()).toHaveLength(1);
    // A day later: again (the stale skill is still a learned skill to look at).
    await s.runner.tick(new Date(t0.getTime() + DAY + 1));
    expect(curatorJobs()).toHaveLength(2);
  });

  it('leaves alone a user who is no longer an owner of the account', async () => {
    const s = setup();
    await learned(s, 'idle', { created: 40 });
    // A job enqueued while they were still the owner runs after they lost the role.
    const job = await s.repo.enqueueJob(s.scope, {
      id: newId(),
      threadId: null,
      kind: 'curator',
      reviewScope: null,
      runAfter: NOW,
    });
    s.owners.clear();
    const [claimed] = await s.repo.claimJobs(new Date(), 1, 60_000);
    expect(await s.curator.run(claimed!, NOW)).toBe('done');
    expect((await s.repo.getSkillByName(s.scope, 'idle'))?.state).toBe('active');
    expect(await s.repo.getJob(s.scope, job.id)).toMatchObject({ status: 'done' });

    // And the schedule neither enqueues a job nor writes a settings row for them.
    expect(await s.curator.schedule(new Date(NOW.getTime() + 2 * DAY))).toBe(0);
    expect((await s.repo.getSettings(s.scope)).curatorRanAt).toBeNull();
  });
});

describe('settings and toolsets', () => {
  it('lists every toolset with its tools and last-30-day use', async () => {
    const s = setup();
    const thread = await s.repo.createThread(s.scope, {
      id: newId(),
      title: '',
      systemPrompt: 'P',
      promptVersion: 'assistant@2',
    });
    const step = (runId: string, idx: number, toolName: string | null, kind = 'tool') =>
      s.repo.addStep(s.scope, { runId, idx, kind, toolName, ok: true, ms: 1, errorCode: null });
    const run = newId();
    await s.repo.startRun(s.scope, {
      id: run,
      threadId: thread.id,
      tier: 'pro',
      promptVersion: 'p',
    });
    await step(run, 0, null, 'model_call');
    await step(run, 1, 'tool_search');
    await step(run, 2, 'tool_call');
    await step(run, 3, 'memory');
    await s.repo.finishRun(s.scope, run, { status: 'done' });
    // A run older than 30 days is not counted.
    const old = newId();
    await s.repo.startRun(s.scope, {
      id: old,
      threadId: thread.id,
      tier: 'pro',
      promptVersion: 'p',
    });
    await step(old, 0, 'tool_call');
    s.repo.runs.get(old)!.createdAt = new Date(Date.now() - 31 * DAY);

    const dto = await s.settings.get(s.scope);
    expect(dto).toMatchObject({ reviewEnabled: true, disabledToolsets: [] });
    expect(dto.toolsets).toEqual([
      { id: 'core', labelKey: 'toolsets.core', toolCount: 1, uses30d: 0, locked: true },
      { id: 'ui', labelKey: 'toolsets.ui', toolCount: 3, uses30d: 0, locked: true },
      { id: 'memory', labelKey: 'toolsets.memory', toolCount: 1, uses30d: 1, locked: false },
      { id: 'skills', labelKey: 'toolsets.skills', toolCount: 3, uses30d: 0, locked: false },
      { id: 'routes', labelKey: 'toolsets.routes', toolCount: 3, uses30d: 2, locked: false },
      { id: 'import', labelKey: 'toolsets.import', toolCount: 2, uses30d: 0, locked: false },
      { id: 'sql', labelKey: 'toolsets.sql', toolCount: 2, uses30d: 0, locked: false },
    ]);
  });

  it('maps every turn tool to exactly one toolset', () => {
    const owned = TOOLSETS.flatMap((t) => t.tools);
    expect(new Set(owned).size).toBe(owned.length);
    expect(TURN_TOOL_DEFINITIONS.map((d) => d.name).sort()).toEqual([...owned].sort());
  });

  it('saves review and toolsets, refusing core and ui', async () => {
    const s = setup();
    const saved = await s.settings.update(s.scope, {
      reviewEnabled: false,
      disabledToolsets: ['routes', 'memory', 'routes'],
    });
    expect(saved).toMatchObject({ reviewEnabled: false, disabledToolsets: ['memory', 'routes'] });
    await expect(s.settings.update(s.scope, { disabledToolsets: ['core'] })).rejects.toBeInstanceOf(
      AssistantSettingsInvalidError,
    );
    await expect(s.settings.update(s.scope, { disabledToolsets: ['ui'] })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    // Only the fields sent change.
    expect(await s.settings.update(s.scope, { reviewEnabled: true })).toMatchObject({
      reviewEnabled: true,
      disabledToolsets: ['memory', 'routes'],
    });
    expect(toolsetCacheSuffix(['routes', 'memory'])).toBe(':off=memory,routes');
    expect(toolsetCacheSuffix([])).toBe('');
  });

  it('leaves a disabled toolset out of the chat turn and keys the cache by it', async () => {
    const s = setup();
    const answer: GenerateResponse = {
      text: 'Dạ',
      toolCalls: [],
      stopReason: 'end',
      usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 },
      provider: 'fake',
      model: 'fake',
      latencyMs: 1,
    };
    const generate = vi.fn((_r: GenerateRequest) => Promise.resolve(answer));
    const workspace = { listMemberships: () => Promise.resolve([]) } as unknown as WorkspaceFacade;
    const compaction = new CompactionService(
      s.repo,
      { generate },
      new ThreadPromptService(workspace, s.repo, s.skills),
    );
    const chat = new ChatTurnService(
      s.repo,
      { generate },
      s.skills,
      { invoke: vi.fn() },
      compaction,
    );
    const thread = await s.repo.createThread(s.scope, {
      id: newId(),
      title: '',
      systemPrompt: 'P',
      promptVersion: 'assistant@2',
    });
    const send = () => chat.send(s.scope, thread.id, { turnId: newId(), text: 'Chào' }, 'Bearer t');

    await send();
    const first = generate.mock.calls[0]![0];
    expect(first.tools?.map((t) => t.name)).toContain('tool_call');
    expect(first.promptCacheKey).toBe(`asst:${s.scope.ownerUserId}:${thread.id}`);

    await s.settings.update(s.scope, { disabledToolsets: ['skills', 'routes'] });
    await send();
    const second = generate.mock.calls[1]![0];
    expect(second.tools?.map((t) => t.name)).toEqual([
      'import_preview',
      'import_propose',
      'memory',
      'session_search',
      'ui_fill_form',
      'ui_navigate',
      'ui_spotlight',
    ]);
    expect(second.promptCacheKey).toBe(
      `asst:${s.scope.ownerUserId}:${thread.id}:off=routes,skills`,
    );
  });
});

describe('suggestions', () => {
  const add = (s: ReturnType<typeof setup>, kind: string, key: string, payload: object) =>
    suggestTool({ scope: s.scope, repo: s.repo }).run({
      kind,
      dedup_key: key,
      title: 'Gợi ý',
      payload,
    });

  it('accepts a skill card as a learned draft for approval, a setup card with its page, a schedule card as is', async () => {
    const s = setup();
    await add(s, 'skill', 'skill:weekly-sale', {
      name: 'weekly-sale',
      description: 'Run the weekly sale',
      body: '1. Open /app/products.',
    });
    await add(s, 'setup', 'setup:zalo', { path: '/app/channels' });
    await add(s, 'schedule', 'schedule:weekly-revenue', { cron: 'Mon 8:00' });
    const pending = (await s.suggestions.listPending(s.scope)).items;
    expect(pending).toHaveLength(3);
    const byKind = (k: string) => pending.find((x) => x.kind === k)!;

    const skill = await s.suggestions.accept(s.scope, byKind('skill').id);
    expect(skill).toMatchObject({
      suggestion: { status: 'accepted' },
      skill: { name: 'weekly-sale', provenance: 'learned', state: 'pending_approval' },
      path: null,
    });
    // Not an active owner skill: it waits on the normal approval card, written by the review.
    const [created] = await s.repo.listSkillEvents(s.scope, { skillId: skill.skill!.id! });
    expect(created).toMatchObject({ actor: 'review', action: 'create' });
    expect((await s.skills.catalog(s.scope)).get('weekly-sale')).toBeUndefined();
    expect(await s.suggestions.accept(s.scope, byKind('setup').id)).toMatchObject({
      skill: null,
      path: '/app/channels',
    });
    expect(await s.suggestions.accept(s.scope, byKind('schedule').id)).toMatchObject({
      suggestion: { kind: 'schedule', status: 'accepted' },
      skill: null,
      path: null,
    });
    expect((await s.suggestions.listPending(s.scope)).items).toEqual([]);
    await expect(s.suggestions.accept(s.scope, byKind('setup').id)).rejects.toBeInstanceOf(
      AssistantSuggestionConflictError,
    );
  });

  it('keeps a skill card pending when its skill is refused', async () => {
    const s = setup();
    await add(s, 'skill', 'skill:bad', { name: 'Bad Name', description: 'd', body: 'b' });
    const [card] = (await s.suggestions.listPending(s.scope)).items;
    await expect(s.suggestions.accept(s.scope, card!.id)).rejects.toBeInstanceOf(
      AssistantSkillInvalidError,
    );
    expect((await s.suggestions.listPending(s.scope)).items).toHaveLength(1);
  });

  it('dismisses for good: the same dedup key is never suggested again', async () => {
    const s = setup();
    await add(s, 'schedule', 'schedule:weekly-revenue', {});
    const [card] = (await s.suggestions.listPending(s.scope)).items;
    expect(await s.suggestions.dismiss(s.scope, card!.id)).toMatchObject({ status: 'dismissed' });
    const again = await add(s, 'schedule', 'schedule:weekly-revenue', {});
    expect(JSON.parse(again.content)).toMatchObject({ ok: false, errorCode: 'already_suggested' });
    expect((await s.suggestions.listPending(s.scope)).items).toEqual([]);
    await expect(s.suggestions.dismiss(s.scope, card!.id)).rejects.toBeInstanceOf(
      AssistantSuggestionConflictError,
    );
  });

  it("hides another owner's suggestion (404)", async () => {
    const s = setup();
    await add(s, 'setup', 'setup:x', {});
    const [card] = (await s.suggestions.listPending(s.scope)).items;
    await expect(s.suggestions.accept(owner(), card!.id)).rejects.toBeInstanceOf(
      AssistantNotFoundError,
    );
    await expect(s.suggestions.dismiss(s.scope, 'nope')).rejects.toBeInstanceOf(
      AssistantNotFoundError,
    );
  });

  it('returns only safe in-app setup paths', () => {
    expect(setupPath({ path: '/app/settings/channels?tab=zalo' })).toBe(
      '/app/settings/channels?tab=zalo',
    );
    expect(setupPath({ path: '/app' })).toBe('/app');
    for (const path of ['https://evil.test', '//evil.test', '/apps', '/app/../x', '/app\\x', 7]) {
      expect(setupPath({ path })).toBeNull();
    }
  });
});
