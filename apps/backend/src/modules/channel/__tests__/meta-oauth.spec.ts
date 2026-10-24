import { describe, expect, it } from 'vitest';
import type { Env } from '../../../common/config.js';
import { LiveMetaGateway } from '../infrastructure/clients/meta-oauth.js';

const env = {
  META_APP_ORIGIN: 'https://app.example',
  META_APP_ID: '1',
  META_APP_SECRET: 's',
  META_GRAPH_VERSION: 'v24.0',
  SECRETS_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
} as Env;

describe('LiveMetaGateway redirect URI', () => {
  it('defaults to the versioned API callback', () => {
    const url = new URL(new LiveMetaGateway(env).authorize('facebook', 'state'));
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.example/api/v1/channels/oauth/facebook/callback',
    );
  });
  it('uses the exact redirect registered on the Meta app when configured', () => {
    const gateway = new LiveMetaGateway({
      ...env,
      META_OAUTH_REDIRECT_URI:
        'https://tunnel.example/api/channels/oauth/{provider}/callback?popup=1',
    });
    const url = new URL(gateway.authorize('facebook', 'state'));
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://tunnel.example/api/channels/oauth/facebook/callback?popup=1',
    );
  });
});

describe('LiveMetaGateway permissions', () => {
  it('requests scopes explicitly without a login configuration', () => {
    const url = new URL(new LiveMetaGateway(env).authorize('facebook', 'state'));
    expect(url.searchParams.get('scope')).toContain('pages_messaging');
    expect(url.searchParams.has('config_id')).toBe(false);
  });
  it('leaves permissions to the login configuration, or Meta rejects the scopes', () => {
    const gateway = new LiveMetaGateway({ ...env, META_LOGIN_CONFIG_ID: '99' });
    const url = new URL(gateway.authorize('facebook', 'state'));
    expect(url.searchParams.get('config_id')).toBe('99');
    expect(url.searchParams.has('scope')).toBe(false);
  });
  it('still requests Instagram scopes next to the shared configuration id', () => {
    const gateway = new LiveMetaGateway({
      ...env,
      INSTAGRAM_APP_ID: '2',
      INSTAGRAM_APP_SECRET: 's',
      META_LOGIN_CONFIG_ID: '99',
    });
    expect(new URL(gateway.authorize('instagram', 'state')).searchParams.get('scope')).toContain(
      'instagram',
    );
  });
});

/** Replies by path, like Meta's Graph API; records every requested path with its query. */
function graph(routes: Record<string, unknown>, seen: string[] = []) {
  const transport = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    seen.push(url.pathname + url.search);
    const hit = Object.entries(routes).find(([path]) => url.pathname.endsWith(path));
    const body = hit?.[1] ?? { error: { code: 100, message: 'unknown' } };
    return new Response(JSON.stringify(body), { status: hit ? 200 : 400 });
  }) as typeof fetch;
  return { transport, seen };
}
const grants = (...names: string[]) => ({
  data: names.map((permission) => ({ permission, status: 'granted' })),
});
// The owner's login configuration grants exactly these (no pages_read_engagement).
const ALL = ['pages_show_list', 'pages_messaging', 'pages_manage_metadata'];
const pages = {
  data: [
    { id: 'p1', name: 'Page One', access_token: 'page-token-1' },
    { id: 'p2', name: 'Page Two', access_token: 'page-token-2' },
  ],
};

describe('LiveMetaGateway.exchange (Facebook)', () => {
  it('lists the granted Pages with tokens derived from a long-lived user token', async () => {
    const { transport, seen } = graph({
      '/oauth/access_token': { access_token: 'user-token' },
      '/me/permissions': grants(...ALL),
      '/me/accounts': pages,
      '/debug_token': { data: { is_valid: true, expires_at: 0 } },
    });
    const accounts = await new LiveMetaGateway(env, transport).exchange('facebook', 'code');
    expect(accounts.map((a) => a.externalId)).toEqual(['p1', 'p2']);
    expect(seen.some((u) => u.includes('grant_type=fb_exchange_token'))).toBe(true);
  });

  it('names the permissions the login configuration did not grant', async () => {
    const { transport } = graph({
      '/oauth/access_token': { access_token: 'user-token' },
      '/me/permissions': grants('pages_show_list'),
    });
    await expect(new LiveMetaGateway(env, transport).exchange('facebook', 'code')).rejects.toThrow(
      /pages_messaging, pages_manage_metadata/,
    );
  });

  it('skips a Page whose token cannot be inspected instead of dropping every Page', async () => {
    let debugCalls = 0;
    const base = graph({
      '/oauth/access_token': { access_token: 'user-token' },
      '/me/permissions': grants(...ALL),
      '/me/accounts': pages,
    });
    const transport = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes('/debug_token') && debugCalls++ === 0)
        return new Response(JSON.stringify({ error: { code: 190 } }), { status: 400 });
      if (String(input).includes('/debug_token'))
        return new Response(JSON.stringify({ data: { is_valid: true } }));
      return base.transport(input, init);
    }) as typeof fetch;
    const accounts = await new LiveMetaGateway(env, transport).exchange('facebook', 'code');
    expect(accounts.map((a) => a.externalId)).toEqual(['p2']);
  });

  it('still connects when the long-lived exchange is refused', async () => {
    const { transport } = graph({
      '/me/permissions': grants(...ALL),
      '/me/accounts': pages,
      '/debug_token': { data: { is_valid: true } },
    });
    // No /oauth/access_token route at all: both the code and the long-lived exchange fail.
    await expect(new LiveMetaGateway(env, transport).exchange('facebook', 'code')).rejects.toThrow(
      /Meta rejected/,
    );
  });
});
