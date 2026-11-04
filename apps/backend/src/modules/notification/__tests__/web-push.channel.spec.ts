import { newId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import { DeliveryRunner } from '../application/delivery-runner.js';
import { NotificationService } from '../application/notification.service.js';
import {
  PushFailedError,
  WebPushChannel,
  webPushConfig,
} from '../infrastructure/clients/web-push.channel.js';
import { InMemoryNotificationRepository } from '../infrastructure/persistence/notification.in-memory-repository.js';

import type { IdentityFacade } from '../../identity/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';

const CONFIG = { publicKey: 'B'.repeat(87), privateKey: 'p'.repeat(43), subject: 'mailto:a@b.vn' };

function setup(send: (...a: unknown[]) => Promise<unknown>) {
  const repo = new InMemoryNotificationRepository();
  const push = new WebPushChannel(CONFIG, repo, send as never);
  const identity = {
    displayName: vi.fn(),
    profile: vi.fn(async () => ({ name: 'Lan', email: 'lan@example.test', locale: 'vi' as const })),
  } as unknown as IdentityFacade;
  const workspaces = { accountOf: vi.fn(async () => null) } as unknown as WorkspaceFacade;
  const service = new NotificationService(repo, [push], identity, workspaces, CONFIG.publicKey);
  const runner = new DeliveryRunner(repo, [push], identity, 'https://app.rapiz.test');
  return { repo, service, runner };
}

const device = (n: number) => ({
  endpoint: `https://push.example.test/${n}`,
  keys: { p256dh: `k${n}`, auth: `a${n}` },
});

describe('WebPushChannel', () => {
  it('reads its VAPID config only when both keys are set', () => {
    expect(webPushConfig({ WEB_PUSH_SUBJECT: 'mailto:x@y.vn' })).toBeNull();
    expect(
      webPushConfig({
        WEB_PUSH_PUBLIC_KEY: CONFIG.publicKey,
        WEB_PUSH_PRIVATE_KEY: CONFIG.privateKey,
        WEB_PUSH_SUBJECT: CONFIG.subject,
      }),
    ).toEqual(CONFIG);
  });

  it('pushes to every device with a relative link, and forgets a device the service says is gone', async () => {
    const send = vi.fn(async (...args: unknown[]) => {
      const sub = args[0] as { endpoint: string };
      if (sub.endpoint.endsWith('/2')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      return {};
    });
    const { repo, service, runner } = setup(send);
    const accountId = newId();
    const userId = newId();
    await service.savePushSubscription(accountId, userId, device(1));
    await service.savePushSubscription(accountId, userId, device(2));
    // Re-registering the same browser keeps one row.
    await service.savePushSubscription(accountId, userId, device(1));
    expect(repo.pushSubscriptions.size).toBe(2);
    expect(service.pushConfig()).toEqual({ publicKey: CONFIG.publicKey });

    await service.notify({
      accountId,
      userId,
      type: 'inbox.handoff',
      params: {},
      title: 'Khách cần nhân viên',
      body: 'Lan: cho chị gặp nhân viên',
      workspaceId: '01a1a476-8076-74f6-bd65-49b32c66b614',
      target: { kind: 'conversation', conversationId: '01a1a476-8076-74f6-bd65-49b32c66b615' },
      channels: ['in_app', 'push'],
      dedupKey: 'inbox:abc:123',
    });
    expect(await runner.tick()).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
    const payload = JSON.parse(send.mock.calls[0]?.[1] as string) as Record<string, unknown>;
    expect(payload).toEqual({
      title: 'Khách cần nhân viên',
      body: 'Lan: cho chị gặp nhân viên',
      url: '/app/inbox?conversation=01a1a476-8076-74f6-bd65-49b32c66b615&ws=01a1a476-8076-74f6-bd65-49b32c66b614',
      tag: 'inbox:abc',
    });
    expect([...repo.pushSubscriptions.values()].map((p) => p.endpoint)).toEqual([
      'https://push.example.test/1',
    ]);
  });

  it('skips a user with no device, and fails (to retry) when no device took the push', async () => {
    const { repo, service, runner } = setup(async () => {
      throw Object.assign(new Error('boom'), { statusCode: 500 });
    });
    const accountId = newId();
    const userId = newId();
    const base = {
      accountId,
      userId,
      type: 'inbox.message' as const,
      params: {},
      title: 't',
      body: 'b',
      target: null,
      channels: ['in_app' as const, 'push' as const],
    };
    await service.notify({ ...base, dedupKey: 'a' });
    await runner.tick();
    expect([...repo.deliveries.values()][0]).toMatchObject({
      status: 'skipped',
      errorCode: 'no_recipient',
    });

    await service.savePushSubscription(accountId, userId, device(1));
    await service.notify({ ...base, dedupKey: 'b' });
    await runner.tick();
    const retried = [...repo.deliveries.values()].find((d) => d.status !== 'skipped');
    expect(retried).toMatchObject({ status: 'queued', errorCode: 'PushFailedError' });
    expect([...repo.pushSubscriptions.values()][0]?.failures).toBe(1);
  });

  it('refuses to send while unconfigured', async () => {
    const off = new WebPushChannel(null, new InMemoryNotificationRepository());
    expect(off.available()).toBe(false);
    await expect(
      off.send({
        to: 'u',
        accountId: 'a',
        userId: 'u',
        locale: 'vi',
        title: 't',
        body: 'b',
        link: null,
      }),
    ).rejects.toBeInstanceOf(PushFailedError);
  });
});
