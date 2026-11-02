import { createHash, createHmac, randomBytes } from 'node:crypto';

import { WEBHOOK_HEADERS } from '@agent-sales/contracts';

/** A fresh signing secret, `whsec_` + 32 random bytes (base64url). */
export const newSigningSecret = (): string => `whsec_${randomBytes(32).toString('base64url')}`;

/** Hex HMAC-SHA256 of `"<t>.<body>"` with the secret. */
export function sign(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
}

/**
 * `t=<unix>,v1=<sig>[,v1=<sig>]`: one `v1` per active secret, so a receiver keeps verifying
 * during the 24 h after a rotation with either the old or the new secret.
 */
export function signatureHeader(
  secrets: readonly string[],
  timestamp: number,
  body: string,
): string {
  return [`t=${timestamp}`, ...secrets.map((s) => `v1=${sign(s, timestamp, body)}`)].join(',');
}

/** Headers of one webhook POST (ADR-022 §5). */
export function webhookHeaders(input: {
  eventId: string;
  eventType: string;
  secrets: readonly string[];
  body: string;
  now: Date;
}): Record<string, string> {
  const t = Math.floor(input.now.getTime() / 1000);
  return {
    'content-type': 'application/json',
    'user-agent': 'Rapiz-Webhooks/1.0',
    [WEBHOOK_HEADERS.eventId.toLowerCase()]: input.eventId,
    [WEBHOOK_HEADERS.eventType.toLowerCase()]: input.eventType,
    [WEBHOOK_HEADERS.signature.toLowerCase()]: signatureHeader(input.secrets, t, input.body),
  };
}

/**
 * The envelope id of an outbox event: a name-based UUID (v5 layout) of the outbox row id, so the
 * same event always has the same id across dispatches, retries and resends.
 */
export function eventIdOf(outboxId: number): string {
  const h = createHash('sha1').update(`rapiz:outbox:${outboxId}`).digest();
  h[6] = ((h[6] ?? 0) & 0x0f) | 0x50;
  h[8] = ((h[8] ?? 0) & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
