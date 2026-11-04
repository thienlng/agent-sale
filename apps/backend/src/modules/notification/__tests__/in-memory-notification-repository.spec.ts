import { newId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import type { NewNotification } from '../domain/ports/notification.repository.js';
import { InMemoryNotificationRepository } from '../infrastructure/persistence/notification.in-memory-repository.js';

/** The in-memory twin mirrors the Drizzle notification repository (T-172). */
const user = () => ({ accountId: newId(), userId: newId() });
const note = (
  u: { accountId: string; userId: string },
  over: Partial<NewNotification> = {},
): NewNotification => ({
  id: newId(),
  ...u,
  workspaceId: null,
  type: 'assistant.alert',
  params: {},
  title: '3 khách đang chờ',
  body: 'Facebook: 2\nZalo: 1',
  target: { kind: 'path', path: '/app/inbox' },
  dedupKey: null,
  ...over,
});

describe('InMemoryNotificationRepository', () => {
  it('dedups per user and keeps the deliveries', async () => {
    const repo = new InMemoryNotificationRepository();
    const a = user();
    const first = await repo.insertNotification(note(a, { dedupKey: 'k' }), [
      { id: newId(), channel: 'email' },
    ]);
    expect(first.deduped).toBe(false);
    expect(first.deliveries[0]?.status).toBe('queued');
    expect(
      await repo.insertNotification(note(a, { dedupKey: 'k' }), [
        { id: newId(), channel: 'email' },
      ]),
    ).toEqual({ id: first.id, deduped: true, deliveries: [] });
    // Another user may use the same key.
    const b = { accountId: a.accountId, userId: newId() };
    expect((await repo.insertNotification(note(b, { dedupKey: 'k' }), [])).deduped).toBe(false);
    await expect(
      repo.insertNotification(note(a, { title: 'x'.repeat(161) }), []),
    ).rejects.toThrow();
  });

  it('lists by keyset and marks read for the user only', async () => {
    const repo = new InMemoryNotificationRepository();
    const a = user();
    const other = { accountId: a.accountId, userId: newId() };
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push((await repo.insertNotification(note(a, { title: `n${i}` }), [])).id);
    }
    const p1 = await repo.list(a.accountId, a.userId, { limit: 2 });
    expect(p1.map((x) => x.title)).toEqual(['n3', 'n2']);
    const p2 = await repo.list(a.accountId, a.userId, {
      limit: 5,
      before: p1[1]!.createdAt,
      beforeId: p1[1]!.id,
    });
    expect(p2.map((x) => x.title)).toEqual(['n1', 'n0']);
    expect(await repo.markRead(other.accountId, other.userId, ids[0]!)).toBeNull();
    expect(await repo.markRead(newId(), a.userId, ids[0]!)).toBeNull();
    expect((await repo.markRead(a.accountId, a.userId, ids[0]!))?.readAt).toBeInstanceOf(Date);
    expect(await repo.unreadCount(a.accountId, a.userId)).toBe(3);
    expect(await repo.markAllRead(a.accountId, a.userId)).toBe(3);
    expect(await repo.unreadCount(a.accountId, a.userId)).toBe(0);
  });

  it('claims due deliveries once and skips leased rows', async () => {
    const repo = new InMemoryNotificationRepository();
    const a = user();
    const made = await repo.insertNotification(note(a), [
      { id: newId(), channel: 'email' },
      { id: newId(), channel: 'push', status: 'skipped', errorCode: 'channel_unavailable' },
    ]);
    const now = new Date(Date.now() + 1000);
    const first = await repo.claimDeliveries(now, 20, 120_000);
    expect(first.map((x) => x.channel)).toEqual(['email']);
    expect(await repo.claimDeliveries(new Date(now.getTime() + 60_000), 20, 120_000)).toEqual([]);
    expect(await repo.claimDeliveries(new Date(now.getTime() + 121_000), 20, 120_000)).toHaveLength(
      1,
    );
    const sentAt = new Date();
    await repo.finishDelivery(first[0]!.id, { status: 'sent', attempts: 1, sentAt });
    expect(await repo.countSentEmails(a.userId, new Date(sentAt.getTime() - 1))).toBe(1);
    expect((await repo.deliverySummary(a.accountId, a.userId, [made.id])).get(made.id)).toEqual({
      email: 'sent',
      push: 'skipped',
    });
    expect(await repo.purgeOld(new Date(Date.now() + 10_000))).toBe(1);
    expect(repo.deliveries.size).toBe(0);
  });
});
