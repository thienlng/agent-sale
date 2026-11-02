import {
  PUBLIC_EVENT_DATA,
  PUBLIC_EVENT_SOURCES,
  type PublicEventType,
  type WebhookEnvelope,
} from '@agent-sales/contracts';

import type { PublicOutboxRow } from './ports/developer-store.js';
import { eventIdOf } from './webhook-signing.js';

/** Internal outbox type → public type (ADR-022 §7). */
const PUBLIC_TYPE_OF = new Map<string, PublicEventType>(
  (Object.entries(PUBLIC_EVENT_SOURCES) as [PublicEventType, string][]).map(([pub, src]) => [
    src,
    pub,
  ]),
);

/** The outbox types the dispatcher reads. */
export const PUBLIC_SOURCE_TYPES: readonly string[] = [...PUBLIC_TYPE_OF.keys()];

/**
 * Maps an outbox row to its public envelope, or null when the type is not public or the payload
 * does not match the public schema. The public schema is a whitelist: parsing drops every field
 * it does not name (internal ids of other systems, flags), so nothing leaks by accident when an
 * internal event grows.
 */
export function toPublicEnvelope(row: PublicOutboxRow): WebhookEnvelope | null {
  const type = PUBLIC_TYPE_OF.get(row.type);
  if (!type) return null;
  const data = PUBLIC_EVENT_DATA[type].safeParse(row.payload);
  if (!data.success) return null;
  const at = (row.payload as { occurredAt?: unknown } | null)?.occurredAt;
  const occurredAt =
    typeof at === 'string' && !Number.isNaN(Date.parse(at))
      ? new Date(at).toISOString()
      : row.createdAt.toISOString();
  return {
    id: eventIdOf(row.id),
    type,
    workspaceId: row.workspaceId,
    occurredAt,
    data: data.data as Record<string, unknown>,
  };
}
