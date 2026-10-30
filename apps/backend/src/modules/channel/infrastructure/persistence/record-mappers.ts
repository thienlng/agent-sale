import type { schema } from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';
import type { ChannelProvider, MetaProvider } from '@agent-sales/contracts';
import type { ConnectionRecord, OAuthFlow } from '../../application/ports/channel-store.js';
import { readSettings } from './website.store.js';

export function connection(r: typeof schema.channelConnections.$inferSelect): ConnectionRecord {
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
export function flow(r: typeof schema.channelOauthFlows.$inferSelect): OAuthFlow {
  return { ...r, workspaceId: r.workspaceId as WorkspaceId, provider: r.provider as MetaProvider };
}
