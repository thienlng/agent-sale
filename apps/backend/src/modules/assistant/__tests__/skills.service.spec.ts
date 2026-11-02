import { newId, userId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { SkillCatalog } from '../application/skill-tools.js';
import {
  SKILL_LIMIT,
  SkillsService,
  type SkillManageInput,
  type SkillWriteContext,
} from '../application/skills.service.js';
import {
  AssistantNotFoundError,
  AssistantSkillConflictError,
  AssistantSkillInvalidError,
  AssistantSkillNameTakenError,
} from '../domain/assistant.errors.js';
import type { OwnerScope } from '../domain/owner-scope.js';
import { InMemoryAssistantRepository } from '../infrastructure/persistence/assistant.in-memory-repository.js';

const PLATFORM = [
  {
    name: 'add-products',
    description: 'Add products to the catalog',
    toolsets: ['ui'],
    version: 1,
    body: 'Open /app/products/new.',
  },
  {
    name: 'read-revenue',
    description: 'Read the revenue report',
    toolsets: ['routes'],
    version: 1,
    body: 'Open /app/analytics.',
  },
];

function setup() {
  const repo = new InMemoryAssistantRepository();
  const service = new SkillsService(repo, new SkillCatalog(PLATFORM));
  const business = workspaceId(newId());
  const scope: OwnerScope = {
    accountId: newId(),
    ownerUserId: userId(newId()),
    businessId: business,
    businessIds: [business],
  };
  const ctx = (actor: 'assistant' | 'review', loaded: string[] = []): SkillWriteContext => ({
    actor,
    runId: null,
    loadedSkills: new Set(loaded),
  });
  const manage = (c: SkillWriteContext, input: SkillManageInput) => service.manage(scope, c, input);
  return { repo, service, scope, ctx, manage };
}

const SAVE = {
  action: 'create' as const,
  name: 'weekly-sale',
  description: 'Run the weekly sale',
  body: '1. Open /app/products.\n2. Lower prices by 10%.',
};

describe('SkillsService catalog', () => {
  it('shows platform skills, then active rows, as a byte-stable name: description index', async () => {
    const { service, scope, manage, ctx } = setup();
    await manage(ctx('assistant'), SAVE);
    await manage(ctx('review'), { ...SAVE, name: 'pending-one' });
    const catalog = await service.catalog(scope);
    expect(catalog.entries.map((e) => e.name)).toEqual([
      'add-products',
      'read-revenue',
      'weekly-sale',
    ]);
    expect(catalog.index()).toBe(
      [
        '- add-products: Add products to the catalog',
        '- read-revenue: Read the revenue report',
        '- weekly-sale: Run the weekly sale',
      ].join('\n'),
    );
  });

  it('replaces a platform skill with the owner shadow, in the index and in load_skill', async () => {
    const { service, scope } = setup();
    const shadow = await service.shadow(scope, 'add-products');
    expect(shadow).toMatchObject({
      provenance: 'shadow',
      shadowOf: 'add-products',
      state: 'active',
    });
    await service.update(scope, shadow.id!, {
      description: 'Add products the way this shop does',
      body: 'Open /app/products/new and always set a sale price.',
    });

    const catalog = await service.catalog(scope);
    expect(catalog.index()).toContain('- add-products: Add products the way this shop does');
    expect(catalog.index()).not.toContain('Add products to the catalog');
    expect(catalog.entries.filter((e) => e.name === 'add-products')).toHaveLength(1);
    const loaded = await service.load(scope, 'add-products');
    expect(loaded?.body).toBe('Open /app/products/new and always set a sale price.');
    expect((await service.read(scope, shadow.id!)).useCount).toBe(1);

    // The list marks the platform skill shadowed; a second shadow is refused.
    const list = await service.list(scope);
    expect(list.items.find((i) => i.ref === 'platform:add-products')?.shadowed).toBe(true);
    await expect(service.shadow(scope, 'add-products')).rejects.toMatchObject({
      details: { reason: 'shadow_exists' },
    });

    // Deleting the shadow brings the original back.
    await service.deleteShadow(scope, shadow.id!);
    expect((await service.load(scope, 'add-products'))?.body).toBe('Open /app/products/new.');
    await expect(service.deleteShadow(scope, newId())).rejects.toBeInstanceOf(
      AssistantNotFoundError,
    );
  });
});

describe('skill_manage', () => {
  it('chat create makes an active owner skill with a ledger row; names stay unique', async () => {
    const { manage, ctx, repo, scope } = setup();
    expect(await manage(ctx('assistant'), SAVE)).toMatchObject({ ok: true, state: 'active' });
    const [row] = await repo.listSkills(scope);
    expect(row).toMatchObject({ provenance: 'owner', state: 'active' });
    const events = await repo.listSkillEvents(scope, { skillId: row!.id });
    expect(events).toMatchObject([{ actor: 'assistant', action: 'create', before: null }]);

    expect(await manage(ctx('assistant'), SAVE)).toEqual({ ok: false, errorCode: 'name_taken' });
    expect(await manage(ctx('assistant'), { ...SAVE, name: 'add-products' })).toEqual({
      ok: false,
      errorCode: 'name_taken',
    });
  });

  it('refuses a skill the linter rejects', async () => {
    const { manage, ctx } = setup();
    const out = await manage(ctx('assistant'), {
      ...SAVE,
      body: 'Call the customer at 0912345678 and visit https://evil.test',
    });
    expect(out.ok).toBe(false);
    expect(!out.ok && out.errorCode).toMatch(/^invalid_skill:.*safety/);
    expect(await manage(ctx('assistant'), { ...SAVE, name: 'Bad Name' })).toMatchObject({
      ok: false,
      errorCode: expect.stringMatching(/^invalid_skill:name must match/),
    });
    expect(await manage(ctx('assistant'), { action: 'create', name: 'x' })).toMatchObject({
      errorCode: 'missing_fields',
    });
  });

  it('never patches a platform skill or its shadow: platform_skill_immutable', async () => {
    const { manage, ctx, service, scope } = setup();
    const patch = { action: 'patch' as const, name: 'add-products', body: 'New steps' };
    expect(await manage(ctx('assistant', ['add-products']), patch)).toMatchObject({
      errorCode: 'platform_skill_immutable',
    });
    expect(await manage(ctx('review', ['add-products']), patch)).toMatchObject({
      errorCode: 'platform_skill_immutable',
    });
    await service.shadow(scope, 'add-products');
    expect(await manage(ctx('review', ['add-products']), patch)).toMatchObject({
      errorCode: 'platform_skill_immutable',
    });
    expect(await manage(ctx('review'), { action: 'archive', name: 'add-products' })).toMatchObject({
      errorCode: 'platform_skill_immutable',
    });
  });

  it('patches only a skill loaded in this run (read-before-write), counting the patch', async () => {
    const { manage, ctx, repo, scope } = setup();
    await manage(ctx('assistant'), SAVE);
    const patch = { action: 'patch' as const, name: SAVE.name, body: '1. Lower prices by 15%.' };
    expect(await manage(ctx('review'), patch)).toMatchObject({ errorCode: 'load_first' });
    expect(await manage(ctx('assistant'), patch)).toMatchObject({ errorCode: 'load_first' });

    expect(await manage(ctx('review', [SAVE.name]), patch)).toMatchObject({ ok: true });
    const [row] = await repo.listSkills(scope);
    expect(row).toMatchObject({ body: '1. Lower prices by 15%.', patchCount: 1 });
    const [last] = await repo.listSkillEvents(scope, { skillId: row!.id });
    expect(last).toMatchObject({
      actor: 'review',
      action: 'patch',
      before: { body: SAVE.body },
      after: { body: '1. Lower prices by 15%.' },
    });
    expect(await manage(ctx('review', ['nope']), { ...patch, name: 'nope' })).toMatchObject({
      errorCode: 'unknown_skill',
    });
  });

  it('review create waits for approval; approve makes it active and part of the catalog', async () => {
    const { manage, ctx, service, scope, repo } = setup();
    const review = ctx('review');
    expect(await manage(review, SAVE)).toMatchObject({ ok: true, state: 'pending_approval' });
    const [row] = await repo.listSkills(scope);
    expect(row).toMatchObject({ provenance: 'learned', state: 'pending_approval' });
    expect((await service.catalog(scope)).get(SAVE.name)).toBeUndefined();
    // Created in this run: the review may refine it without loading it.
    expect(
      await manage(review, { action: 'patch', name: SAVE.name, description: 'Weekly sale' }),
    ).toMatchObject({ ok: true });

    const approved = await service.approve(scope, row!.id);
    expect(approved.state).toBe('active');
    expect((await service.catalog(scope)).index()).toContain('- weekly-sale: Weekly sale');
    await expect(service.approve(scope, row!.id)).rejects.toMatchObject({
      details: { reason: 'skill_not_pending' },
    });
  });

  it('lets only the review archive, and only learned skills', async () => {
    const { manage, ctx, repo, scope } = setup();
    await manage(ctx('assistant'), SAVE);
    await manage(ctx('review'), { ...SAVE, name: 'learned-one' });
    expect(await manage(ctx('assistant'), { action: 'archive', name: SAVE.name })).toMatchObject({
      errorCode: 'not_allowed',
    });
    expect(await manage(ctx('review'), { action: 'archive', name: SAVE.name })).toMatchObject({
      errorCode: 'not_allowed',
    });
    expect(await manage(ctx('review'), { action: 'archive', name: 'learned-one' })).toMatchObject({
      ok: true,
      state: 'archived',
    });
    expect((await repo.listSkills(scope, { states: ['archived'] })).map((x) => x.name)).toEqual([
      'learned-one',
    ]);
  });

  it(`stops at ${SKILL_LIMIT} live owner and learned skills`, async () => {
    const { manage, ctx, repo, scope, service } = setup();
    for (let i = 0; i < SKILL_LIMIT; i++) {
      await repo.createSkill(scope, {
        id: newId(),
        name: `skill-${i}`,
        description: 'd',
        body: 'b',
        toolsets: [],
        provenance: i % 2 ? 'owner' : 'learned',
        shadowOf: null,
        state: i % 3 ? 'active' : 'pending_approval',
      });
    }
    expect(await manage(ctx('assistant'), SAVE)).toMatchObject({ errorCode: 'skill_limit' });
    await expect(
      service.create(scope, { name: 'one-more', description: 'd', body: 'b' }),
    ).rejects.toMatchObject({ details: { reason: 'skill_limit' } });
    // A shadow is not counted.
    await expect(service.shadow(scope, 'read-revenue')).resolves.toMatchObject({ state: 'active' });
  });
});

describe('owner skill routes', () => {
  it('creates, edits, archives and restores with a ledger row each', async () => {
    const { service, scope } = setup();
    const created = await service.create(scope, {
      name: 'reply-reviews',
      description: 'Reply to reviews',
      body: 'Thank the customer first.',
    });
    expect(created).toMatchObject({ provenance: 'owner', state: 'active' });
    await expect(
      service.create(scope, { name: 'reply-reviews', description: 'd', body: 'b' }),
    ).rejects.toBeInstanceOf(AssistantSkillNameTakenError);
    await expect(
      service.create(scope, { name: 'x', description: 'd', body: 'mail me at a@b.vn' }),
    ).rejects.toBeInstanceOf(AssistantSkillInvalidError);

    await service.update(scope, created.id!, { pinned: true });
    await service.update(scope, created.id!, { body: 'Thank the customer, then answer.' });
    await service.archive(scope, created.id!);
    await expect(service.archive(scope, created.id!)).rejects.toBeInstanceOf(
      AssistantSkillConflictError,
    );
    const restored = await service.restore(scope, created.id!);
    expect(restored).toMatchObject({ state: 'active', pinned: true, patchCount: 1 });

    const events = await service.events(scope, created.id!);
    // A pin alone writes no ledger row.
    expect(events.items.map((e) => e.action)).toEqual(['restore', 'archive', 'patch', 'create']);
    expect(events.items.every((e) => e.actor === 'owner')).toBe(true);
  });

  it('rejects a pending learned skill', async () => {
    const { service, scope, manage, ctx, repo } = setup();
    await manage(ctx('review'), SAVE);
    const [row] = await repo.listSkills(scope);
    expect((await service.reject(scope, row!.id)).state).toBe('archived');
    await expect(service.reject(scope, row!.id)).rejects.toMatchObject({
      details: { reason: 'skill_not_pending' },
    });
  });

  it('undoes a patch: the body comes back; a second undo or a stale snapshot is refused', async () => {
    const { service, scope, manage, ctx } = setup();
    await manage(ctx('assistant'), SAVE);
    await manage(ctx('review', [SAVE.name]), {
      action: 'patch',
      name: SAVE.name,
      body: 'A worse procedure',
    });
    const skillId = (await service.list(scope)).items.find((i) => i.name === SAVE.name)!.id!;
    const [patch] = (await service.events(scope, skillId)).items;
    expect(patch?.action).toBe('patch');

    const undone = await service.undo(scope, patch!.id);
    expect(undone.body).toBe(SAVE.body);
    const events = (await service.events(scope, skillId)).items;
    expect(events[0]).toMatchObject({ action: 'undo', actor: 'owner' });
    expect(events.find((e) => e.id === patch!.id)?.undoneAt).not.toBeNull();
    await expect(service.undo(scope, patch!.id)).rejects.toMatchObject({
      details: { reason: 'event_already_undone' },
    });
    await expect(service.undo(scope, events[0]!.id)).rejects.toMatchObject({
      details: { reason: 'event_not_undoable' },
    });

    // The skill matches its create snapshot again, so undoing the create archives it.
    const create = events.find((e) => e.action === 'create')!;
    expect((await service.undo(scope, create.id)).state).toBe('archived');
  });

  it('refuses an undo when the skill changed since the entry (stale snapshot)', async () => {
    const { service, scope } = setup();
    const created = await service.create(scope, { name: 'a', description: 'd', body: 'one' });
    await service.update(scope, created.id!, { body: 'two' });
    await service.update(scope, created.id!, { body: 'three' });
    const [, older] = (await service.events(scope, created.id!)).items;
    expect(older?.after?.body).toBe('two');
    await expect(service.undo(scope, older!.id)).rejects.toMatchObject({
      details: { reason: 'stale_skill' },
    });
    await expect(service.undo(scope, newId())).rejects.toBeInstanceOf(AssistantNotFoundError);
  });

  it("hides another owner's skills and ledger (404)", async () => {
    const { service, scope, repo } = setup();
    const created = await service.create(scope, { name: 'a', description: 'd', body: 'b' });
    const [event] = (await service.events(scope, created.id!)).items;
    const other = new SkillsService(repo, new SkillCatalog(PLATFORM));
    const otherScope = { ...scope, ownerUserId: userId(newId()) };
    await expect(other.read(otherScope, created.id!)).rejects.toBeInstanceOf(
      AssistantNotFoundError,
    );
    await expect(other.undo(otherScope, event!.id)).rejects.toBeInstanceOf(AssistantNotFoundError);
    await expect(other.approve(otherScope, created.id!)).rejects.toBeInstanceOf(
      AssistantNotFoundError,
    );
    expect((await other.list(otherScope)).items.every((i) => i.provenance === 'platform')).toBe(
      true,
    );
    expect((await other.read(otherScope, 'platform:read-revenue')).body).toBe(
      'Open /app/analytics.',
    );
    await expect(other.read(otherScope, 'platform:nope')).rejects.toBeInstanceOf(
      AssistantNotFoundError,
    );
  });
});
