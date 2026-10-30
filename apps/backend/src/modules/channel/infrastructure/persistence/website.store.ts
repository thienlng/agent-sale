import { and, eq, schema, sql, withSystem, type Database } from '@agent-sales/db';
import { WebsiteSettings, type ChannelProvider } from '@agent-sales/contracts';
import type { NormalizedEvent } from '@agent-sales/channels';
import { newId, type WorkspaceId } from '@agent-sales/shared';
import type { ConnectionRecord } from '../../application/ports/channel-store.js';

const c = schema.channelConnections,
  e = schema.channelWebhookEvents;

/** Stored settings, or null when absent; a corrupt document never breaks listing. */
export function readSettings(raw: unknown): WebsiteSettings | null {
  const parsed = WebsiteSettings.safeParse(raw);
  if (parsed.success) return parsed.data;
  const domains = (raw as { domains?: unknown } | null)?.domains;
  const fallback = WebsiteSettings.safeParse({ domains: Array.isArray(domains) ? domains : [] });
  return fallback.success ? fallback.data : null;
}

function record(r: typeof c.$inferSelect): ConnectionRecord {
  return {
    id: r.id,
    workspaceId: r.workspaceId as WorkspaceId,
    provider: r.provider as ChannelProvider,
    externalId: r.externalId,
    name: r.name,
    status: r.status as ConnectionRecord['status'],
    botId: r.botId,
    tokenSealed: r.tokenSealed,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    settings: r.provider === 'website' ? readSettings(r.settings) : null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Cross-tenant lookup by the public site key (system role). */
export function findWebsiteRecord(system: Database, siteKey: string) {
  return withSystem(system, async (tx) => {
    const [r] = await tx
      .select()
      .from(c)
      .where(
        and(eq(c.provider, 'website'), eq(c.externalId, siteKey), sql`${c.status} <> 'removed'`),
      );
    return r ? record(r) : null;
  });
}

/** Stores a website customer event once per (connection, externalEventId). */
export function enqueueWebsiteEvent(
  system: Database,
  rec: ConnectionRecord,
  event: NormalizedEvent,
) {
  return withSystem(system, async (tx) => {
    const rows = await tx
      .insert(e)
      .values({
        id: newId(),
        workspaceId: rec.workspaceId,
        connectionId: rec.id,
        externalId: event.externalEventId,
        payload: { ...event, raw: undefined },
      })
      .onConflictDoNothing()
      .returning({ id: e.id });
    return rows.length > 0;
  });
}

export function hasPendingMessage(system: Database, connectionId: string, sender: string) {
  return withSystem(system, async (tx) => {
    const rows = await tx
      .select({ id: e.id })
      .from(e)
      .where(
        and(
          eq(e.connectionId, connectionId),
          sql`${e.processedAt} is null`,
          sql`${e.payload}->>'type' = 'message'`,
          sql`${e.payload}->>'senderExternalId' = ${sender}`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  });
}
