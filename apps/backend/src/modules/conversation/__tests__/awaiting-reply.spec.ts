import type { ConversationView } from '@agent-sales/contracts';
import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { ConversationFacadeImpl } from '../application/conversation.facade.impl.js';
import { newConversation } from '../domain/conversation-state.js';
import { fakeCrm, fakeIdentity, fakeTeam } from './fakes.js';
import { MemoryConversationStore } from './factories/memory-conversation-store.js';

/** `awaitingReply` for owner reports (T-172): open conversations waiting since a threshold. */
const ws = workspaceId(newId());
const other = workspaceId(newId());

function conv(
  provider: ConversationView['provider'],
  awaitingSince: string | null,
  over: Partial<ConversationView> = {},
): ConversationView {
  return {
    ...newConversation({
      id: newId(),
      channelId: newId(),
      botId: null,
      provider,
      customerId: newId(),
      mode: 'bot',
      echo: false,
      occurredAt: new Date('2026-11-02T00:00:00Z'),
      at: '2026-11-02T00:00:00.000Z',
    }),
    awaitingSince,
    ...over,
  };
}

describe('awaitingReply (memory store)', () => {
  it('counts open conversations waiting at or before the threshold, by channel', async () => {
    const store = new MemoryConversationStore();
    const threshold = new Date('2026-11-02T02:00:00Z');
    const oldest = conv('facebook', '2026-11-02T00:30:00.000Z');
    const exact = conv('website', '2026-11-02T02:00:00.000Z');
    const fb2 = conv('facebook', '2026-11-02T01:00:00.000Z');
    const tooRecent = conv('facebook', '2026-11-02T02:00:01.000Z');
    const resolved = conv('instagram', '2026-11-02T00:00:00.000Z', { status: 'resolved' });
    const answered = conv('facebook', null);
    await store.run(ws, async (tx) => {
      for (const c of [oldest, exact, fb2, tooRecent, resolved, answered]) await tx.save(c);
    });
    await store.run(other, (tx) => tx.save(conv('facebook', '2026-11-01T00:00:00.000Z')));

    const res = await store.run(ws, (tx) => tx.awaitingReply({ olderThan: threshold, limit: 2 }));
    expect(res).toEqual({
      count: 3,
      oldestSince: '2026-11-02T00:30:00.000Z',
      byChannel: [
        { channel: 'facebook', count: 2 },
        { channel: 'website', count: 1 },
      ],
      ids: [oldest.id, fb2.id],
    });
    const none = await store.run(ws, (tx) =>
      tx.awaitingReply({ olderThan: new Date('2026-11-01T00:00:00Z'), limit: 200 }),
    );
    expect(none).toEqual({ count: 0, oldestSince: null, byChannel: [], ids: [] });
  });
});

describe('todayCandidates (memory store)', () => {
  it('returns asked ids, open conversations waiting long enough and reminders due, never spam', async () => {
    const store = new MemoryConversationStore();
    const asked = conv('facebook', null);
    const waiting = conv('facebook', '2026-11-02T00:00:00.000Z');
    const fresh = conv('facebook', '2026-11-02T05:00:00.000Z');
    const reminder = conv('website', null, { followUpAt: '2026-11-02T10:00:00.000Z' });
    const spam = conv('facebook', null, {
      status: 'spam',
      followUpAt: '2026-11-02T01:00:00.000Z',
    });
    await store.run(ws, async (tx) => {
      for (const c of [asked, waiting, fresh, reminder, spam]) await tx.save(c);
    });
    const rows = await store.run(ws, (tx) =>
      tx.todayCandidates({
        ids: [asked.id],
        awaitingBefore: new Date('2026-11-02T01:00:00Z'),
        followUpBefore: new Date('2026-11-02T17:00:00Z'),
        limit: 100,
      }),
    );
    expect(rows.map((r) => r.conversation.id).sort()).toEqual(
      [asked.id, waiting.id, reminder.id].sort(),
    );
    expect(rows.every((r) => r.lastHumanReplyAt === null)).toBe(true);
  });

  it('keeps a member to their own and unassigned conversations before the limit', async () => {
    const store = new MemoryConversationStore();
    const me = '0190f5c2-0000-7000-8000-0000000000b2';
    const other = '0190f5c2-0000-7000-8000-0000000000b9';
    const mine = conv('facebook', '2026-11-02T00:00:00.000Z', { assigneeId: me });
    const free = conv('facebook', '2026-11-02T00:00:00.000Z');
    const theirs = conv('facebook', '2026-11-02T00:00:00.000Z', { assigneeId: other });
    await store.run(ws, async (tx) => {
      for (const c of [mine, free, theirs]) await tx.save(c);
    });
    const rows = await store.run(ws, (tx) =>
      tx.todayCandidates({
        ids: [theirs.id],
        awaitingBefore: new Date('2026-11-02T01:00:00Z'),
        followUpBefore: new Date('2026-11-02T17:00:00Z'),
        limit: 100,
        visibleTo: me,
        lastHumanFor: [],
      }),
    );
    expect(rows.map((r) => r.conversation.id).sort()).toEqual([mine.id, free.id].sort());
  });
});

describe('todayCandidates (facade)', () => {
  it("shows the linked customer's name instead of a website placeholder (MS3-5)", async () => {
    const store = new MemoryConversationStore();
    const contactId = newId();
    const visitor = conv('website', '2026-11-02T00:00:00.000Z', {
      customerName: 'Khách website 51d4',
      contactId,
    });
    const named = conv('facebook', '2026-11-02T00:00:00.000Z', { customerName: 'Trần Minh' });
    await store.run(ws, async (tx) => {
      for (const c of [visitor, named]) await tx.save(c);
    });
    const crm = fakeCrm();
    crm.contactNames.mockResolvedValue(new Map([[contactId, 'Phạm Ngọc Hân']]));
    const facade = new ConversationFacadeImpl(
      store,
      {} as never,
      { getBot: async () => ({}) } as never,
      fakeTeam(),
      fakeIdentity(),
      crm as never,
    );
    const rows = await facade.todayCandidates(ws, {
      ids: [],
      awaitingBefore: new Date('2026-11-02T01:00:00Z'),
      followUpBefore: new Date('2026-11-02T17:00:00Z'),
      limit: 100,
      lastHumanFor: [],
    });
    const names = Object.fromEntries(rows.map((r) => [r.id, r.customerName]));
    expect(names[visitor.id]).toBe('Phạm Ngọc Hân');
    expect(names[named.id]).toBe('Trần Minh');
  });
});
