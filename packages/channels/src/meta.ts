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
/** What Meta tells us about a customer who wrote to the page. */
export interface CustomerProfile {
  name: string | null;
  avatarUrl: string | null;
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
          attachments: attachments(message.attachments),
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
            message: outbound(message),
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
  /**
   * "Seen" and "typing…" bubbles. Cosmetic: never retried, and any failure is swallowed because the
   * reply itself must not depend on it.
   */
  async sendAction(
    asset: { externalId: string; token: string },
    to: string,
    action: 'mark_seen' | 'typing_on',
  ): Promise<boolean> {
    const host = this.kind === 'instagram' ? 'graph.instagram.com' : 'graph.facebook.com';
    try {
      const res = await this.transport(
        `https://${host}/${this.version}/${encodeURIComponent(asset.externalId)}/messages`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${asset.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient: { id: to }, sender_action: action }),
          signal: AbortSignal.timeout(3000),
          redirect: 'error',
        },
      );
      return res.ok;
    } catch {
      return false;
    }
  }
  /**
   * Name and picture of a customer (Messenger PSID or Instagram-scoped id). Read-only and safe to
   * retry; throws `MetaRequestError` when Meta refuses (the profile is a nicety, never required).
   * Messenger: first_name, last_name, profile_pic. Instagram: name, username, profile_pic.
   */
  async fetchProfile(asset: { token: string }, customerId: string): Promise<CustomerProfile> {
    const instagram = this.kind === 'instagram';
    const host = instagram ? 'graph.instagram.com' : 'graph.facebook.com';
    const fields = instagram ? 'name,username,profile_pic' : 'first_name,last_name,profile_pic';
    let res: Response;
    try {
      res = await this.transport(
        `https://${host}/${this.version}/${encodeURIComponent(customerId)}?fields=${fields}`,
        {
          headers: { Authorization: `Bearer ${asset.token}` },
          signal: AbortSignal.timeout(10000),
          redirect: 'error',
        },
      );
    } catch {
      throw new MetaRequestError('profile_unavailable', true);
    }
    const data = record(await res.json().catch(() => null));
    if (!res.ok || data.error) {
      throw new MetaRequestError(
        record(data.error).code === 190 ? 'auth_expired' : 'profile_unavailable',
        res.status >= 500,
      );
    }
    const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
    const name = instagram
      ? text(data.name) || text(data.username)
      : [text(data.first_name), text(data.last_name)].filter(Boolean).join(' ');
    const pic = text(data.profile_pic);
    return {
      name: name.slice(0, 200) || null,
      avatarUrl: pic.startsWith('https://') && pic.length <= 2000 ? pic : null,
    };
  }
  capabilities() {
    return { richCards: false, quickReplies: false, media: true, replyWindowHours: 24 };
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
type InboundAttachment = NonNullable<NormalizedEvent['attachments']>[number];
const ATTACHMENT_TYPES = new Set(['image', 'video', 'audio', 'file']);
/** Keeps only HTTPS media; Meta CDN links expire, so they are display hints, not archives. */
function attachments(value: unknown): InboundAttachment[] {
  const result: InboundAttachment[] = [];
  for (const item of array(value).slice(0, 10)) {
    const a = record(item),
      payload = record(a.payload);
    const url = payload.url;
    if (typeof url !== 'string' || !url.startsWith('https://') || url.length > 2000) continue;
    const type = payload.sticker_id !== undefined ? 'sticker' : a.type;
    if (type !== 'sticker' && !(typeof type === 'string' && ATTACHMENT_TYPES.has(type))) continue;
    result.push({ type: type as InboundAttachment['type'], url });
  }
  return result;
}
/** Meta takes either text or attachments in one message; several attachments arrive as one album. */
function outbound(message: OutboundMessage): Record<string, unknown> {
  const items = (message.attachments ?? [])
    .slice(0, 10)
    .map((a) => ({ type: a.type, payload: { url: a.url, is_reusable: true } }));
  if (!items.length) return { text: message.text };
  return items.length === 1 ? { attachment: items[0] } : { attachments: items };
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
