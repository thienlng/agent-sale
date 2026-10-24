import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  ChannelAdapter,
  ConnectorError,
  NormalizedEvent,
  OutboundMessage,
  SendResult,
} from './adapter.js';
export type MetaKind = 'facebook' | 'instagram';
export class MetaRequestError extends Error {
  constructor(
    readonly code: string,
    readonly uncertain: boolean = false,
  ) {
    super('Meta request failed');
  }
}
/** No automatic retries: a network failure after a POST has an uncertain delivery outcome. */
export class MetaAdapter implements ChannelAdapter {
  constructor(
    readonly kind: MetaKind,
    private readonly version = 'v24.0',
    private readonly transport: typeof fetch = fetch,
  ) {}
  verifyWebhook(headers: Record<string, string | undefined>, raw: string, secret: string): boolean {
    const signature = headers['x-hub-signature-256'];
    if (!secret || !signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
    const expected = createHmac('sha256', secret).update(raw).digest();
    return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
  }
  parseWebhook(body: unknown): NormalizedEvent[] {
    const root = record(body);
    const events: NormalizedEvent[] = [];
    if (root.object !== (this.kind === 'facebook' ? 'page' : 'instagram')) return events;
    for (const entry of array(root.entry)) {
      const e = record(entry);
      if (typeof e.id !== 'string') continue;
      for (const item of array(e.messaging)) {
        const m = record(item),
          message = record(m.message),
          sender = record(m.sender);
        if (typeof message.mid !== 'string' || typeof sender.id !== 'string') continue;
        const recipient = record(m.recipient);
        const echo: boolean = message.is_echo === true || sender.id === e.id;
        const peer: unknown = echo ? recipient.id : sender.id;
        if (typeof peer !== 'string' || peer === e.id) continue;
        const timestamp = typeof m.timestamp === 'number' ? m.timestamp : NaN;
        if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > 8640000000000000) continue;
        events.push({
          kind: this.kind,
          assetExternalId: e.id,
          externalEventId: message.mid,
          externalMessageId: message.mid,
          type: echo ? 'echo' : 'message',
          senderExternalId: peer,
          occurredAt: new Date(timestamp),
          text: typeof message.text === 'string' ? message.text : '',
          raw: item,
        });
      }
    }
    return events;
  }
  async send(
    asset: { externalId: string; token: string },
    to: string,
    message: OutboundMessage,
    _opts: { idempotencyKey: string },
  ): Promise<SendResult> {
    const host = this.kind === 'instagram' ? 'graph.instagram.com' : 'graph.facebook.com';
    let res: Response;
    try {
      res = await this.transport(
        `https://${host}/${this.version}/${encodeURIComponent(asset.externalId)}/messages`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${asset.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: { id: to },
            message: { text: message.text },
            ...(this.kind === 'facebook' ? { messaging_type: 'RESPONSE' } : {}),
          }),
          signal: AbortSignal.timeout(15000),
          redirect: 'error',
        },
      );
    } catch {
      throw new MetaRequestError('delivery_unknown', true);
    }
    const data = record(await res.json().catch(() => null));
    if (!res.ok || data.error) {
      const error = record(data.error);
      const code =
        error.code === 190
          ? 'auth_expired'
          : error.code === 10 || error.code === 200
            ? 'permission_denied'
            : res.status === 429
              ? 'rate_limited'
              : 'provider_rejected';
      throw new MetaRequestError(code, res.status >= 500);
    }
    if (typeof data.message_id !== 'string') throw new MetaRequestError('delivery_unknown', true);
    return { externalMessageId: data.message_id };
  }
  capabilities() {
    return { richCards: false, quickReplies: false, media: false, replyWindowHours: 24 };
  }
  mapError(error: unknown): ConnectorError {
    return {
      code:
        error instanceof MetaRequestError && error.code === 'auth_expired'
          ? 'auth_expired'
          : 'unknown',
      retryable: false,
    };
  }
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
