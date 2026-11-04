import { newId } from '@agent-sales/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DeliveryRunner } from '../application/delivery-runner.js';
import { NotificationService } from '../application/notification.service.js';
import { EMAIL_DAILY_CAP, MAX_DELIVERY_ATTEMPTS } from '../domain/notification.js';
import type {
  NotificationChannel,
  OutgoingMessage,
} from '../domain/ports/notification-channel.port.js';
import { InMemoryNotificationRepository } from '../infrastructure/persistence/notification.in-memory-repository.js';
import type { IdentityFacade } from '../../identity/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';

const T0 = new Date('2026-11-02T01:00:00Z');

function setup(opts: { email?: string | null; channels?: NotificationChannel[] } = {}) {
  const repo = new InMemoryNotificationRepository();
  const sent: OutgoingMessage[] = [];
  const send = vi.fn(async (m: OutgoingMessage) => {
    sent.push(m);
    return { providerMessageId: `m${sent.length}` };
  });
  const email: NotificationChannel = { kind: 'email', available: () => true, send };
  const channels = opts.channels ?? [email];
  const address = opts.email === undefined ? 'lan@example.test' : opts.email;
  const identity = {
    displayName: vi.fn(),
    profile: vi.fn(async () =>
      address === null ? null : { name: 'Lan', email: address, locale: 'vi' as const },
    ),
  } as unknown as IdentityFacade;
  const workspaces = { accountOf: vi.fn(async () => null) } as unknown as WorkspaceFacade;
  const service = new NotificationService(repo, channels, identity, workspaces);
  const runner = new DeliveryRunner(repo, channels, identity, 'https://app.rapiz.test');
  const accountId = newId();
  const userId = newId();
  const notify = (channels: ('in_app' | 'email' | 'push')[] = ['in_app', 'email']) =>
    service.notify({
      accountId,
      userId,
      type: 'assistant.alert',
      params: {},
      title: 'Sắp hết hàng',
      body: 'Áo thun: còn 2',
      target: { kind: 'path', path: '/app/products' },
      channels,
    });
  const delivery = () => [...repo.deliveries.values()][0]!;
  return { repo, runner, send, sent, notify, delivery, userId };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

const at = (ms: number) => new Date(T0.getTime() + ms);

describe('DeliveryRunner', () => {
  it('sends a due email with an app link and marks it sent', async () => {
    const { runner, sent, notify, delivery } = setup();
    await notify();
    expect(await runner.tick(at(1000))).toBe(1);
    expect(sent[0]).toMatchObject({
      to: 'lan@example.test',
      locale: 'vi',
      title: 'Sắp hết hàng',
      link: 'https://app.rapiz.test/app/products',
    });
    expect(delivery()).toMatchObject({ status: 'sent', attempts: 1, providerMessageId: 'm1' });
    expect(await runner.tick(at(2000))).toBe(0);
  });

  it('retries 1, 5 and 30 minutes later, then fails with the error class', async () => {
    const { runner, send, notify, delivery } = setup();
    send.mockRejectedValue(new TypeError('connect ECONNREFUSED lan@example.test'));
    await notify();
    await runner.tick(at(1000));
    expect(delivery()).toMatchObject({ status: 'queued', attempts: 1, errorCode: 'TypeError' });
    expect(delivery().nextAttemptAt).toEqual(at(1000 + 60_000));
    // Not due before the retry time.
    await runner.tick(at(30_000));
    expect(send).toHaveBeenCalledTimes(1);
    await runner.tick(at(1000 + 60_000));
    expect(delivery()).toMatchObject({ attempts: 2 });
    expect(delivery().nextAttemptAt).toEqual(at(1000 + 60_000 + 5 * 60_000));
    await runner.tick(at(1000 + 6 * 60_000));
    expect(delivery()).toMatchObject({ attempts: 3, status: 'queued' });
    expect(delivery().nextAttemptAt).toEqual(at(1000 + 36 * 60_000));
    await runner.tick(at(1000 + 36 * 60_000));
    expect(delivery()).toMatchObject({ attempts: 4, status: 'failed', errorCode: 'TypeError' });
    await runner.tick(at(1000 + 120 * 60_000));
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('counts an attempt before sending, so a send that crashes the worker stops', async () => {
    const { repo, runner, send, notify, delivery } = setup();
    // Each send "crashes" the worker: its outcome is never written and the lease lapses.
    const finish = repo.finishDelivery.bind(repo);
    vi.spyOn(repo, 'finishDelivery').mockImplementation(async (id, patch) => {
      if (patch.errorCode !== 'send_interrupted') throw new Error('worker crashed');
      return finish(id, patch);
    });
    await notify();
    for (let i = 0; i < 8; i++) await runner.tick(at(1000 + i * 3 * 60_000));
    expect(send).toHaveBeenCalledTimes(MAX_DELIVERY_ATTEMPTS);
    expect(delivery()).toMatchObject({
      status: 'failed',
      attempts: MAX_DELIVERY_ATTEMPTS,
      errorCode: 'send_interrupted',
    });
  });

  it('skips the 21st email of a user within 24 h', async () => {
    const { repo, runner, notify, send } = setup();
    for (let i = 0; i < EMAIL_DAILY_CAP + 1; i++) await notify();
    expect(await runner.tick(at(1000))).toBe(EMAIL_DAILY_CAP);
    await runner.tick(at(2000));
    expect(send).toHaveBeenCalledTimes(EMAIL_DAILY_CAP);
    const statuses = [...repo.deliveries.values()].map((d) => d.errorCode ?? d.status);
    expect(statuses.filter((s) => s === 'daily_cap')).toHaveLength(1);
  });

  it('skips a channel with no adapter (push) and a user with no address', async () => {
    const push = setup();
    await push.notify(['in_app', 'push']);
    await push.runner.tick(at(1000));
    expect(push.delivery()).toMatchObject({ status: 'skipped', errorCode: 'channel_unavailable' });

    const nobody = setup({ email: null });
    await nobody.notify();
    await nobody.runner.tick(at(1000));
    expect(nobody.delivery()).toMatchObject({ status: 'skipped', errorCode: 'no_recipient' });
    expect(nobody.send).not.toHaveBeenCalled();
  });

  it('purges notifications older than 90 days once a day', async () => {
    const { repo, runner, notify } = setup();
    await notify(['in_app']);
    await runner.tick(at(91 * 86_400_000));
    expect(repo.notifications.size).toBe(0);
  });
});
