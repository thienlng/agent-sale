import { newId, userId, workspaceId, type UserId, type WorkspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import type { AccountFacade, AccountMembership } from '../../account/api/index.js';
import type { WorkspaceFacade, WorkspaceMembership } from '../../workspace/api/index.js';
import { AssistantFacadeImpl } from '../application/assistant.facade.impl.js';
import { ChatTurnService } from '../application/chat-turn.service.js';
import { SkillCatalog } from '../application/skill-tools.js';
import {
  AssistantBusyError,
  AssistantForbiddenError,
  AssistantNotFoundError,
} from '../domain/assistant.errors.js';
import { InMemoryAssistantRepository } from '../infrastructure/persistence/assistant.in-memory-repository.js';

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
  const skills = new SkillCatalog([SKILL]);
  const chat = new ChatTurnService(repo, { generate }, skills);
  const facade = new AssistantFacadeImpl(world.account, world.workspace, repo, chat, skills);
  const me = { userId: world.owner, businessId: world.business };
  return { ...world, repo, facade, me, generate };
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
    expect(stored.systemPrompt).toContain('- Thời trang Mây (retail)');
    expect(stored.systemPrompt).not.toContain('Elsewhere');
    expect(stored.systemPrompt).toMatch(/Today is \d{4}-\d{2}-\d{2} \(Asia\/Ho_Chi_Minh\)\./);
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

  it('runs a chat turn for the owner only, idempotent by turnId', async () => {
    const { facade, me, generate, addAccountMember, repo, accountId } = setup();
    const t = await facade.createThread({ ...me, ownerName: null }, {});
    const turnId = newId();
    const out = await facade.sendMessage(me, t.id, { turnId, text: 'Chào em' });
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
    expect(await facade.sendMessage(me, t.id, { turnId, text: 'Chào em' })).toEqual(out);
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
      facade.sendMessage(me, t.id, { turnId: newId(), text: 'Nữa' }),
    ).rejects.toBeInstanceOf(AssistantBusyError);

    const billing = { ...me, userId: addAccountMember('billing') };
    await expect(
      facade.sendMessage(billing, t.id, { turnId: newId(), text: 'x' }),
    ).rejects.toBeInstanceOf(AssistantForbiddenError);
    const second = { ...me, userId: addAccountMember('owner') };
    await expect(
      facade.sendMessage(second, t.id, { turnId: newId(), text: 'x' }),
    ).rejects.toBeInstanceOf(AssistantNotFoundError);
    await expect(
      facade.sendMessage(me, 'not-a-uuid', { turnId: newId(), text: 'x' }),
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
});
