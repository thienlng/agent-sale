import webpush from 'web-push';

import type {
  NotificationChannel,
  OutgoingMessage,
} from '../../domain/ports/notification-channel.port.js';
import type { NotificationRepository } from '../../domain/ports/notification.repository.js';

export interface WebPushConfig {
  publicKey: string;
  privateKey: string;
  /** `mailto:` or `https:` contact the push services can reach (VAPID `sub`). */
  subject: string;
}

/** The VAPID config from the environment; null (push off) unless both keys are set. */
export function webPushConfig(env: {
  WEB_PUSH_PUBLIC_KEY?: string | undefined;
  WEB_PUSH_PRIVATE_KEY?: string | undefined;
  WEB_PUSH_SUBJECT: string;
}): WebPushConfig | null {
  return env.WEB_PUSH_PUBLIC_KEY && env.WEB_PUSH_PRIVATE_KEY
    ? {
        publicKey: env.WEB_PUSH_PUBLIC_KEY,
        privateKey: env.WEB_PUSH_PRIVATE_KEY,
        subject: env.WEB_PUSH_SUBJECT,
      }
    : null;
}

/** What a push carries; the service worker shows it (`apps/web/public/sw.js`). */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string | null;
}

const TITLE_MAX = 120;
const BODY_MAX = 240;
const TTL_SECONDS = 24 * 60 * 60;

/** Push services answer 404/410 for an endpoint that unsubscribed or expired. */
const isGone = (e: unknown) => {
  const code = (e as { statusCode?: unknown } | null)?.statusCode;
  return code === 404 || code === 410;
};

export class PushFailedError extends Error {
  constructor() {
    super('every push to the recipient failed');
    this.name = 'PushFailedError';
  }
}

/**
 * Web Push (T-190) with VAPID: sends one encrypted message to every device of the recipient on the
 * account and forgets the devices the push service reports gone. Fails (so the runner retries) only
 * when no device took it. Never logs endpoints, titles or bodies.
 */
export class WebPushChannel implements NotificationChannel {
  readonly kind = 'push' as const;

  constructor(
    private readonly config: WebPushConfig | null,
    private readonly repo: NotificationRepository,
    private readonly send_ = webpush.sendNotification.bind(webpush),
    private readonly now: () => Date = () => new Date(),
  ) {}

  available(): boolean {
    return this.config !== null;
  }

  async hasRecipient(m: Pick<OutgoingMessage, 'accountId' | 'userId'>): Promise<boolean> {
    return (await this.repo.pushSubscriptionsFor(m.accountId, m.userId)).length > 0;
  }

  async send(m: OutgoingMessage): Promise<{ providerMessageId: string | null }> {
    if (!this.config) throw new PushFailedError();
    const devices = await this.repo.pushSubscriptionsFor(m.accountId, m.userId);
    const payload: PushPayload = {
      title: m.title.slice(0, TITLE_MAX),
      body: m.body.slice(0, BODY_MAX),
      url: m.link ?? '/app',
      tag: m.tag ?? null,
    };
    const body = JSON.stringify(payload);
    let delivered = 0;
    for (const device of devices) {
      try {
        await this.send_(
          { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
          body,
          {
            TTL: TTL_SECONDS,
            urgency: 'high',
            vapidDetails: this.config,
          },
        );
        delivered += 1;
        await this.repo.recordPushResult(device.id, 'sent', this.now());
      } catch (e) {
        await this.repo.recordPushResult(device.id, isGone(e) ? 'gone' : 'failed', this.now());
      }
    }
    if (delivered === 0) throw new PushFailedError();
    return { providerMessageId: null };
  }
}
