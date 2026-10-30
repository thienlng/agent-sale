import { describe, expect, it } from 'vitest';
import { ChannelConnectionDto } from './channel.schema.js';
import { channelRoutes } from './channel.routes.js';

const base = {
  id: '0199f8c8-3b7a-7e6b-9a3e-2b1f6a8c9e01',
  provider: 'facebook',
  externalId: '100',
  name: 'Shop',
  botId: null,
  expiresAt: null,
  createdAt: '2026-10-23T03:00:00.000Z',
};

describe('channel contracts', () => {
  it('keeps every existing connection status valid and adds removed', () => {
    for (const status of ['connected', 'disabled', 'reauth_required', 'disconnected', 'removed'])
      expect(ChannelConnectionDto.safeParse({ ...base, status }).success).toBe(true);
    expect(ChannelConnectionDto.safeParse({ ...base, status: 'deleted' }).success).toBe(false);
  });

  it('declares DELETE /channels/{id} as an authenticated, workspace-scoped 204', () => {
    const route = channelRoutes.find((r) => r.method === 'delete' && r.path === '/channels/{id}');
    expect(route).toMatchObject({ auth: true, workspaceScoped: true, responses: { 204: null } });
  });
});
