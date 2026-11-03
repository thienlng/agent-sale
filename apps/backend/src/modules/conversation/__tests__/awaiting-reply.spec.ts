import type { ConversationView } from '@agent-sales/contracts';
import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { newConversation } from '../domain/conversation-state.js';
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
