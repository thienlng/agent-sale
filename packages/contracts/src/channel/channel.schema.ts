import { z } from 'zod';
import { WebsiteSettings } from './website.schema.js';
export const MetaProvider = z.enum(['facebook', 'instagram']);
export type MetaProvider = z.infer<typeof MetaProvider>;
export const ChannelProvider = z.enum(['facebook', 'instagram', 'website']);
export type ChannelProvider = z.infer<typeof ChannelProvider>;
export const ChannelConnectionDto = z.object({
  id: z.uuid(),
  provider: ChannelProvider,
  externalId: z.string(),
  name: z.string(),
  /** `removed` is a soft delete: hidden from the list, no bot, no ingestion, history kept. */
  status: z.enum(['connected', 'disabled', 'reauth_required', 'disconnected', 'removed']),
  botId: z.uuid().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  /** Widget settings; only website connections have them. */
  settings: WebsiteSettings.nullable().optional(),
  createdAt: z.iso.datetime(),
});
export type ChannelConnectionDto = z.infer<typeof ChannelConnectionDto>;
export const ChannelListResponse = z.object({
  data: z.array(ChannelConnectionDto),
  providers: z.array(z.object({ provider: MetaProvider, configured: z.boolean() })),
});
export const ConnectChannelResponse = z.object({ url: z.url(), state: z.string() });
export const DiscoveryDto = z.object({
  id: z.uuid(),
  provider: MetaProvider,
  accounts: z.array(z.object({ externalId: z.string(), name: z.string() })),
});
export const SelectChannelRequest = z.object({
  externalIds: z.array(z.string().min(1).max(200)).min(1).max(100),
});
export const UpdateChannelRequest = z.object({
  botId: z.uuid().nullable().optional(),
  disconnect: z.literal(true).optional(),
});
export type UpdateChannelRequest = z.infer<typeof UpdateChannelRequest>;
