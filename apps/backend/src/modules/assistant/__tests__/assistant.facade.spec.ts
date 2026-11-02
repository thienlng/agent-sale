import { newId, userId, workspaceId, type UserId, type WorkspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import type { AccountFacade, AccountMembership } from '../../account/api/index.js';
import type { WorkspaceFacade, WorkspaceMembership } from '../../workspace/api/index.js';
import { AssistantFacadeImpl } from '../application/assistant.facade.impl.js';
import { ChatTurnService } from '../application/chat-turn.service.js';
import { CompactionService } from '../application/compaction.service.js';
import { ProposalService } from '../application/proposals.service.js';
import { SkillCatalog } from '../application/skill-tools.js';
import { AssistantSettingsService } from '../application/settings.service.js';
import { SkillsService } from '../application/skills.service.js';
import { SuggestionsService } from '../application/suggestions.service.js';
import { ThreadPromptService } from '../application/thread-prompt.service.js';
import {
  AssistantBusyError,
  AssistantForbiddenError,
  AssistantNotFoundError,
  AssistantProposalConflictError,
} from '../domain/assistant.errors.js';
import type { RouteInvocation, RouteInvocationResult } from '../domain/ports/route-invoker.port.js';
import { InMemoryAssistantRepository } from '../infrastructure/persistence/assistant.in-memory-repository.js';

const AUTH = 'Bearer owner-token';

/** One account with one business, and facades that answer like the real ones for it. */
function ownerWorld() {
  const accountId = newId();
  const owner = userId(newId());
  const business = workspaceId(newId());
  const roles = new Map<UserId, AccountMembership[]>([
    [owner, [{ accountId, name: 'Account', role: 'owner' }]],
  ]);
  const memberships: WorkspaceMembership[] = [
    {
      workspaceId: business,
      workspaceName: 'Thời trang Mây',
      role: 'owner',
      industry: 'retail',
      accountId,
    },
    {
      workspaceId: workspaceId(newId()),
      workspaceName: 'Elsewhere',
      role: 'sales',
      industry: 'fnb',
      accountId: newId(),
    },
  ];
  const account = {
    listForUser: (u: UserId) => Promise.resolve(roles.get(u) ?? []),
  } as unknown as AccountFacade;
  const workspace = {
    accountOf: (w: WorkspaceId) => Promise.resolve(w === business ? accountId : null),
    listMemberships: () => Promise.resolve(memberships),
  } as unknown as WorkspaceFacade;
  /** Adds a user to the account with `role`. */
  const addAccountMember = (role: 'owner' | 'billing') => {
    const u = userId(newId());
    roles.set(u, [{ accountId, name: 'Account', role }]);
    return u;
  };
  return { accountId, owner, business, account, workspace, addAccountMember };
}

const SKILL = {
  name: 'add-products',
  description: 'Add products to the catalog',
  toolsets: ['ui'],
  version: 1,
  body: 'Open /app/products/new.',
};

function setup() {
  const world = ownerWorld();
  const repo = new InMemoryAssistantRepository();
  const generate = vi.fn(() =>
    Promise.resolve({
      text: 'Dạ em chào anh/chị ạ',
      toolCalls: [],
      stopReason: 'end' as const,
      usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 0 },
      provider: 'fake',
      model: 'fake-pro',
      latencyMs: 1,
    }),
  );
  const skills = new SkillsService(repo, new SkillCatalog([SKILL]));
  const invoke = vi.fn((_i: RouteInvocation): Promise<RouteInvocationResult> =>
    Promise.resolve({ status: 200, body: { id: 'p1' } }),
  );
  const invoker = { invoke };
  const prompts = new ThreadPromptService(world.workspace, repo, skills);
  const compaction = new CompactionService(repo, { generate }, prompts);
  const chat = new ChatTurnService(repo, { generate }, skills, invoker, compaction);
  const proposals = new ProposalService(repo, invoker);
  const facade = new AssistantFacadeImpl(
    world.account,
    world.workspace,
    repo,
    chat,
    prompts,
    proposals,
    skills,
    new AssistantSettingsService(repo),
    new SuggestionsService(repo, skills),
  );
  const me = { userId: world.owner, businessId: world.business };
  return { ...world, repo, facade, me, generate, invoke, proposals };
}

/** Contract test: the public API behaves as MODULE.md promises. */
describe('AssistantFacade (contract)', () => {
  it('creates a thread with a frozen system prompt about the owner and their account', async () => {
    const { facade, me, repo, accountId } = setup();
    const thread = await facade.createThread({ ...me, ownerName: 'Lan' }, { title: 'Giá' });
    expect(thread).toMatchObject({
      title: 'Giá',
      pinned: false,
      archived: false,
      businessId: me.businessId,
    });
    const stored = repo.threads.get(thread.id)!;
    expect(stored).toMatchObject({
      accountId,
      ownerUserId: me.userId,
      promptVersion: 'assistant@2',
    });
    expect(stored.systemPrompt).toContain('personal assistant of Lan,');
    expect(stored.systemPrompt).toContain(`- Thời trang Mây (retail) — id ${me.businessId}`);
    expect(stored.systemPrompt).not.toContain('Elsewhere');
    expect(stored.systemPrompt).toMatch(/Today is \d{4}-\d{2}-\d{2} \(Asia\/Ho_Chi_Minh\)\./);
  });

  it('freezes the owner skills index in a new thread: a shadow replaces its platform skill', async () => {
    const { facade, me, repo, addAccountMember } = setup();
    const shadow = await facade.shadowSkill(me, 'add-products');
    await facade.updateSkill(me, shadow.id!, { description: 'Add products with a sale price' });
    await facade.createSkill(me, { name: 'weekly-sale', description: 'Run the sale', body: 'Go.' });
    const thread = await facade.createThread({ ...me, ownerName: 'Lan' }, {});
    const prompt = repo.threads.get(thread.id)!.systemPrompt;
    expect(prompt).toContain(
      '- add-products: Add products with a sale price\n- weekly-sale: Run the sale',
    );
    expect(prompt).not.toContain('Add products to the catalog');

    // Billing members are refused like every assistant call.
    const billing = { userId: addAccountMember('billing'), businessId: me.businessId };
    await expect(facade.listSkills(billing)).rejects.toBeInstanceOf(AssistantForbiddenError);
  });

  it('reads the owner memberships once per request', async () => {
    const { facade, me, workspace } = setup();
    const list = vi.spyOn(workspace, 'listMemberships');
    await facade.createThread({ ...me, ownerName: 'Lan' }, {});
    expect(list).toHaveBeenCalledTimes(1);
    list.mockClear();
    await facade.getMemory(me);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('lists, searches and updates the owner threads', async () => {
    const { facade, me } = setup();
    const a = await facade.createThread({ ...me, ownerName: null }, { title: 'Giá áo' });
    const b = await facade.createThread({ ...me, ownerName: null }, {});
    await facade.updateThread(me, b.id, { pinned: true });
    expect((await facade.listThreads(me, {})).data.map((t) => t.id)).toEqual([b.id, a.id]);
    expect((await facade.listThreads(me, { q: 'gia ao' })).data.map((t) => t.id)).toEqual([a.id]);
    await facade.updateThread(me, a.id, { archived: true });
    expect((await facade.listThreads(me, { archived: 'true' })).data.map((t) => t.id)).toEqual([
      a.id,
    ]);
  });

  it('hides tool rows from the visible messages', async () => {
    const { facade, me, repo, accountId } = setup();
    const t = await facade.createThread({ ...me, ownerName: null }, {});
    const scope = {
      accountId,
      ownerUserId: me.userId,
      businessId: me.businessId,
      businessIds: [me.businessId],
    };
    const row = {
      toolCalls: null,
      toolCallId: null,
      toolName: null,
      pageContext: null,
      uiActions: [],
      runId: null,
    };
    await repo.appendMessages(scope, t.id, [
      { ...row, id: newId(), role: 'user', content: 'hi' },
      { ...row, id: newId(), role: 'tool', content: '{}', toolCallId: 'c1' },
      {
        ...row,
        id: newId(),
        role: 'assistant',
        content: 'chào',
        uiActions: [{ type: 'navigate', to: 'https://x' }],
      },
    ]);
    const { data } = await facade.listMessages(me, t.id);
    expect(data.map((m) => [m.seq, m.role])).toEqual([
      [1, 'user'],
      [3, 'assistant'],
    ]);
    // A stored action that is not a valid UI action never reaches the client.
    expect(data[1]?.uiActions).toEqual([]);
  });

  it('refuses billing members and hides one owner’s threads from another owner', async () => {
    const { facade, me, addAccountMember } = setup();
    const t = await facade.createThread({ ...me, ownerName: null }, {});
    const billing = { ...me, userId: addAccountMember('billing') };
    await expect(facade.listThreads(billing, {})).rejects.toBeInstanceOf(AssistantForbiddenError);
    const second = { ...me, userId: addAccountMember('owner') };
    expect((await facade.listThreads(second, {})).data).toEqual([]);
    await expect(facade.listMessages(second, t.id)).rejects.toBeInstanceOf(AssistantNotFoundError);
    await expect(facade.updateThread(second, t.id, { title: 'x' })).rejects.toBeInstanceOf(
      AssistantNotFoundError,
    );
    await expect(facade.getRun(me, newId())).rejects.toBeInstanceOf(AssistantNotFoundError);
    await expect(facade.listMessages(me, 'not-a-uuid')).rejects.toBeInstanceOf(
      AssistantNotFoundError,
    );
  });

  it('keeps 👍/👎 on the owner’s own answers; another owner’s message is 404', async () => {
    const { facade, me, addAccountMember } = setup();
    const t = await facade.createThread({ ...me, ownerName: null }, {});
    const out = await facade.sendMessage(me, t.id, { turnId: newId(), text: 'Chào em' }, AUTH);
    const [question, answer] = out.messages;
    expect(answer).toMatchObject({ role: 'assistant', feedback: null });

    await facade.setMessageFeedback(me, answer!.id, { value: -1 });
    expect((await facade.listMessages(me, t.id)).data[1]?.feedback).toBe(-1);
    await facade.setMessageFeedback(me, answer!.id, { value: 1 });
    expect((await facade.listMessages(me, t.id)).data[1]?.feedback).toBe(1);
    await facade.setMessageFeedback(me, answer!.id, { value: 0 });
    expect((await facade.listMessages(me, t.id)).data[1]?.feedback).toBeNull();

    const second = { ...me, userId: addAccountMember('owner') };
    await expect(
      facade.setMessageFeedback(second, answer!.id, { value: 1 }),
    ).rejects.toBeInstanceOf(AssistantNotFoundError);
    // Only assistant answers are rated.
    await expect(facade.setMessageFeedback(me, question!.id, { value: 1 })).rejects.toBeInstanceOf(
      AssistantNotFoundError,
    );
    await expect(facade.setMessageFeedback(me, 'nope', { value: 1 })).rejects.toBeInstanceOf(
      AssistantNotFoundError,
    );
    const billing = { ...me, userId: addAccountMember('billing') };
    await expect(facade.getSettings(billing)).rejects.toBeInstanceOf(AssistantForbiddenError);
    await expect(facade.listSuggestions(billing)).rejects.toBeInstanceOf(AssistantForbiddenError);
  });

  it('runs a chat turn for the owner only, idempotent by turnId', async () => {
    const { facade, me, generate, addAccountMember, repo, accountId } = setup();
    const t = await facade.createThread({ ...me, ownerName: null }, {});
    const turnId = newId();
    const out = await facade.sendMessage(me, t.id, { turnId, text: 'Chào em' }, AUTH);
    expect(out.messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'Chào em'],
      ['assistant', 'Dạ em chào anh/chị ạ'],
    ]);
    expect(out.run).toMatchObject({ id: turnId, status: 'done', outcome: 'done', rounds: 1 });
    expect(out.run.steps).toEqual([
      {
        idx: 0,
        kind: 'model_call',
        toolName: null,
        ok: null,
        ms: expect.any(Number) as unknown,
        errorCode: null,
      },
    ]);
    expect(await facade.sendMessage(me, t.id, { turnId, text: 'Chào em' }, AUTH)).toEqual(out);
    expect(generate).toHaveBeenCalledTimes(1);
    expect((await facade.getRun(me, turnId)).status).toBe('done');

    // Busy while another run of the owner is running.
    const scope = {
      accountId,
      ownerUserId: me.userId,
      businessId: me.businessId,
      businessIds: [me.businessId],
    };
    await repo.startRun(scope, {
      id: newId(),
      threadId: t.id,
      tier: 'pro',
      promptVersion: 'assistant@1',
    });
    await expect(
      facade.sendMessage(me, t.id, { turnId: newId(), text: 'Nữa' }, AUTH),
    ).rejects.toBeInstanceOf(AssistantBusyError);

    const billing = { ...me, userId: addAccountMember('billing') };
    await expect(
      facade.sendMessage(billing, t.id, { turnId: newId(), text: 'x' }, AUTH),
    ).rejects.toBeInstanceOf(AssistantForbiddenError);
    const second = { ...me, userId: addAccountMember('owner') };
    await expect(
      facade.sendMessage(second, t.id, { turnId: newId(), text: 'x' }, AUTH),
    ).rejects.toBeInstanceOf(AssistantNotFoundError);
    await expect(
      facade.sendMessage(me, 'not-a-uuid', { turnId: newId(), text: 'x' }, AUTH),
    ).rejects.toBeInstanceOf(AssistantNotFoundError);
  });

  it('serves the memory to the owner only, and forgets one entry', async () => {
    const { facade, me, repo, accountId, addAccountMember } = setup();
    const scope = {
      accountId,
      ownerUserId: me.userId,
      businessId: me.businessId,
      businessIds: [me.businessId],
    };
    const entry = (id: string, text: string) => ({
      id,
      text,
      origin: 'assistant' as const,
      createdAt: '2026-11-01T00:00:00.000Z',
    });
    const a = newId();
    const b = newId();
    await repo.saveMemoryStore(scope, 'notes', [
      entry(a, 'Giao hàng buổi chiều'),
      entry(b, 'Nghỉ CN'),
    ]);
    await repo.saveMemoryStore(scope, `business:${me.businessId}`, [entry(newId(), 'Bán đồ len')]);
    // A store of a business the owner is not a member of is not shown.
    await repo.saveMemoryStore(scope, `business:${newId()}`, [entry(newId(), 'x')]);

    const memory = await facade.getMemory(me);
    expect(memory.stores.map((st) => [st.store, st.label, st.limit, st.used])).toEqual([
      ['owner_profile', 'owner_profile', 1400, 0],
      ['notes', 'notes', 2200, 27],
      [`business:${me.businessId}`, 'Thời trang Mây', 1000, 10],
    ]);
    expect(memory.stores[1]?.entries).toEqual([
      { id: a, text: 'Giao hàng buổi chiều', createdAt: '2026-11-01T00:00:00.000Z' },
      { id: b, text: 'Nghỉ CN', createdAt: '2026-11-01T00:00:00.000Z' },
    ]);

    const after = await facade.deleteMemoryEntry(me, 'notes', a);
    expect(after.stores[1]).toMatchObject({ used: 7, entries: [{ id: b, text: 'Nghỉ CN' }] });
    expect((await facade.getMemory(me)).stores[1]?.entries.map((e) => e.id)).toEqual([b]);
    await expect(facade.deleteMemoryEntry(me, 'notes', a)).rejects.toBeInstanceOf(
      AssistantNotFoundError,
    );
    await expect(facade.deleteMemoryEntry(me, `business:${newId()}`, b)).rejects.toBeInstanceOf(
      AssistantNotFoundError,
    );

    // Staff (no account role) and billing members are refused; another owner sees nothing.
    const staff = { ...me, userId: userId(newId()) };
    await expect(facade.getMemory(staff)).rejects.toBeInstanceOf(AssistantForbiddenError);
    await expect(facade.deleteMemoryEntry(staff, 'notes', b)).rejects.toBeInstanceOf(
      AssistantForbiddenError,
    );
    const billing = { ...me, userId: addAccountMember('billing') };
    await expect(facade.getMemory(billing)).rejects.toBeInstanceOf(AssistantForbiddenError);
    const second = { ...me, userId: addAccountMember('owner') };
    expect((await facade.getMemory(second)).stores.every((st) => st.entries.length === 0)).toBe(
      true,
    );
  });

  it('freezes the skills index and the memory snapshot into a new thread', async () => {
    const { facade, me, repo, accountId } = setup();
    const scope = {
      accountId,
      ownerUserId: me.userId,
      businessId: me.businessId,
      businessIds: [me.businessId],
    };
    await repo.saveMemoryStore(scope, 'owner_profile', [
      {
        id: newId(),
        text: 'Thích trả lời ngắn',
        origin: 'owner',
        createdAt: '2026-11-01T00:00:00.000Z',
      },
    ]);
    const t = await facade.createThread({ ...me, ownerName: 'Lan' }, {});
    const prompt = repo.threads.get(t.id)!.systemPrompt;
    expect(prompt).toContain('- add-products: Add products to the catalog');
    expect(prompt).toContain('owner_profile [1% — 18/1400]\n- Thích trả lời ngắn');
    // Memory saved later joins new threads only (1b-R6).
    await repo.saveMemoryStore(scope, 'notes', [
      { id: newId(), text: 'Nghỉ CN', origin: 'owner', createdAt: '2026-11-01T00:00:00.000Z' },
    ]);
    expect(repo.threads.get(t.id)!.systemPrompt).toBe(prompt);
  });

  describe('proposals', () => {
    async function withProposal(over: { expiresAt?: Date; businessId?: string } = {}) {
      const ctx = setup();
      const scope = {
        accountId: ctx.accountId,
        ownerUserId: ctx.me.userId,
        businessId: ctx.me.businessId,
        businessIds: [ctx.me.businessId],
      };
      const t = await ctx.facade.createThread({ ...ctx.me, ownerName: null }, {});
      const p = await ctx.repo.createProposal(scope, {
        id: newId(),
        threadId: t.id,
        runId: null,
        businessId: over.businessId ?? ctx.me.businessId,
        routeKey: 'POST /products',
        path: '/products',
        query: null,
        body: { name: 'Áo thun' },
        summary: 'Thêm sản phẩm Áo thun',
        preview: { body: { name: 'Áo thun' }, query: null },
        expiresAt: over.expiresAt ?? new Date(Date.now() + 86_400_000),
      });
      return { ...ctx, scope, t, p };
    }

    it('approves with the approver’s token, records the result and tells the thread', async () => {
      const { facade, me, p, t, invoke } = await withProposal();
      const done = await facade.approveProposal(me, p.id, AUTH);
      expect(done).toMatchObject({ id: p.id, status: 'done', errorCode: null });
      expect(done.decidedAt).not.toBeNull();
      expect(invoke).toHaveBeenCalledWith({
        method: 'post',
        path: '/products',
        body: { name: 'Áo thun' },
        businessId: me.businessId,
        authorization: AUTH,
        idempotencyKey: `asst:${p.id}`,
      });
      const { data } = await facade.listMessages(me, t.id);
      expect(data.map((m) => [m.role, m.content])).toEqual([
        ['event', 'Đã áp dụng: Thêm sản phẩm Áo thun'],
      ]);
      // A second approval finds it decided.
      await expect(facade.approveProposal(me, p.id, AUTH)).rejects.toMatchObject({
        code: 'CONFLICT',
        details: { reason: 'proposal_not_pending' },
      });
      expect(invoke).toHaveBeenCalledTimes(1);
      expect((await facade.listProposals(me, t.id)).items.map((x) => x.status)).toEqual(['done']);
    });

    it('marks a refused execution failed with the HTTP status', async () => {
      const { facade, me, p, t, invoke } = await withProposal();
      invoke.mockResolvedValueOnce({ status: 403, body: { error: { code: 'FORBIDDEN' } } });
      expect(await facade.approveProposal(me, p.id, AUTH)).toMatchObject({
        status: 'failed',
        errorCode: 'http_403',
      });
      const { data } = await facade.listMessages(me, t.id);
      expect(data.at(-1)?.content).toBe('Không áp dụng được: Thêm sản phẩm Áo thun (http_403)');
    });

    it('fails a proposal whose route is no longer a write, without running it', async () => {
      const { facade, me, p, t, invoke, proposals } = await withProposal();
      // A deploy since the proposal turned POST /products into a route the assistant may not use.
      const real = proposals.catalog;
      proposals.catalog = {
        ...real,
        get: (key) => (key === p.routeKey ? undefined : real.get(key)),
      };
      expect(await facade.approveProposal(me, p.id, AUTH)).toMatchObject({
        status: 'failed',
        errorCode: 'route_not_allowed',
      });
      expect(invoke).not.toHaveBeenCalled();
      const { data } = await facade.listMessages(me, t.id);
      expect(data.at(-1)?.content).toBe(
        'Không áp dụng được: Thêm sản phẩm Áo thun (route_not_allowed)',
      );
    });

    it('expires a stale proposal instead of running it', async () => {
      const { facade, me, p, t, invoke } = await withProposal({
        expiresAt: new Date(Date.now() - 1000),
      });
      const err: unknown = await facade.approveProposal(me, p.id, AUTH).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AssistantProposalConflictError);
      expect(err).toMatchObject({ details: { reason: 'proposal_expired' } });
      expect(invoke).not.toHaveBeenCalled();
      expect((await facade.listProposals(me, t.id)).items[0]?.status).toBe('expired');
    });

    it('rejects a pending proposal once, with an event message', async () => {
      const { facade, me, p, t, invoke } = await withProposal();
      expect(await facade.rejectProposal(me, p.id)).toMatchObject({ status: 'rejected' });
      expect(invoke).not.toHaveBeenCalled();
      const { data } = await facade.listMessages(me, t.id);
      expect(data.map((m) => m.content)).toEqual(['Anh/chị đã bỏ: Thêm sản phẩm Áo thun']);
      await expect(facade.rejectProposal(me, p.id)).rejects.toBeInstanceOf(
        AssistantProposalConflictError,
      );
    });

    it('hides proposals of another owner or of a business out of scope', async () => {
      const outside = await withProposal({ businessId: newId() });
      await expect(
        outside.facade.approveProposal(outside.me, outside.p.id, AUTH),
      ).rejects.toBeInstanceOf(AssistantNotFoundError);
      expect(outside.invoke).not.toHaveBeenCalled();

      const { facade, me, p, t, addAccountMember } = await withProposal();
      const second = { ...me, userId: addAccountMember('owner') };
      await expect(facade.approveProposal(second, p.id, AUTH)).rejects.toBeInstanceOf(
        AssistantNotFoundError,
      );
      await expect(facade.rejectProposal(second, p.id)).rejects.toBeInstanceOf(
        AssistantNotFoundError,
      );
      await expect(facade.listProposals(second, t.id)).rejects.toBeInstanceOf(
        AssistantNotFoundError,
      );
      const billing = { ...me, userId: addAccountMember('billing') };
      await expect(facade.approveProposal(billing, p.id, AUTH)).rejects.toBeInstanceOf(
        AssistantForbiddenError,
      );
      await expect(facade.approveProposal(me, 'not-a-uuid', AUTH)).rejects.toBeInstanceOf(
        AssistantNotFoundError,
      );
    });
  });
});
