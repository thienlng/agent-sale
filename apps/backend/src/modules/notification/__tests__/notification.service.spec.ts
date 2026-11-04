import { newId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import type { NotifyInput } from '../api/notification.facade.js';
import { NotificationService } from '../application/notification.service.js';
import { isSafeAppPath } from '../domain/notification.js';
import type { NotificationChannel } from '../domain/ports/notification-channel.port.js';
import { InMemoryNotificationRepository } from '../infrastructure/persistence/notification.in-memory-repository.js';
import type { IdentityFacade } from '../../identity/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';

function setup(emailOn = true) {
  const repo = new InMemoryNotificationRepository();
  const email: NotificationChannel = {
    kind: 'email',
    available: () => emailOn,
    send: vi.fn(async () => ({ providerMessageId: 'm' })),
  };
  const identity = {
    displayName: vi.fn(),
    profile: vi.fn(async () => ({ name: 'Lan', email: 'lan@example.test', locale: 'en' as const })),
  } as unknown as IdentityFacade;
  const workspaces = { accountOf: vi.fn(async () => null) } as unknown as WorkspaceFacade;
  return { repo, service: new NotificationService(repo, [email], identity, workspaces) };
}

const input = (over: Partial<NotifyInput> = {}): NotifyInput => ({
  accountId: newId(),
  userId: newId(),
  workspaceId: null,
  type: 'assistant.report',
  params: {},
  title: 'Doanh thu hôm qua',
  body: '1.250.000 ₫',
  target: { kind: 'assistant_report', runId: newId() },
  channels: ['in_app', 'email'],
  ...over,
});

describe('NotificationService.notify', () => {
  it('stores the in-app row and queues one delivery per other channel', async () => {
    const { repo, service } = setup();
    const res = await service.notify(input({ channels: ['in_app', 'email', 'email', 'push'] }));
    expect(res.deduped).toBe(false);
    expect([...repo.deliveries.values()].map((d) => [d.channel, d.status]).sort()).toEqual([
      ['email', 'queued'],
      ['push', 'queued'],
    ]);
    const inAppOnly = await service.notify(input({ channels: ['in_app'] }));
    expect(repo.notifications.has(inAppOnly.id)).toBe(true);
    expect(repo.deliveries.size).toBe(2);
  });

  it('dedups on the key for the same user', async () => {
    const { repo, service } = setup();
    const i = input({ dedupKey: 'sched:1:2026-11-02T01:00:00.000Z' });
    const a = await service.notify(i);
    expect(await service.notify(i)).toEqual({ id: a.id, deduped: true });
    expect(repo.notifications.size).toBe(1);
  });

  it('stores an email as skipped when the channel is off', async () => {
    const { repo, service } = setup(false);
    expect(service.emailAvailable()).toBe(false);
    await service.notify(input());
    expect([...repo.deliveries.values()][0]).toMatchObject({
      channel: 'email',
      status: 'skipped',
      errorCode: 'email_disabled',
    });
  });

  it('validates lengths and targets', async () => {
    const { service } = setup();
    await expect(service.notify(input({ title: ' ' }))).rejects.toThrow();
    await expect(service.notify(input({ title: 'x'.repeat(161) }))).rejects.toThrow();
    await expect(service.notify(input({ body: 'x'.repeat(4001) }))).rejects.toThrow();
    await expect(service.notify(input({ dedupKey: 'k'.repeat(161) }))).rejects.toThrow();
    for (const path of [
      'https://evil.test',
      '/app/../admin',
      '//evil.test',
      '/app/%2e%2e/x',
      '/apps',
    ]) {
      await expect(
        service.notify(input({ target: { kind: 'path', path } })),
        path,
      ).rejects.toThrow();
    }
    await expect(
      service.notify(input({ target: { kind: 'assistant_report', runId: 'nope' } })),
    ).rejects.toThrow();
    await expect(
      service.notify(input({ target: { kind: 'path', path: '/app/inbox' } })),
    ).resolves.toBeDefined();
  });

  it('reads the recipient locale from identity', async () => {
    const { service } = setup();
    expect(await service.recipientLocale(newId())).toBe('en');
  });
});

describe('isSafeAppPath', () => {
  it('accepts dashboard paths only', () => {
    expect(isSafeAppPath('/app')).toBe(true);
    expect(isSafeAppPath('/app/orders')).toBe(true);
    for (const bad of ['/app?x=1', '/app#x', '/app\\x', '/app/./x', '/admin', '/app/a%20b']) {
      expect(isSafeAppPath(bad), bad).toBe(false);
    }
  });
});

describe('NotificationService list and read', () => {
  it('pages with a keyset cursor and marks read for the user only', async () => {
    const { service } = setup();
    const accountId = newId();
    const userId = newId();
    for (let i = 0; i < 3; i++) {
      await service.notify(input({ accountId, userId, title: `n${i}`, channels: ['in_app'] }));
    }
    const p1 = await service.list(accountId, userId, { limit: 2 });
    expect(p1.items.map((x) => x.title)).toEqual(['n2', 'n1']);
    expect(p1.next).not.toBeNull();
    const p2 = await service.list(accountId, userId, { limit: 2, ...p1.next! });
    expect(p2.items.map((x) => x.title)).toEqual(['n0']);
    expect(p2.next).toBeNull();
    await expect(service.markRead(accountId, newId(), p1.items[0]!.id)).rejects.toThrow();
    await expect(service.markRead(accountId, userId, 'not-a-uuid')).rejects.toThrow();
    expect((await service.markRead(accountId, userId, p1.items[0]!.id)).readAt).not.toBeNull();
    expect(await service.unreadCount(accountId, userId)).toBe(2);
    expect(await service.markAllRead(accountId, userId)).toBe(2);
  });
});
