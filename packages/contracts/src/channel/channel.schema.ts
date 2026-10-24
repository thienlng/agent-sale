import { z } from 'zod';
export const MetaProvider = z.enum(['facebook', 'instagram']);
export type MetaProvider = z.infer<typeof MetaProvider>;
export const ChannelConnectionDto = z.object({
  id: z.uuid(),
  provider: MetaProvider,
  externalId: z.string(),
  name: z.string(),
  status: z.enum(['connected', 'reauth_required', 'disconnected']),
  botId: z.uuid().nullable(),
  expiresAt: z.iso.datetime().nullable(),
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
